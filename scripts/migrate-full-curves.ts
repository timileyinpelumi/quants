// Local only: on mainnet Meteora's keepers migrate full SOL curves; a local validator has none, so this stands in.
import { Connection } from "@solana/web3.js";
import { db } from "../src/db/client";
import { SolanaChain, loadKeypair } from "../src/chain/solana";
import { MeteoraLive } from "../src/meteora/port";

const e = process.env;
const conn = new Connection(e.RPC_URL!, "confirmed");
const chain = new SolanaChain(conn, loadKeypair(e.KEEPER_KEYPAIR!), loadKeypair(e.SPILL_KEYPAIR!));
const m = new MeteoraLive(chain, e.DAMM_V2_MIGRATION_CONFIG!);
const sql = db(e.DATABASE_URL);
for (const l of await sql`select mint, pool from launches where status = 'live'`) {
  const c = await m.curveState(l.pool).catch(() => null);
  if (!c?.complete || c.migrated) continue;
  const mig = await m.buildMigrate(l.pool);
  await mig.send();
  await chain.waitForConfirmation(mig.signature, mig.lastValidBlockHeight);
  console.log(`[migrate] ${l.mint}`);
}
process.exit(0);
