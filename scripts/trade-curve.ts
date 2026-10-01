// Local only: buys and sells a launched token on its curve so its fees add up. Usage: trade-curve.ts <mint> <rounds> [sol per buy]
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DynamicBondingCurveClient, SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { db } from "../src/db/client";

const [mint, rounds = "1", solPerBuy = "5"] = process.argv.slice(2);
if (!mint) throw new Error("usage: trade-curve.ts <mint> <rounds> [sol per buy]");
const conn = new Connection(process.env.RPC_URL!, "confirmed");
const sql = db(process.env.DATABASE_URL);
const [launch] = await sql`select pool from launches where mint = ${mint}`;
if (!launch) throw new Error(`no launch for ${mint}`);
await sql.close();

const trader = Keypair.generate();
const buy = Math.round(Number(solPerBuy) * LAMPORTS_PER_SOL);
// Each round loses the fee on both sides; 12% of a buy per round covers the 3% tier.
await conn.confirmTransaction(await conn.requestAirdrop(trader.publicKey, Math.ceil(buy * (1 + 0.12 * Number(rounds))) + LAMPORTS_PER_SOL), "confirmed");
const client = DynamicBondingCurveClient.create(conn, "confirmed");
const pool = new PublicKey(launch.pool);
const ata = getAssociatedTokenAddressSync(new PublicKey(mint), trader.publicKey);
const swap = async (amountIn: BN, sell: boolean) => sendAndConfirmTransaction(conn, await client.pool.swap2({
  owner: trader.publicKey, pool, swapMode: SwapMode.PartialFill, amountIn, minimumAmountOut: new BN(0), swapBaseForQuote: sell, referralTokenAccount: null,
}), [trader]);

let volume = 0;
for (let i = 0; i < Number(rounds); i++) {
  const before = await conn.getBalance(trader.publicKey);
  await swap(new BN(buy), false);
  const tokens = (await conn.getTokenAccountBalance(ata)).value.amount;
  await swap(new BN(tokens), true);
  volume += buy + (buy - (before - (await conn.getBalance(trader.publicKey))));
}
console.log(JSON.stringify({ mint, rounds: Number(rounds), volumeSol: volume / LAMPORTS_PER_SOL }));
