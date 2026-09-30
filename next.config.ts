import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@kamino-finance/farms-sdk", "@meteora-ag/dynamic-bonding-curve-sdk", "@meteora-ag/cp-amm-sdk", "@coral-xyz/anchor"],
  // Bun 1.3.14 intermittently segfaults when Next's parallel build workers exit.
  experimental: { cpus: 1, workerThreads: false },
};
export default config;
