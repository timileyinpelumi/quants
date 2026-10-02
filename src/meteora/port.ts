import { Keypair, PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  DynamicBondingCurveClient, calculateQuoteToBaseFromAmountIn, deriveDbcPoolAddress, deriveDammV2PoolAddress, deriveTokenBadgeAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getTokenProgram } from "@meteora-ag/cp-amm-sdk";
import type { SignedTx } from "../chain/port";
import { buildQuantsConfig, type QuoteSpec } from "./config";
import type { SolanaChain } from "../chain/solana";

export interface GraduatedPosition { dammPool: string; position: string; positionNftAccount: string }
/** A config key that does not exist yet: the launcher's setup transaction creates it, signed by `config`. */
export interface NewConfig { config: Keypair; feeBps: number; quote: QuoteSpec; keeper: string }
export interface LaunchTxInput {
  name: string; symbol: string; uri: string; creator: string; configKey: string; quoteMint: string;
  devBuyQuoteAmount: bigint; devBuyMinOut: bigint;
  /** Lamports the launcher sends the keeper in the launch transaction, when the keeper is below its floor. */
  keeperTopUp?: { to: string; lamports: bigint };
}
export interface MeteoraPort {
  pendingPartnerQuoteFee(pool: string): Promise<bigint>;
  buildClaimPartnerFee(pool: string, maxQuote: bigint): Promise<SignedTx>;
  buildClaimPositionFee(p: GraduatedPosition): Promise<SignedTx>;
  curveState(pool: string): Promise<{ migrated: boolean; complete: boolean }>;
  poolInfo(pool: string): Promise<{ baseMint: string; config: string; creator: string } | null>;
  curveProgress(pool: string): Promise<{ quoteReserve: bigint; threshold: bigint; migrated: boolean }>;
  buildMigrate(pool: string): Promise<SignedTx>;
  findGraduatedPosition(configKey: string, baseMint: string, quoteMint: string): Promise<GraduatedPosition | null>;
  /** Pool creation, first buy and keeper top up against a config key that exists on chain, partially signed by the new mint. */
  buildLaunchTx(input: LaunchTxInput): Promise<{ tx: Transaction; baseMint: Keypair; pool: string }>;
  /** Creates a config key paid by `creator`, partially signed by the config keypair. It must confirm before the launch is built. */
  buildConfigTx(input: { creator: string; quoteMint: string; create: NewConfig }): Promise<Transaction>;
  /** Base units a first buy of `quoteAmount` takes from a fresh curve, before fees (an upper bound on what it receives). */
  firstBuyMaxOut(config: string | { feeBps: number; quote: QuoteSpec }, quoteAmount: bigint): Promise<bigint>;
  /** The parts of an on-chain config key quants checks before trusting it, or null when it does not exist. */
  configState(configKey: string): Promise<{ feeClaimer: string; quoteMint: string; threshold: bigint } | null>;
  /** Quote base units the curve of this config raises before it graduates. */
  configThreshold(configKey: string): Promise<bigint>;
}

const pk = (s: string) => new PublicKey(s);

/**
 * DBC rejects Token-2022 quote mints with extensions unless the config and each pool pass the mint's token badge,
 * which Meteora creates per mint. A Token-2022 mint without a badge (a plain local mint) is passed without one.
 */
export async function quoteTokenBadge(conn: Pick<Connection, "getAccountInfo">, quoteMint: PublicKey): Promise<PublicKey | undefined> {
  const info = await conn.getAccountInfo(quoteMint, "confirmed");
  if (!info?.owner.equals(TOKEN_2022_PROGRAM_ID)) return undefined;
  const badge = deriveTokenBadgeAddress(quoteMint);
  return (await conn.getAccountInfo(badge, "confirmed")) ? badge : undefined;
}

export class MeteoraLive implements MeteoraPort {
  private dbc: DynamicBondingCurveClient;
  private cp: CpAmm;
  constructor(private chain: SolanaChain, private dammMigrationConfig: string) {
    this.dbc = DynamicBondingCurveClient.create(chain.conn, "confirmed");
    this.cp = new CpAmm(chain.conn);
  }

  async pendingPartnerQuoteFee(pool: string) {
    const m = await this.dbc.state.getPoolFeeMetrics(pool);
    return BigInt(m.current.partnerQuoteFee.toString());
  }

  async buildClaimPartnerFee(pool: string, maxQuote: bigint) {
    const keeper = this.chain.keeper.publicKey;
    const tx = await this.dbc.partner.claimPartnerTradingFee({
      feeClaimer: keeper, payer: keeper, pool: pk(pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(maxQuote.toString()), receiver: keeper,
    });
    return this.chain.signLegacy(tx, []);
  }

  // No `receiver`: for SOL pools the SDK then needs a temp wSOL account; the keeper owns the position anyway.
  async buildClaimPositionFee(p: GraduatedPosition) {
    const state = await this.cp.fetchPoolState(pk(p.dammPool));
    const tx = await this.cp.claimPositionFee({
      owner: this.chain.keeper.publicKey, position: pk(p.position), pool: pk(p.dammPool), positionNftAccount: pk(p.positionNftAccount),
      tokenAMint: state.tokenAMint, tokenBMint: state.tokenBMint, tokenAVault: state.tokenAVault, tokenBVault: state.tokenBVault,
      tokenAProgram: getTokenProgram(state.tokenAFlag), tokenBProgram: getTokenProgram(state.tokenBFlag),
    });
    return this.chain.signLegacy(tx, []);
  }

  async curveState(pool: string) {
    const p = await this.dbc.state.getPool(pool);
    if (!p) throw new Error(`pool ${pool} not found`);
    const cfg = await this.dbc.state.getPoolConfig(p.poolState.config);
    if (!cfg) throw new Error(`config ${p.poolState.config.toBase58()} not found`);
    return { migrated: p.poolState.isMigrated !== 0, complete: p.poolState.quoteReserve.gte(cfg.migrationQuoteThreshold) };
  }

  async curveProgress(pool: string) {
    const p = await this.dbc.state.getPool(pool);
    if (!p) throw new Error(`pool ${pool} not found`);
    const cfg = await this.dbc.state.getPoolConfig(p.poolState.config);
    if (!cfg) throw new Error(`config ${p.poolState.config.toBase58()} not found`);
    return { quoteReserve: BigInt(p.poolState.quoteReserve.toString()), threshold: BigInt(cfg.migrationQuoteThreshold.toString()), migrated: p.poolState.isMigrated !== 0 };
  }

  async poolInfo(pool: string) {
    const p = await this.dbc.state.getPool(pool).catch(() => null);
    if (!p) return null;
    return { baseMint: p.poolState.baseMint.toBase58(), config: p.poolState.config.toBase58(), creator: p.poolState.creator.toBase58() };
  }

  async buildMigrate(pool: string) {
    const { transaction, firstPositionNftKeypair, secondPositionNftKeypair } = await this.dbc.migration.migrateToDammV2({
      payer: this.chain.keeper.publicKey, pool: pk(pool), dammConfig: pk(this.dammMigrationConfig),
    });
    return this.chain.signLegacy(transaction, [firstPositionNftKeypair, secondPositionNftKeypair]);
  }

  async findGraduatedPosition(_configKey: string, baseMint: string, quoteMint: string) {
    const dammPool = deriveDammV2PoolAddress(pk(this.dammMigrationConfig), pk(baseMint), pk(quoteMint));
    if (!(await this.chain.conn.getAccountInfo(dammPool, "confirmed"))) return null;
    const [first] = await this.cp.getUserPositionByPool(dammPool, this.chain.keeper.publicKey);
    if (!first) return null;
    return { dammPool: dammPool.toBase58(), position: first.position.toBase58(), positionNftAccount: first.positionNftAccount.toBase58() };
  }

  async firstBuyMaxOut(config: string | { feeBps: number; quote: QuoteSpec }, quoteAmount: bigint) {
    const amount = new BN(quoteAmount.toString());
    if (typeof config !== "string") {
      // Not on chain yet: the curve comes from the parameters the setup transaction creates it with, and ends at the migration price.
      const p = buildQuantsConfig(config.feeBps, config.quote);
      const points = p.curve.filter((c) => !c.sqrtPrice.isZero() && !c.liquidity.isZero());
      const r = calculateQuoteToBaseFromAmountIn({ curve: points } as any, p.sqrtStartPrice, amount, points.at(-1)!.sqrtPrice);
      return BigInt(r.outputAmount.toString());
    }
    const cfg = await this.dbc.state.getPoolConfig(config);
    if (!cfg) throw new Error(`config ${config} not found`);
    const r = calculateQuoteToBaseFromAmountIn(cfg, cfg.sqrtStartPrice, amount, cfg.migrationSqrtPrice);
    return BigInt(r.outputAmount.toString());
  }

  async configState(configKey: string) {
    const cfg = await this.dbc.state.getPoolConfig(configKey).catch(() => null);
    if (!cfg) return null;
    return { feeClaimer: cfg.feeClaimer.toBase58(), quoteMint: cfg.quoteMint.toBase58(), threshold: BigInt(cfg.migrationQuoteThreshold.toString()) };
  }

  async configThreshold(configKey: string) {
    const cfg = await this.dbc.state.getPoolConfig(configKey);
    if (!cfg) throw new Error(`config ${configKey} not found`);
    return BigInt(cfg.migrationQuoteThreshold.toString());
  }

  async buildLaunchTx(input: LaunchTxInput) {
    const baseMint = Keypair.generate();
    const creator = pk(input.creator);
    const tokenBadge = await quoteTokenBadge(this.chain.conn, pk(input.quoteMint));
    const firstBuyParam = input.devBuyQuoteAmount > 0n
      ? { buyer: creator, buyAmount: new BN(input.devBuyQuoteAmount.toString()), minimumAmountOut: new BN(input.devBuyMinOut.toString()), referralTokenAccount: null }
      : undefined;
    const tx = await this.dbc.creator.createPoolWithFirstBuy({
      createPoolParam: { name: input.name, symbol: input.symbol, uri: input.uri, payer: creator, poolCreator: creator, config: pk(input.configKey), baseMint: baseMint.publicKey, tokenBadge },
      firstBuyParam,
    });
    if (input.keeperTopUp && input.keeperTopUp.lamports > 0n) {
      tx.add(SystemProgram.transfer({ fromPubkey: creator, toPubkey: pk(input.keeperTopUp.to), lamports: input.keeperTopUp.lamports }));
    }
    tx.recentBlockhash = (await this.chain.conn.getLatestBlockhash("confirmed")).blockhash;
    tx.feePayer = creator;
    tx.partialSign(baseMint);
    const pool = deriveDbcPoolAddress(pk(input.quoteMint), baseMint.publicKey, pk(input.configKey)).toBase58();
    return { tx, baseMint, pool };
  }

  async buildConfigTx(input: { creator: string; quoteMint: string; create: NewConfig }) {
    const c = input.create;
    const keeper = pk(c.keeper);
    const creator = pk(input.creator);
    const quoteMint = pk(input.quoteMint);
    const tx = await this.dbc.partner.createConfig({
      config: c.config.publicKey, feeClaimer: keeper, leftoverReceiver: keeper, quoteMint, payer: creator,
      tokenBadge: await quoteTokenBadge(this.chain.conn, quoteMint),
      ...buildQuantsConfig(c.feeBps, c.quote),
    });
    tx.recentBlockhash = (await this.chain.conn.getLatestBlockhash("confirmed")).blockhash;
    tx.feePayer = creator;
    tx.partialSign(c.config);
    return tx;
  }

}
