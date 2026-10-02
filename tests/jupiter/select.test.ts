import { test, expect } from "bun:test";
import { Connection, Keypair } from "@solana/web3.js";
import { SolanaChain } from "../../src/chain/solana";
import { JupiterLive } from "../../src/jupiter/port";
import { DammSwap } from "../../src/jupiter/damm";
import { JupiterPrices, PoolPrices } from "../../src/indexer/prices";
import { pricesFor, swapPortFor } from "../../src/jupiter/select";

const conn = new Connection("http://127.0.0.1:1");
const chain = new SolanaChain(conn, Keypair.generate(), Keypair.generate());
const jup = new JupiterPrices("https://p.test", undefined, async () => Response.json({}));
const DEVNET_TOKENS = JSON.stringify([{ mint: Keypair.generate().publicKey.toBase58(), symbol: "dZEC", name: "dZEC", decimals: 8, pool: Keypair.generate().publicKey.toBase58() }]);

test("localnet and mainnet keep Jupiter", () => {
  expect(swapPortFor({}, chain)).toBeInstanceOf(JupiterLive);
  expect(swapPortFor({ CLUSTER: "mainnet" }, chain)).toBeInstanceOf(JupiterLive);
  expect(pricesFor({}, conn, jup)).toBe(jup);
});

test("devnet swaps through the pool list and prices through the pools", async () => {
  const s = swapPortFor({ CLUSTER: "devnet", DEVNET_TOKENS }, chain);
  expect(s).toBeInstanceOf(DammSwap);
  expect((await s.popularVerified()).map((t) => t.symbol)).toEqual(["dZEC"]);
  expect(pricesFor({ CLUSTER: "devnet", DEVNET_TOKENS }, conn, jup)).toBeInstanceOf(PoolPrices);
});
