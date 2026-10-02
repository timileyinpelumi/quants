import { Connection } from "@solana/web3.js";
import { db } from "../src/db/client";
import { SolanaChain, loadKeypair } from "../src/chain/solana";
import { MeteoraLive } from "../src/meteora/port";
import { swapPortFor } from "../src/jupiter/select";
import { applyClusterDefaults } from "../src/cluster";
import { KaminoBackend } from "../src/staking/kamino";
import { runKeeper } from "../src/keeper/run";
import { localJupiter } from "./lib/local-jupiter";

const e = applyClusterDefaults(process.env);
const conn = new Connection(e.RPC_URL!, "confirmed");
const keeper = loadKeypair(e.KEEPER_KEYPAIR!);
const spill = loadKeypair(e.SPILL_KEYPAIR!);
const chain = new SolanaChain(conn, keeper, spill);
const r = await runKeeper({
  sql: db(e.DATABASE_URL),
  chain,
  meteora: new MeteoraLive(chain, e.DAMM_V2_MIGRATION_CONFIG!),
  jupiter: e.LOCAL_REWARD_MINTS ? localJupiter(chain, e.LOCAL_REWARD_MINTS.split(",")) : swapPortFor(e, chain),
  staking: new KaminoBackend(chain, e.RPC_URL!, e.KAMINO_GLOBAL_CONFIG!),
  wallets: { keeper: keeper.publicKey.toBase58(), spill: spill.publicKey.toBase58(), treasury: e.TREASURY_ADDRESS! },
  ourtokenMint: e.OURTOKEN_MINT!,
});
console.log(JSON.stringify(r));
process.exit(0);
