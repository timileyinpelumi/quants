import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { DynamicBondingCurveClient, deriveDbcPoolAddress, deriveDammV2PoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getTokenProgram } from "@meteora-ag/cp-amm-sdk";
import type { SignedTx } from "../chain/port";
import type { SolanaChain } from "../chain/solana";

export interface GraduatedPosition { dammPool: string; position: string; positionNftAccount: string }
export interface LaunchTxInput {
  name: string; symbol: string; uri: string; creator: string; configKey: string; quoteMint: string;
  launchFeeLamports: bigint; feeReceiver: string; devBuyQuoteAmount: bigint; devBuyMinOut: bigint;
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
  buildLaunchTx(input: LaunchTxInput): Promise<{ tx: Transaction; baseMint: Keypair; pool: string }>;
}

const pk = (s: string) => new PublicKey(s);

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

  async buildLaunchTx(input: LaunchTxInput) {
    const baseMint = Keypair.generate();
    const creator = pk(input.creator);
    const create = await this.dbc.creator.createPoolWithFirstBuy({
      createPoolParam: {
        name: input.name, symbol: input.symbol, uri: input.uri, payer: creator, poolCreator: creator,
        config: pk(input.configKey), baseMint: baseMint.publicKey,
      },
      firstBuyParam: input.devBuyQuoteAmount > 0n
        ? { buyer: creator, buyAmount: new BN(input.devBuyQuoteAmount.toString()), minimumAmountOut: new BN(input.devBuyMinOut.toString()), referralTokenAccount: null }
        : undefined,
    });
    const tx = new Transaction()
      .add(SystemProgram.transfer({ fromPubkey: creator, toPubkey: pk(input.feeReceiver), lamports: input.launchFeeLamports }))
      .add(...create.instructions);
    const { blockhash } = await this.chain.conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = creator;
    tx.partialSign(baseMint);
    const pool = deriveDbcPoolAddress(pk(input.quoteMint), baseMint.publicKey, pk(input.configKey)).toBase58();
    return { tx, baseMint, pool };
  }
}
