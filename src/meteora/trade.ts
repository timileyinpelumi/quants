import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient, SwapMode, getCurrentPoint } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getTokenProgram } from "@meteora-ag/cp-amm-sdk";

export type Side = "buy" | "sell";
export interface TradeTarget { pool: string; dammPool: string | null; baseMint: string; quoteMint: string; baseDecimals: number; quoteDecimals: number }
export interface TradeQuote { amountIn: bigint; filledIn: bigint; amountOut: bigint; minOut: bigint; fee: bigint; venue: "curve" | "damm" }

export interface TradePort {
  quote(t: TradeTarget, side: Side, amountIn: bigint, slippageBps: number): Promise<TradeQuote>;
  buildSwapTx(t: TradeTarget, side: Side, amountIn: bigint, minOut: bigint, owner: string): Promise<string>;
}

const bn = (v: bigint) => new BN(v.toString());
const big = (v: BN | { toString(): string }) => BigInt(v.toString());
const withSlippage = (out: bigint, bps: number) => (out * BigInt(10_000 - bps)) / 10_000n;

export class TradeLive implements TradePort {
  private dbc: DynamicBondingCurveClient;
  private cp: CpAmm;
  constructor(private conn: Connection) {
    this.dbc = DynamicBondingCurveClient.create(conn, "confirmed");
    this.cp = new CpAmm(conn);
  }

  private async curve(pool: string) {
    const p = await this.dbc.state.getPool(pool);
    if (!p) throw new Error(`pool ${pool} not found`);
    const config = await this.dbc.state.getPoolConfig(p.poolState.config);
    if (!config) throw new Error("pool config not found");
    return { p, config, migrated: p.poolState.isMigrated !== 0 };
  }

  async quote(t: TradeTarget, side: Side, amountIn: bigint, slippageBps: number): Promise<TradeQuote> {
    if (t.dammPool) return this.dammQuote(t, side, amountIn, slippageBps);
    const { p, config, migrated } = await this.curve(t.pool);
    if (migrated) throw new Error("graduated");
    const currentPoint = await getCurrentPoint(this.conn, config.activationType);
    const r = this.dbc.pool.swapQuote2({
      virtualPool: p, config, swapBaseForQuote: side === "sell", hasReferral: false, eligibleForFirstSwapWithMinFee: false,
      currentPoint, slippageBps, swapMode: side === "buy" ? SwapMode.PartialFill : SwapMode.ExactIn, amountIn: bn(amountIn),
    });
    const res = r as unknown as Record<string, BN>;
    const out = big(res.outputAmount!);
    return {
      amountIn, filledIn: big(res.includedFeeInputAmount!), amountOut: out,
      minOut: res.minimumAmountOut ? big(res.minimumAmountOut) : withSlippage(out, slippageBps),
      fee: big(res.tradingFee ?? new BN(0)) + big(res.protocolFee ?? new BN(0)) + big(res.referralFee ?? new BN(0)), venue: "curve",
    };
  }

  private async dammQuote(t: TradeTarget, side: Side, amountIn: bigint, slippageBps: number): Promise<TradeQuote> {
    const poolState = await this.cp.fetchPoolState(new PublicKey(t.dammPool!));
    const slot = await this.conn.getSlot("confirmed");
    const time = (await this.conn.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    const q = this.cp.getQuote({
      inAmount: bn(amountIn), inputTokenMint: new PublicKey(side === "buy" ? t.quoteMint : t.baseMint), slippage: slippageBps / 100,
      poolState, currentTime: time, currentSlot: slot, tokenADecimal: t.baseDecimals, tokenBDecimal: t.quoteDecimals,
    });
    const out = big(q.swapOutAmount);
    return { amountIn, filledIn: big(q.consumedInAmount), amountOut: out, minOut: withSlippage(out, slippageBps), fee: big(q.totalFee), venue: "damm" };
  }

  private async unsigned(tx: Transaction, owner: string) {
    tx.feePayer = new PublicKey(owner);
    tx.recentBlockhash = (await this.conn.getLatestBlockhash("confirmed")).blockhash;
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  }

  async buildSwapTx(t: TradeTarget, side: Side, amountIn: bigint, minOut: bigint, owner: string): Promise<string> {
    const user = new PublicKey(owner);
    if (t.dammPool) {
      const pool = new PublicKey(t.dammPool);
      const s = await this.cp.fetchPoolState(pool);
      const [input, output] = side === "buy" ? [s.tokenBMint, s.tokenAMint] : [s.tokenAMint, s.tokenBMint];
      const tx = await this.cp.swap({
        payer: user, pool, inputTokenMint: input, outputTokenMint: output, amountIn: bn(amountIn), minimumAmountOut: bn(minOut),
        tokenAMint: s.tokenAMint, tokenBMint: s.tokenBMint, tokenAVault: s.tokenAVault, tokenBVault: s.tokenBVault,
        tokenAProgram: getTokenProgram(s.tokenAFlag), tokenBProgram: getTokenProgram(s.tokenBFlag), referralTokenAccount: null, poolState: s,
      });
      return this.unsigned(tx, owner);
    }
    const tx = await this.dbc.pool.swap2({
      owner: user, pool: new PublicKey(t.pool), swapBaseForQuote: side === "sell", referralTokenAccount: null, payer: user,
      ...(side === "buy"
        ? { swapMode: SwapMode.PartialFill, amountIn: bn(amountIn), minimumAmountOut: bn(minOut) }
        : { swapMode: SwapMode.ExactIn, amountIn: bn(amountIn), minimumAmountOut: bn(minOut) }),
    });
    return this.unsigned(tx, owner);
  }
}
