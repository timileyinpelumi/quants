import type { SQL } from "bun";

// Loaded on first use so `next build` can run under Node; the server itself always runs on Bun.
export const db = (url = process.env.DATABASE_URL!): SQL => {
  const { SQL: Client } = require("bun") as typeof import("bun");
  return new Client(url);
};

let shared: SQL | undefined;
export const sharedDb = () => (shared ??= db());
