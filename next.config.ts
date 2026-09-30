import type { NextConfig } from "next";

const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "";
if (process.env.NEXT_PUBLIC_TEST_WALLET_SECRET && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(rpc)) {
  throw new Error("NEXT_PUBLIC_TEST_WALLET_SECRET is only allowed with a local RPC. Remove it before building for a real network.");
}

const config: NextConfig = {
  serverExternalPackages: ["@kamino-finance/farms-sdk", "@meteora-ag/dynamic-bonding-curve-sdk", "@meteora-ag/cp-amm-sdk", "@coral-xyz/anchor"],
  // Bun 1.3.14 intermittently segfaults when Next's parallel build workers exit.
  experimental: { cpus: 1, workerThreads: false },
};
export default config;
