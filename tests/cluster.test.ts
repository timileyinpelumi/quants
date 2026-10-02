import { test, expect } from "bun:test";
import { applyClusterDefaults, clusterOf, configKeysPath, explorerTx, rpcUrl } from "../src/cluster";

test("an unset CLUSTER is localnet and leaves RPC_URL alone", () => {
  expect(clusterOf({})).toBe("localnet");
  expect(rpcUrl({})).toBeUndefined();
  expect(rpcUrl({ RPC_URL: "http://127.0.0.1:8899" })).toBe("http://127.0.0.1:8899");
  expect(configKeysPath({})).toBe("config-keys.json");
});

test("devnet defaults to DEVNET_RPC_URL, then the public devnet RPC, and its own config keys file", () => {
  expect(rpcUrl({ CLUSTER: "devnet" })).toBe("https://api.devnet.solana.com");
  expect(rpcUrl({ CLUSTER: "devnet", DEVNET_RPC_URL: "https://devnet.helius-rpc.com/?api-key=k" })).toBe("https://devnet.helius-rpc.com/?api-key=k");
  expect(rpcUrl({ CLUSTER: "devnet", RPC_URL: "https://x.test" })).toBe("https://x.test");
  expect(configKeysPath({ CLUSTER: "devnet" })).toBe("config-keys.devnet.json");
  expect(configKeysPath({ CLUSTER: "devnet", CONFIG_KEYS_PATH: "k.json" })).toBe("k.json");
});

test("mainnet and localnet defaults", () => {
  expect(rpcUrl({ CLUSTER: "mainnet" })).toBe("https://api.mainnet-beta.solana.com");
  expect(rpcUrl({ CLUSTER: "localnet" })).toBe("http://127.0.0.1:8899");
  expect(configKeysPath({ CLUSTER: "mainnet" })).toBe("config-keys.json");
});

test("an unknown cluster is an error", () => {
  expect(() => clusterOf({ CLUSTER: "testnet" })).toThrow(/CLUSTER must be/);
});

test("applyClusterDefaults fills RPC_URL only when it is missing", () => {
  const env: Record<string, string | undefined> = { CLUSTER: "devnet" };
  applyClusterDefaults(env);
  expect(env.RPC_URL).toBe("https://api.devnet.solana.com");
  const set = { CLUSTER: "devnet", RPC_URL: "https://mine.test" };
  expect(applyClusterDefaults(set).RPC_URL).toBe("https://mine.test");
});

test("explorer links carry the cluster", () => {
  expect(explorerTx("sig", "devnet")).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
  expect(explorerTx("sig", "mainnet")).toBe("https://explorer.solana.com/tx/sig");
});
