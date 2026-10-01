// Devnet check for non-SOL pairs: creates stand-in USDT and JUP mints (neither exists on devnet), a curve config per fee tier
// for each, then launches one pool per pair with a first buy paid in that pair token. Run: bun spike/devnet/quote-configs.ts
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { SolanaChain } from "../../src/chain/solana";
import { MeteoraLive } from "../../src/meteora/port";
import { buildQuantsConfig, configKeyName, FEE_TIERS_BPS } from "../../src/meteora/config";
import { quoteCoins } from "../../src/domain/quotes";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const DIR = join(homedir(), ".config", "quants");
const conn = new Connection(RPC, "confirmed");
const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await Bun.file(join(DIR, "devnet-keeper.json")).text())));
const client = DynamicBondingCurveClient.create(conn, "confirmed");
const meteora = new MeteoraLive(new SolanaChain(conn, keeper, Keypair.generate()), "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck");
const log = (m: string) => console.log(`[devnet] ${m}`);

log(`keeper ${keeper.publicKey.toBase58()}, ${(await conn.getBalance(keeper.publicKey)) / 1e9} SOL`);
const out: Record<string, unknown> = { network: "devnet", keeper: keeper.publicKey.toBase58(), quotes: {}, configKeys: {}, pools: {} };

for (const symbol of ["USDT", "JUP"] as const) {
  const coin = quoteCoins({}).find((c) => c.symbol === symbol)!;
  const mint = await createMint(conn, keeper, keeper.publicKey, null, coin.decimals);
  const ata = await getOrCreateAssociatedTokenAccount(conn, keeper, mint, keeper.publicKey);
  await mintTo(conn, keeper, mint, ata.address, keeper, 1_000_000n * 10n ** BigInt(coin.decimals));
  (out.quotes as Record<string, string>)[symbol] = mint.toBase58();
  log(`${symbol} stand-in mint ${mint.toBase58()}`);

  for (const bps of FEE_TIERS_BPS) {
    const config = Keypair.generate();
    const sig = await sendAndConfirmTransaction(conn, await client.partner.createConfig({
      config: config.publicKey, feeClaimer: keeper.publicKey, leftoverReceiver: keeper.publicKey, quoteMint: mint, payer: keeper.publicKey,
      ...buildQuantsConfig(bps, { mint: mint.toBase58(), decimals: coin.decimals, migrationQuoteThreshold: coin.graduation }),
    }), [keeper, config]);
    (out.configKeys as Record<string, string>)[configKeyName(mint.toBase58(), bps)] = config.publicKey.toBase58();
    log(`${symbol} ${bps / 100}% config ${config.publicKey.toBase58()} (${sig})`);
  }

  // A pool on the 2% config with a first buy of 10 tokens, paid in the stand-in pair token.
  const configKey = (out.configKeys as Record<string, string>)[configKeyName(mint.toBase58(), 200)]!;
  const { tx, baseMint, pool } = await meteora.buildLaunchTx({
    name: `${symbol} pair check`, symbol: `Q${symbol}`.slice(0, 10), uri: "https://example.com/q.json", creator: keeper.publicKey.toBase58(),
    configKey, quoteMint: mint.toBase58(), launchFeeLamports: 0n, feeReceiver: keeper.publicKey.toBase58(),
    devBuyQuoteAmount: 10n * 10n ** BigInt(coin.decimals), devBuyMinOut: 0n,
  });
  tx.partialSign(keeper);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const res = await conn.confirmTransaction(sig, "confirmed");
  if (res.value.err) throw new Error(`${symbol} pool launch failed: ${JSON.stringify(res.value.err)}`);
  (out.pools as Record<string, string>)[symbol] = pool;
  log(`${symbol} pool ${pool} for token ${baseMint.publicKey.toBase58()} (${sig})`);
}

await Bun.write(join(DIR, "devnet-quote-configs.json"), JSON.stringify(out, null, 2));
log(`wrote ${join(DIR, "devnet-quote-configs.json")}`);
process.exit(0);
