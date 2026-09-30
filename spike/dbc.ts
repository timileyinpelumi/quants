import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import {
  DynamicBondingCurveClient, buildCurve, ActivationType, BaseFeeMode, CollectFeeMode, MigrationOption, MigrationFeeOption,
  TokenDecimal, TokenType, TokenAuthorityOption, MigratedCollectFeeMode, DammV2DynamicFeeMode, deriveDbcPoolAddress,
  deriveDammV2PoolAddress, deriveTokenBadgeAddress, SwapMode, deriveDbcPoolAuthority, deriveDammV2PoolAuthority,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";

const conn = new Connection("http://127.0.0.1:8899", "confirmed");
const client = DynamicBondingCurveClient.create(conn, "confirmed");
const DAMM_CUSTOM = new PublicKey("A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck");

const send = async (label: string, tx: Transaction, signers: Keypair[]) => {
  try {
    const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
    return sig;
  } catch (e: any) {
    console.log(`FAILED ${label}:`, e.message?.split("\n")[0], (e.logs ?? e.transactionLogs ?? []).slice(-5));
    throw e;
  }
};

const params = (quoteDecimals: number, threshold: number) => buildCurve({
  token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: quoteDecimals, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
  fee: {
    baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 200, endingFeeBps: 200, numberOfPeriod: 0, totalDuration: 0 } },
    dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 0, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
  },
  migration: {
    migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.Customizable,
    migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    migratedPoolFee: { collectFeeMode: MigratedCollectFeeMode.QuoteToken, dynamicFee: DammV2DynamicFeeMode.Disabled, poolFeeBps: 200 },
  },
  liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 100, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 0, creatorLiquidityPercentage: 0 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Timestamp,
  percentageSupplyOnMigration: 20,
  migrationQuoteThreshold: threshold,
});

const keeper = Keypair.generate(), creator = Keypair.generate(), buyer = Keypair.generate();
for (const k of [keeper, creator, buyer]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 100 * LAMPORTS_PER_SOL));
// Mainnet pool authorities hold SOL used for migration rent; clones start at 0.
for (const a of [deriveDbcPoolAuthority(), deriveDammV2PoolAuthority()]) await conn.confirmTransaction(await conn.requestAirdrop(a, 10 * LAMPORTS_PER_SOL));

// 1. OURTOKEN quote without a token badge
const ours = await createMint(conn, keeper, keeper.publicKey, null, 6);
const buyerOurs = await getOrCreateAssociatedTokenAccount(conn, keeper, ours, buyer.publicKey);
await mintTo(conn, keeper, ours, buyerOurs.address, keeper, 10_000_000_000_000n);
let oursConfig: Keypair | null = Keypair.generate();
try {
  const tx = await client.partner.createConfig({ config: oursConfig.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey, quoteMint: ours, payer: keeper.publicKey, ...params(6, 1000) });
  await send("createConfig OURTOKEN", tx, [keeper, oursConfig]);
  console.log("1. OURTOKEN config created WITHOUT a badge");
} catch {
  console.log("1. OURTOKEN config needs a badge; badge PDA would be", deriveTokenBadgeAddress(ours).toBase58());
  oursConfig = null;
}

// 2. Full flow on whichever quote works: OURTOKEN if allowed, SOL always
async function flow(label: string, quoteMint: PublicKey, quoteDecimals: number, threshold: number, existingConfig: Keypair | null) {
  const config = existingConfig ?? Keypair.generate();
  if (!existingConfig) {
    const tx = await client.partner.createConfig({ config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey, quoteMint, payer: keeper.publicKey, ...params(quoteDecimals, threshold) });
    await send(`createConfig ${label}`, tx, [keeper, config]);
  }
  const baseMint = Keypair.generate();
  const create = await client.creator.createPoolWithFirstBuy({
    createPoolParam: { name: "Cat", symbol: "CAT", uri: "https://x.test/cat.json", payer: creator.publicKey, poolCreator: creator.publicKey, config: config.publicKey, baseMint: baseMint.publicKey },
  });
  await send(`createPool ${label}`, create, [creator, baseMint]);
  const pool = deriveDbcPoolAddress(quoteMint, baseMint.publicKey, config.publicKey);
  const unit = 10 ** quoteDecimals;
  for (let i = 0; i < 40; i++) {
    const p = await client.state.getPool(pool);
    const cfg = await client.state.getPoolConfig(config.publicKey);
    if (p!.poolState.quoteReserve.gte(cfg!.migrationQuoteThreshold)) break;
    const swap = await client.pool.swap2({ owner: buyer.publicKey, pool, swapMode: SwapMode.PartialFill, amountIn: new BN(Math.floor((threshold / 8) * unit)), minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null });
    await send(`buy ${i}`, swap, [buyer]);
  }
  const p = await client.state.getPool(pool);
  console.log(`2. [${label}] quoteReserve`, p!.poolState.quoteReserve.toString(), "isMigrated", p!.poolState.isMigrated, "migrationProgress", p!.poolState.migrationProgress);

  const m = await client.state.getPoolFeeMetrics(pool);
  console.log(`3. [${label}] partner quote fee`, m.current.partnerQuoteFee.toString(), "creator quote fee", m.current.creatorQuoteFee.toString());
  const lamportsBefore = await conn.getBalance(keeper.publicKey);
  let tokBefore = 0n;
  try { tokBefore = (await getAccount(conn, (await getOrCreateAssociatedTokenAccount(conn, keeper, quoteMint, keeper.publicKey)).address)).amount; } catch {}
  const claim = await client.partner.claimPartnerTradingFee({ feeClaimer: keeper.publicKey, payer: keeper.publicKey, pool, maxBaseAmount: new BN(0), maxQuoteAmount: m.current.partnerQuoteFee, receiver: keeper.publicKey });
  const claimSig = await send(`claim ${label}`, claim, [keeper]);
  const lamportsAfter = await conn.getBalance(keeper.publicKey);
  let tokAfter = 0n;
  try { tokAfter = (await getAccount(conn, (await getOrCreateAssociatedTokenAccount(conn, keeper, quoteMint, keeper.publicKey)).address)).amount; } catch {}
  const fee = (await conn.getTransaction(claimSig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }))!.meta!.fee;
  console.log(`4. [${label}] claim: lamports delta+fee`, lamportsAfter - lamportsBefore + fee, "quote ATA delta", tokAfter - tokBefore, "remaining partner fee", (await client.state.getPoolFeeMetrics(pool)).current.partnerQuoteFee.toString());

  const mig = await client.migration.migrateToDammV2({ payer: keeper.publicKey, pool, dammConfig: DAMM_CUSTOM });
  await send(`migrate ${label}`, mig.transaction, [keeper, mig.firstPositionNftKeypair, mig.secondPositionNftKeypair]);
  const after = await client.state.getPool(pool);
  const dammPool = deriveDammV2PoolAddress(DAMM_CUSTOM, baseMint.publicKey, quoteMint);
  const cp = new CpAmm(conn);
  const ps = await cp.fetchPoolState(dammPool);
  console.log(`5. [${label}] migrated: isMigrated`, after!.poolState.isMigrated, "damm pool", dammPool.toBase58(), "collectFeeMode", ps.collectFeeMode, "fee numerator", ps.poolFees.baseFee.cliffFeeNumerator?.toString?.());
  for (const who of [["keeper", keeper], ["creator", creator]] as const) {
    const pos = await cp.getUserPositionByPool(dammPool, who[1].publicKey);
    console.log(`6. [${label}] positions owned by ${who[0]}:`, pos.map((x) => ({ position: x.position.toBase58(), permanentLocked: x.positionState.permanentLockedLiquidity.toString(), unlocked: x.positionState.unlockedLiquidity.toString() })));
  }
  const keeperPos = (await cp.getUserPositionByPool(dammPool, keeper.publicKey))[0];
  if (keeperPos) {
    const claimPos = await cp.claimPositionFee({
      owner: keeper.publicKey, position: keeperPos.position, pool: dammPool, positionNftAccount: keeperPos.positionNftAccount,
      tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
      tokenAProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), tokenBProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    });
    await send(`claimPositionFee ${label}`, claimPos, [keeper]);
    console.log(`7. [${label}] claimPositionFee with no trades since migration succeeded`);
  }
}

if (oursConfig) await flow("OURTOKEN", ours, 6, 1000, oursConfig);
await flow("SOL", NATIVE_MINT, 9, 10, null);
