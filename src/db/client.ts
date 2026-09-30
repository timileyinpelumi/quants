import type { SQL } from "bun";

// Loaded on first use so `next build` can run under Node; the server itself always runs on Bun.
export const db = (url = process.env.DATABASE_URL!, max = 10): SQL => {
  const { SQL: Client } = require("bun") as typeof import("bun");
  return new Client({ url, max });
};

// Kept on globalThis because Next dev loads a separate module copy per route, which would otherwise open a pool each.
const g = globalThis as { __quantsDb?: SQL };
export const sharedDb = () => (g.__quantsDb ??= db(process.env.DATABASE_URL!, 8));
