export type Cluster = "localnet" | "devnet" | "mainnet";
type Env = Record<string, string | undefined>;

const RPC: Record<Cluster, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

export function clusterOf(env: Env = process.env): Cluster {
  const c = env.CLUSTER || "localnet";
  if (c !== "localnet" && c !== "devnet" && c !== "mainnet") throw new Error(`CLUSTER must be localnet, devnet or mainnet, not ${c}`);
  return c;
}

/** RPC_URL when set. Otherwise the cluster's default, but only when CLUSTER is set, so an unset CLUSTER behaves as before. */
export function rpcUrl(env: Env = process.env): string | undefined {
  if (env.RPC_URL) return env.RPC_URL;
  if (!env.CLUSTER) return undefined;
  const c = clusterOf(env);
  return c === "devnet" ? env.DEVNET_RPC_URL || RPC.devnet : RPC[c];
}

export function configKeysPath(env: Env = process.env): string {
  return env.CONFIG_KEYS_PATH ?? (clusterOf(env) === "devnet" ? "config-keys.devnet.json" : "config-keys.json");
}

/** Fills RPC_URL from the cluster defaults so every entry point that reads process.env sees the same value. */
export function applyClusterDefaults(env: Env = process.env): Env {
  const rpc = rpcUrl(env);
  if (rpc && !env.RPC_URL) env.RPC_URL = rpc;
  return env;
}

export const explorerTx = (sig: string, c: Cluster) =>
  `https://explorer.solana.com/tx/${sig}${c === "mainnet" ? "" : c === "devnet" ? "?cluster=devnet" : "?cluster=custom"}`;
