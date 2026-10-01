import type { NextConfig } from "next";
import { securityHeaders } from "./src/web/security-headers";

const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "";
if (process.env.NEXT_PUBLIC_TEST_WALLET_SECRET && !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(rpc)) {
  throw new Error("NEXT_PUBLIC_TEST_WALLET_SECRET is only allowed with a local RPC. Remove it before building for a real network.");
}

const config: NextConfig = {
  serverExternalPackages: ["@kamino-finance/farms-sdk", "@meteora-ag/dynamic-bonding-curve-sdk", "@meteora-ag/cp-amm-sdk", "@coral-xyz/anchor"],
  // keep every compiled route in dev; recompiling a disposed one reloads open pages
  // launches seeded before uploads moved out of public/ still point at /dev-uploads
  async rewrites() { return [{ source: "/dev-uploads/:cid", destination: "/api/dev-uploads/:cid" }]; },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(rpc || "http://127.0.0.1:8899", process.env.NODE_ENV !== "production") }];
  },
  // The build runs on Turbopack; the webpack hook below only affects the webpack dev server.
  turbopack: {},
  // Under Bun the dev server's file watcher misses edits, so dev polls for changes instead.
  webpack: (cfg, { dev }) => {
    if (dev) cfg.watchOptions = { ...cfg.watchOptions, poll: 1000, aggregateTimeout: 300 };
    return cfg;
  },
  onDemandEntries: { maxInactiveAge: 24 * 60 * 60 * 1000, pagesBufferLength: 100 },
};
export default config;
