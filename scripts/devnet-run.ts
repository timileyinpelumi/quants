// Drives one launch through its whole life on devnet with two throwaway wallets funded by the keeper, running the
// keeper in process between steps, then writes docs/devnet-readiness.md.
//
//   bun --env-file=.env.devnet scripts/devnet-run.ts [--round-trip-sol 0.5] [--max-round-trips 60] [--state devnet-run-state.json]
//
// Needs the devnet env from scripts/devnet-bootstrap.ts (devnet.env and devnet.secrets.env) plus DATABASE_URL for a
// database used only for devnet. Resumable: finished steps are kept in the state file and skipped on the next run; delete
// the file to start a new launch.
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { applyClusterDefaults, clusterOf, configKeysPath, explorerTx } from "../src/cluster";
import { db } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { SolanaChain, loadKeypair } from "../src/chain/solana";
import { MeteoraLive } from "../src/meteora/port";
import { TradeLive, type Side, type TradeTarget } from "../src/meteora/trade";
import { KaminoBackend } from "../src/staking/kamino";
import { swapPortFor } from "../src/jupiter/select";
import { poolTokens } from "../src/jupiter/damm";
import { defaultSettings, loadLatestSettings, saveSettings } from "../src/domain/settings";
import { prepareLaunch } from "../src/launch/prepare";
import { confirmLaunch } from "../src/launch/confirm";
import { runKeeper, ReconcileError } from "../src/keeper/run";
import { NATIVE_MINT } from "../src/domain/types";
import { uploadsFrom } from "../src/web/server/uploads";
import { arg, keypairOf, loadState, num, printBudget, runBudget, saveState, secretOf, sendSigned, sendTx, sol, withRetries, type SecretKey } from "./lib/devnet";
import { staticConfigs } from "../src/launch/config-keys";

const e = applyClusterDefaults(process.env);
if (clusterOf(e) !== "devnet") throw new Error("devnet-run only runs with CLUSTER=devnet");
for (const k of ["DATABASE_URL", "RPC_URL", "KEEPER_KEYPAIR", "SPILL_KEYPAIR", "TREASURY_ADDRESS", "OURTOKEN_MINT", "KAMINO_GLOBAL_CONFIG", "DAMM_V2_MIGRATION_CONFIG", "DEVNET_TOKENS"]) {
  if (!e[k]) throw new Error(`${k} is not set; merge devnet.env and devnet.secrets.env from scripts/devnet-bootstrap.ts and set DATABASE_URL`);
}

const STATE = arg("--state") ?? "devnet-run-state.json";
const REPORT = "docs/devnet-readiness.md";
const ROUND_TRIP_SOL = num("--round-trip-sol", 0.5);
const MAX_ROUND_TRIPS = num("--max-round-trips", 60);
const FEE_TIER_BPS = 300;
const DEVNET_SLIPPAGE_BPS = 500;
const SPEND = 0.2;

interface TxRow { step: string; who: string; sig: string; fee?: number }
interface PassRow { step: string; at: string; errors: { launchId: number; error: string }[]; rows: { kind: string; status: string; signature: string | null; error: string | null }[] }
interface RunState {
  startedAt?: string;
  keeperStart?: number;
  wallets?: { a: SecretKey; b: SecretKey };
  prepared?: { mint: string; pool: string; sig: string };
  launch?: { id: number; mint: string; pool: string; uri: string };
  steps: Record<string, { result: string; at: string }>;
  roundTrips: number;
  txs: TxRow[];
  passes: PassRow[];
  notes: string[];
}

const state = loadState<RunState>(STATE, { steps: {}, roundTrips: 0, txs: [], passes: [], notes: [] });
state.notes = state.notes.filter((n) => !n.startsWith("Stopped with an error"));
const save = () => saveState(STATE, state);
const note = (m: string) => { if (!state.notes.includes(m)) state.notes.push(m); save(); };
const log = (m: string) => console.log(`[devnet-run] ${m}`);
const link = (sig: string) => explorerTx(sig, "devnet");

const conn = new Connection(e.RPC_URL!, "confirmed");
const keeper = loadKeypair(e.KEEPER_KEYPAIR!);
const spill = loadKeypair(e.SPILL_KEYPAIR!);
const chain = new SolanaChain(conn, keeper, spill);
const meteora = new MeteoraLive(chain, e.DAMM_V2_MIGRATION_CONFIG!);
const jupiter = swapPortFor(e, chain);
const staking = new KaminoBackend(chain, e.RPC_URL!, e.KAMINO_GLOBAL_CONFIG ?? "");
const trade = new TradeLive(conn);
const sql = db(e.DATABASE_URL, 4);
const configKeys: Record<string, string> = JSON.parse(e.CONFIG_KEYS ?? readFileSync(configKeysPath(e), "utf8"));
const deps = {
  sql, chain, meteora, jupiter, staking,
  wallets: { keeper: keeper.publicKey.toBase58(), spill: spill.publicKey.toBase58(), treasury: e.TREASURY_ADDRESS! },
};

if (!state.wallets) {
  state.wallets = { a: secretOf(Keypair.generate()), b: secretOf(Keypair.generate()) };
  state.startedAt = new Date().toISOString();
  state.keeperStart = await conn.getBalance(keeper.publicKey);
  save();
}
const A = keypairOf(state.wallets.a), B = keypairOf(state.wallets.b);
const who = (k: Keypair) => (k.publicKey.equals(A.publicKey) ? "wallet A" : k.publicKey.equals(B.publicKey) ? "wallet B" : "keeper");

async function walletTx(step: string, signer: Keypair, build: () => Promise<Transaction>): Promise<string> {
  const sig = await withRetries(`${step} (${who(signer)})`, async () => sendTx(conn, await build(), [signer]));
  state.txs.push({ step, who: who(signer), sig });
  save();
  log(`  ${who(signer)} ${link(sig)}`);
  return sig;
}
const fromBase64 = (b64: string) => Transaction.from(Buffer.from(b64, "base64"));

async function step(name: string, fn: () => Promise<string>) {
  if (state.steps[name]) { log(`${name}: done earlier (${state.steps[name]!.result})`); return; }
  log(`${name}`);
  const result = await fn();
  state.steps[name] = { result, at: new Date().toISOString() };
  save();
  log(`  ${result}`);
  await writeReport();
}

async function keeperPass(stepName: string): Promise<PassRow> {
  const [{ max }] = await sql`select coalesce(max(id), 0)::bigint as max from distributions`;
  let r;
  try {
    r = await runKeeper(deps);
  } catch (err) {
    if (err instanceof ReconcileError) throw new Error(`keeper stopped on a ReconcileError: ${err.message}`);
    throw err;
  }
  const rows = (await sql`select kind, status, signature, error from distributions where id > ${max} order by id`).map((x: any) => ({ kind: x.kind, status: x.status, signature: x.signature, error: x.error }));
  const pass: PassRow = { step: stepName, at: new Date().toISOString(), errors: r.errors, rows };
  state.passes.push(pass);
  save();
  for (const row of rows) log(`  keeper ${row.kind} ${row.status}${row.signature ? ` ${link(row.signature)}` : ""}${row.error ? ` (${row.error})` : ""}`);
  for (const er of r.errors) log(`  keeper error: ${er.error}`);
  return pass;
}

const launchRow = async () => (await sql`select l.id, l.status, l.damm_pool, sp.status as stake_status, sp.basket_value_lamports, sp.rent_lamports
  from launches l left join stake_pools sp on sp.launch_id = l.id where l.id = ${state.launch!.id}`)[0];
const target = (dammPool: string | null): TradeTarget => ({ pool: state.launch!.pool, dammPool, baseMint: state.launch!.mint, quoteMint: NATIVE_MINT, baseDecimals: 6, quoteDecimals: 9 });
const held = async (k: Keypair) => {
  try { return BigInt((await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(state.launch!.mint), k.publicKey), "confirmed")).value.amount); }
  catch { return 0n; }
};
async function swap(stepName: string, k: Keypair, side: Side, amountIn: bigint, dammPool: string | null = null) {
  return walletTx(stepName, k, async () => {
    const q = await trade.quote(target(dammPool), side, amountIn, DEVNET_SLIPPAGE_BPS);
    return fromBase64(await trade.buildSwapTx(target(dammPool), side, amountIn, q.minOut, k.publicKey.toBase58()));
  });
}

// ---- steps ----

async function lifecycle() {

const budget = runBudget({ roundTripSol: ROUND_TRIP_SOL, solGraduation: Number(JSON.parse(e.QUOTE_GRADUATIONS ?? "{}").SOL ?? 2), feeTierBps: FEE_TIER_BPS, basketSize: 3 });
const walletATarget = budget.total - SPEND * LAMPORTS_PER_SOL;
const walletBTarget = SPEND * LAMPORTS_PER_SOL;

await step("fund wallets", async () => {
  printBudget("Budget for this run:", budget);
  const need = Math.max(0, walletATarget - (await conn.getBalance(A.publicKey))) + Math.max(0, walletBTarget - (await conn.getBalance(B.publicKey)));
  const have = await conn.getBalance(keeper.publicKey);
  if (have < need + 0.2 * LAMPORTS_PER_SOL) {
    throw new Error(`the keeper has ${sol(have)} SOL and this run needs about ${sol(need + 0.2 * LAMPORTS_PER_SOL)} SOL (wallets plus 0.2 SOL for keeper fees). Fund ${keeper.publicKey.toBase58()} and run again.`);
  }
  for (const [k, want] of [[A, walletATarget], [B, walletBTarget]] as const) {
    const short = want - (await conn.getBalance(k.publicKey));
    if (short <= 0) continue;
    const sig = await withRetries(`fund ${who(k)}`, async () => {
      const left = want - (await conn.getBalance(k.publicKey));
      if (left <= 0) return "already funded";
      return sendTx(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: k.publicKey, lamports: Math.round(left) })), [keeper]);
    });
    state.txs.push({ step: "fund wallets", who: "keeper", sig });
    log(`  ${who(k)} ${k.publicKey.toBase58()} ${link(sig)}`);
  }
  return `wallet A ${A.publicKey.toBase58()} ${sol(walletATarget)} SOL, wallet B ${B.publicKey.toBase58()} ${sol(walletBTarget)} SOL`;
});

await step("settings", async () => {
  await migrate(sql);
  const [any] = await sql`select 1 from settings limit 1`;
  if (!any) {
    await saveSettings(sql, { ...defaultSettings(e.OURTOKEN_MINT!), slippageBps: DEVNET_SLIPPAGE_BPS }, "devnet-run");
    return `saved default settings with a ${DEVNET_SLIPPAGE_BPS / 100}% slippage cap`;
  }
  const s = await loadLatestSettings(sql);
  if (s.slippageBps >= DEVNET_SLIPPAGE_BPS) return `kept settings version ${s.version}`;
  const { version: _v, ...rest } = s;
  await saveSettings(sql, { ...rest, slippageBps: DEVNET_SLIPPAGE_BPS }, "devnet-run");
  return `raised the slippage cap from ${s.slippageBps / 100}% to ${DEVNET_SLIPPAGE_BPS / 100}%`;
});
note(`The keeper's slippage cap is ${DEVNET_SLIPPAGE_BPS / 100}% (mainnet default 1%): the stand-in pools hold about 0.3 SOL a side, so a keeper swap of 0.01 SOL already moves the price about 3%.`);

await step("launch", async () => {
  const tokens = poolTokens(e);
  const pick = (symbol: string) => {
    const t = tokens.find((x) => x.symbol === symbol);
    if (!t) throw new Error(`${symbol} is not in DEVNET_TOKENS`);
    return t;
  };
  const basket = [["dZEC", 5000], ["dJUP", 3000], ["dBONK", 2000]] as const;
  if (state.prepared && (await conn.getAccountInfo(new PublicKey(state.prepared.pool)))) {
    log("  launch transaction landed on an earlier run");
  } else {
    let uri = "https://example.com/devnet-cat.json";
    try {
      const up = uploadsFrom(e);
      const image = await up.uploadImage(new File([readFileSync("public/brand/quants-mark-512.png")], "dcat.png", { type: "image/png" }), "dcat.png");
      uri = await up.uploadJson({ name: "Devnet Cat", symbol: "DCAT", description: "quants devnet run", image }, "DCAT.json");
    } catch (err) {
      note(`Launch metadata was not uploaded (${String(err).slice(0, 120)}); the launch uses a placeholder URI.`);
    }
    const p = await prepareLaunch(
      { sql, meteora, configFor: staticConfigs(configKeys), quoteMints: [NATIVE_MINT], isVerified: (m) => jupiter.isVerified(m),
        tokenProgramOf: async (m) => (await conn.getAccountInfo(new PublicKey(m)))?.owner.toBase58() ?? "" },
      { name: "Devnet Cat", symbol: "DCAT", uri, creator: A.publicKey.toBase58(), quoteMint: NATIVE_MINT, feeTierBps: FEE_TIER_BPS,
        basket: basket.map(([s, w]) => ({ mint: pick(s).mint, symbol: s, decimals: pick(s).decimals, weightBps: w })), devBuyQuoteAmount: String(0.05 * LAMPORTS_PER_SOL) },
    );
    const tx = fromBase64(p.transaction);
    tx.partialSign(A);
    state.prepared = { mint: p.mint, pool: p.pool, sig: bs58.encode(tx.signature!) };
    save();
    // Bounded by the prepared blockhash: sendSigned gives up once it expires, and the next run prepares a new launch.
    const sig = await sendSigned(conn, tx).catch((err) => { state.prepared = undefined; save(); throw err; });
    state.txs.push({ step: "launch", who: "wallet A", sig });
    log(`  wallet A ${link(sig)}`);
  }
  const id = await withRetries("confirm launch", () => confirmLaunch({ sql, conn, meteora, spillWallet: spill.publicKey }, { signature: state.prepared!.sig, mint: state.prepared!.mint }));
  state.launch = { id, mint: state.prepared!.mint, pool: state.prepared!.pool, uri: "" };
  return `DCAT ${state.launch.mint} on pool ${state.launch.pool}, 3% fee, basket dZEC 50% dJUP 30% dBONK 20%`;
});

await step("trade until staking opens", async () => {
  // RETRY-LOOP-SAFETY: bounded by MAX_ROUND_TRIPS (state.roundTrips persists across restarts) and a keeper pass every 5.
  while (state.roundTrips < MAX_ROUND_TRIPS) {
    const l = await launchRow();
    if (l.stake_status === "ready") break;
    const { quoteReserve, threshold } = await meteora.curveProgress(state.launch!.pool);
    // Stay well under the graduation target so a round trip never completes the curve.
    const room = (threshold - quoteReserve) / 2n;
    const size = BigInt(Math.round(ROUND_TRIP_SOL * LAMPORTS_PER_SOL)) < room ? BigInt(Math.round(ROUND_TRIP_SOL * LAMPORTS_PER_SOL)) : room;
    if (size < 10_000_000n) throw new Error("the curve is too close to graduating to keep trading; raise --sol-graduation on the bootstrap");
    const before = await held(A);
    await swap("trade until staking opens", A, "buy", size);
    const got = (await held(A)) - before;
    if (got > 0n) await swap("trade until staking opens", A, "sell", got);
    state.roundTrips++;
    save();
    if (state.roundTrips % 5 === 0) {
      await keeperPass("trade until staking opens");
      const after = await launchRow();
      log(`  ${state.roundTrips} round trips; stakers' share covers ${Number(after.rent_lamports) > 0 ? Math.floor((Number(after.basket_value_lamports) * 100) / Number(after.rent_lamports)) : 0}% of the farm rent`);
    }
  }
  const l = await launchRow();
  if (l.stake_status !== "ready") throw new Error(`staking did not open after ${state.roundTrips} round trips; run again with a higher --max-round-trips`);
  return `staking opened after ${state.roundTrips} round trips of up to ${ROUND_TRIP_SOL} SOL`;
});

await step("keeper pass after staking opens", async () => {
  const p = await keeperPass("keeper pass after staking opens");
  const all = state.passes.flatMap((x) => x.rows);
  const kinds = (k: string) => all.filter((r) => r.kind === k && r.status === "confirmed").length;
  if (kinds("swap") === 0) note("No reward swap confirmed by this point: either the basket left after the farm rent was too small to quote, or every quote moved the pool more than the slippage cap.");
  return `confirmed so far: claim ${kinds("claim")}, split ${kinds("split")}, rent ${kinds("rent")}, swap ${kinds("swap")}, fund ${kinds("fund")}, payout ${kinds("payout")}; ${p.errors.length} errors this pass`;
});

const farmOf = async (tier: string) => (await sql`select farm from stake_tiers where launch_id = ${state.launch!.id} and tier_id = ${tier}`)[0]?.farm as string;

await step("stake from both wallets", async () => {
  const out: string[] = [];
  for (const [k, tier, buy] of [[A, "1d", 0.05], [B, "7d", 0.05]] as const) {
    if ((await held(k)) === 0n) await swap("stake from both wallets", k, "buy", BigInt(Math.round(buy * LAMPORTS_PER_SOL)));
    const farm = await farmOf(tier);
    if (!farm) throw new Error(`tier ${tier} has no farm`);
    const pos = await staking.position(k.publicKey.toBase58(), farm);
    if (pos && pos.staked > 0n) { out.push(`${who(k)} already staked in ${tier}`); continue; }
    const amount = await held(k);
    await walletTx("stake from both wallets", k, async () => fromBase64(await staking.buildStakeTx(k.publicKey.toBase58(), farm, state.launch!.mint, amount)));
    out.push(`${who(k)} staked ${amount} base units in ${tier}`);
  }
  return out.join("; ");
});

await step("exit early from wallet B", async () => {
  const farm = await farmOf("7d");
  const pos = await staking.position(B.publicKey.toBase58(), farm);
  if (!pos || pos.staked === 0n) return "nothing staked (exited on an earlier run)";
  await walletTx("exit early from wallet B", B, async () => fromBase64(await staking.buildExitTx(B.publicKey.toBase58(), farm, state.launch!.mint)));
  return `wallet B left the 7d tier with ${pos.staked} base units staked; ${await held(B)} came back`;
});

await step("keeper burns the penalty", async () => {
  // RETRY-LOOP-SAFETY: at most 3 keeper passes, 20 seconds apart.
  for (let i = 0; i < 3; i++) {
    await keeperPass("keeper burns the penalty");
    const [burn] = await sql`select detail->>'amount' as amount, signature from distributions where launch_id = ${state.launch!.id} and kind = 'burn' and status = 'confirmed' order by id desc limit 1`;
    if (burn) return `burned ${burn.amount} base units of DCAT ${link(burn.signature)}`;
    await Bun.sleep(20_000);
  }
  note("The early exit penalty was not burned within 3 keeper passes.");
  return "no confirmed burn after 3 keeper passes";
});

await step("payout to creator", async () => {
  const [p] = await sql`select detail, signature from distributions where launch_id = ${state.launch!.id} and kind = 'payout' and status = 'confirmed' order by id limit 1`;
  if (p) return `paid the creator ${link(p.signature)}`;
  await keeperPass("payout to creator");
  const [q] = await sql`select signature from distributions where launch_id = ${state.launch!.id} and kind = 'payout' and status = 'confirmed' order by id limit 1`;
  if (q) return `paid the creator ${link(q.signature)}`;
  note("No creator payout: the creator share stayed under the minimum payout.");
  return "no payout yet (creator share under the minimum)";
});

await step("trade until graduation", async () => {
  // RETRY-LOOP-SAFETY: at most 5 buys; each partial-fill buy is sized to the remaining room plus 10%.
  for (let i = 0; i < 5; i++) {
    const { quoteReserve, threshold, migrated } = await meteora.curveProgress(state.launch!.pool);
    if (migrated || quoteReserve >= threshold) break;
    const room = threshold - quoteReserve;
    await swap("trade until graduation", A, "buy", (room * 110n) / 100n + 10_000_000n);
  }
  const { quoteReserve, threshold } = await meteora.curveProgress(state.launch!.pool);
  if (quoteReserve < threshold) throw new Error("the curve did not fill");
  return `curve raised ${sol(quoteReserve)} SOL of ${sol(threshold)}`;
});

await step("migration to DAMM v2", async () => {
  // RETRY-LOOP-SAFETY: at most 5 keeper passes, 15 seconds apart (migrate, then record the graduated position).
  for (let i = 0; i < 5; i++) {
    const l = await launchRow();
    if (l.status === "graduated") break;
    await keeperPass("migration to DAMM v2");
    await Bun.sleep(15_000);
  }
  const l = await launchRow();
  if (l.status !== "graduated") throw new Error("the launch did not graduate within 5 keeper passes");
  const [m] = await sql`select signature from distributions where launch_id = ${state.launch!.id} and kind = 'migrate' and status = 'confirmed'`;
  if (!m) note("Meteora's own migrator moved the curve to DAMM v2 before the keeper did; the keeper only recorded the graduated position.");
  return `graduated to DAMM v2 pool ${l.damm_pool}${m ? `, migrated by the keeper ${link(m.signature)}` : ", migrated by Meteora"}`;
});

await step("trade on DAMM v2 and keeper pass after graduation", async () => {
  const l = await launchRow();
  const half = (await held(A)) / 2n;
  if (half > 0n) await swap("trade on DAMM v2 and keeper pass after graduation", A, "sell", half, l.damm_pool);
  const p = await keeperPass("trade on DAMM v2 and keeper pass after graduation");
  return `sold ${half} base units on DAMM v2; keeper pass: ${p.rows.map((r) => `${r.kind} ${r.status}`).join(", ") || "nothing to do"}${p.errors.length ? `; errors: ${p.errors.map((x) => x.error).join("; ")}` : ""}`;
});

await step("return wallet SOL to the keeper", async () => {
  const out: string[] = [];
  for (const k of [A, B]) {
    const bal = await conn.getBalance(k.publicKey);
    const send = bal - 5_000;
    if (send <= 0) continue;
    await walletTx("return wallet SOL to the keeper", k, async () => new Transaction().add(SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: keeper.publicKey, lamports: send })));
    out.push(`${who(k)} returned ${sol(send)} SOL`);
  }
  return out.join("; ") || "nothing to return";
});

}

try {
  await lifecycle();
} catch (err) {
  note(`Stopped with an error: ${String(err).slice(0, 300)}. Run the script again to resume from the failed step.`);
  await writeReport().catch(() => {});
  console.error(`[devnet-run] stopped: ${String(err)}`);
  process.exit(1);
}
await writeReport(true);
log(`wrote ${REPORT}`);
process.exit(0);

// ---- report ----

async function fees() {
  const missing = state.txs.filter((t) => t.fee === undefined).map((t) => t.sig);
  const keeperSigs = state.passes.flatMap((p) => p.rows.map((r) => r.signature)).filter((s): s is string => !!s);
  const out = new Map<string, number>();
  // RETRY-LOOP-SAFETY: one pass over at most 500 signatures, 10 per request, each request retried by withRetries (4 tries).
  const all = [...new Set([...missing, ...keeperSigs])].slice(0, 500);
  for (let i = 0; i < all.length; i += 10) {
    const chunk = all.slice(i, i + 10);
    const txs = await withRetries("fees", () => conn.getTransactions(chunk, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })).catch(() => []);
    txs.forEach((t, j) => { if (t?.meta) out.set(chunk[j]!, t.meta.fee); });
  }
  for (const t of state.txs) if (t.fee === undefined && out.has(t.sig)) t.fee = out.get(t.sig);
  save();
  return out;
}

async function writeReport(final = false) {
  const keeperFees = final ? await fees() : new Map<string, number>();
  const lines: string[] = [];
  lines.push("# Devnet readiness", "");
  lines.push(`Run started ${state.startedAt ?? "-"}${final ? `, finished ${new Date().toISOString()}` : " (in progress)"}. Written by \`scripts/devnet-run.ts\`.`, "");
  lines.push(`- RPC: ${new URL(e.RPC_URL!).host}`);
  lines.push(`- Keeper: ${keeper.publicKey.toBase58()}${state.keeperStart !== undefined ? ` (${sol(state.keeperStart)} SOL at the start, ${sol(await conn.getBalance(keeper.publicKey))} SOL now)` : ""}`);
  lines.push(`- Wallet A (creator, trader, 1d staker): ${A.publicKey.toBase58()}`);
  lines.push(`- Wallet B (7d staker, exits early): ${B.publicKey.toBase58()}`);
  if (state.launch) lines.push(`- Launch: DCAT \`${state.launch.mint}\`, curve \`${state.launch.pool}\``);
  lines.push("");
  lines.push("## Steps", "", "| Step | Result | Wallet txs | Keeper txs | Fees (SOL) |", "|---|---|---|---|---|");
  for (const [name, s] of Object.entries(state.steps)) {
    const wallet = state.txs.filter((t) => t.step === name);
    const kept = state.passes.filter((p) => p.step === name).flatMap((p) => p.rows.map((r) => r.signature)).filter((x): x is string => !!x);
    const fee = wallet.reduce((a, t) => a + (t.fee ?? 0), 0) + kept.reduce((a, sig) => a + (keeperFees.get(sig) ?? 0), 0);
    lines.push(`| ${name} | ${s.result.replace(/\|/g, "/")} | ${wallet.length} | ${kept.length} | ${final ? sol(fee) : "-"} |`);
  }
  lines.push("");
  lines.push("## Keeper passes", "");
  for (const p of state.passes) {
    const counts = new Map<string, number>();
    for (const r of p.rows) counts.set(`${r.kind} ${r.status}`, (counts.get(`${r.kind} ${r.status}`) ?? 0) + 1);
    lines.push(`- ${p.at} (${p.step}): ${[...counts].map(([k, n]) => `${k} x${n}`).join(", ") || "no steps"}${p.errors.length ? `. Errors: ${p.errors.map((x) => x.error).join("; ")}` : ""}`);
    for (const r of p.rows.filter((x) => x.error)) lines.push(`  - ${r.kind} ${r.status}: ${r.error}`);
  }
  lines.push("");
  lines.push("## Different from localnet", "");
  lines.push("- Swaps go through DAMM v2 pools of stand-in tokens (dZEC, dJUP, dBONK, dWIF, dCATE, QUANTS) against SOL, with real on-chain swaps and a minimum out, instead of Jupiter (mainnet) or minting the output (localnet).");
  lines.push("- SOL and devnet USDC are priced from mainnet Jupiter prices; stand-ins and QUANTS from their pool price times SOL.");
  lines.push("- Graduation targets are low (2 SOL, 300 USDC) so one run can fill a curve.");
  lines.push("- Token to token swaps have no route, so a QUANTS or USDC launch only buys rewards with the SOL left after its rent swap, and a USDC launch cannot open staking (there is no USDC pool).");
  for (const n of state.notes) lines.push(`- ${n}`);
  lines.push("");
  lines.push("## Transactions", "");
  for (const t of state.txs) lines.push(`- ${t.step}, ${t.who}: [${t.sig.slice(0, 16)}...](${link(t.sig)})${t.fee !== undefined ? ` fee ${t.fee} lamports` : ""}`);
  for (const p of state.passes) for (const r of p.rows.filter((x) => x.signature)) lines.push(`- ${p.step}, keeper ${r.kind} ${r.status}: [${r.signature!.slice(0, 16)}...](${link(r.signature!)})`);
  await Bun.write(REPORT, lines.join("\n") + "\n");
}
