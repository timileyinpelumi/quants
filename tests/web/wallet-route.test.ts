import { test, expect } from "bun:test";
import { makeWebContext, OURS } from "../helpers/web-context";
import { GET } from "../../src/app/api/wallet/[owner]/route";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const OWNER = (await import("@solana/web3.js")).Keypair.generate().publicKey.toBase58();
process.env.NEXT_PUBLIC_OURTOKEN_SYMBOL = "QUANTS";

test("lists SOL and held tokens with names for known mints, biggest known first", async () => {
  const c = await makeWebContext();
  await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol, name, image)
    values ('CATmint', 'P', 'q', 200, 'c', 'cr', 'live', 1, 'CAT', 'Cat Coin', 'https://i/cat.png') returning id`;
  const [l] = await c.sql`select id from launches where mint = 'CATmint'`;
  await c.sql`insert into baskets (launch_id, reward_mint, weight_bps, symbol, decimals) values (${l.id}, 'ZECmint', 10000, 'ZEC', 8)`;
  const row = (mint: string, amount: string, decimals: number) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });
  c.conn = {
    getBalance: async () => 2_500_000_000,
    getParsedTokenAccountsByOwner: async (_: unknown, f: { programId: unknown }) => ({ value: f.programId === TOKEN_2022_PROGRAM_ID ? [] : [row("CATmint", "5000000", 6), row("ZECmint", "100000000", 8), row(OURS, "7000000", 6), row("Unknown1", "1", 0), row("Empty1", "0", 6)] }),
  } as any;
  const r = await (await GET(new Request("http://x"), { params: Promise.resolve({ owner: OWNER }) })).json();
  expect(r.sol).toBe("2500000000");
  expect(r.tokens.map((t: any) => [t.mint, t.symbol, t.kind])).toEqual([
    ["CATmint", "CAT", "launch"], [OURS, "QUANTS", "platform"], ["ZECmint", "ZEC", "reward"], ["Unknown1", null, "other"],
  ]);
  expect(r.tokens[0]).toMatchObject({ amount: "5000000", decimals: 6, image: "https://i/cat.png" });
});

test("reads Token-2022 accounts too and merges them with classic ones", async () => {
  const c = await makeWebContext();
  const row = (mint: string, amount: string, decimals: number) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });
  const programs: string[] = [];
  c.conn = {
    getBalance: async () => 0,
    getParsedTokenAccountsByOwner: async (_: unknown, f: { programId: { toBase58(): string } }) => {
      const p = f.programId.toBase58();
      programs.push(p);
      return { value: p === TOKEN_2022_PROGRAM_ID.toBase58() ? [row("T22mint", "40", 2), row("Both1", "5", 0)] : [row("Classic1", "9", 0), row("Both1", "1", 0)] };
    },
  } as any;
  const r = await (await GET(new Request("http://x"), { params: Promise.resolve({ owner: OWNER }) })).json();
  expect(programs.sort()).toEqual([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].sort());
  expect(r.tokens.map((t: any) => [t.mint, t.amount, t.decimals]).sort()).toEqual([["Both1", "6", 0], ["Classic1", "9", 0], ["T22mint", "40", 2]]);
});

test("rejects an invalid address", async () => {
  await makeWebContext();
  expect((await GET(new Request("http://x"), { params: Promise.resolve({ owner: "nope" }) })).status).toBe(400);
});
