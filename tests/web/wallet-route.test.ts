import { test, expect } from "bun:test";
import { makeWebContext, OURS } from "../helpers/web-context";
import { GET } from "../../src/app/api/wallet/[owner]/route";

const OWNER = (await import("@solana/web3.js")).Keypair.generate().publicKey.toBase58();
process.env.NEXT_PUBLIC_OURTOKEN_SYMBOL = "QNT";

test("lists SOL and held tokens with names for known mints, biggest known first", async () => {
  const c = await makeWebContext();
  await c.sql`insert into launches (mint, pool, quote_mint, fee_tier_bps, config_key, creator, status, settings_version, symbol, name, image)
    values ('CATmint', 'P', 'q', 200, 'c', 'cr', 'live', 1, 'CAT', 'Cat Coin', 'https://i/cat.png') returning id`;
  const [l] = await c.sql`select id from launches where mint = 'CATmint'`;
  await c.sql`insert into baskets (launch_id, reward_mint, weight_bps, symbol, decimals) values (${l.id}, 'ZECmint', 10000, 'ZEC', 8)`;
  const row = (mint: string, amount: string, decimals: number) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });
  c.conn = {
    getBalance: async () => 2_500_000_000,
    getParsedTokenAccountsByOwner: async () => ({ value: [row("CATmint", "5000000", 6), row("ZECmint", "100000000", 8), row(OURS, "7000000", 6), row("Unknown1", "1", 0), row("Empty1", "0", 6)] }),
  } as any;
  const r = await (await GET(new Request("http://x"), { params: Promise.resolve({ owner: OWNER }) })).json();
  expect(r.sol).toBe("2500000000");
  expect(r.tokens.map((t: any) => [t.mint, t.symbol, t.kind])).toEqual([
    ["CATmint", "CAT", "launch"], [OURS, "QNT", "platform"], ["ZECmint", "ZEC", "reward"], ["Unknown1", null, "other"],
  ]);
  expect(r.tokens[0]).toMatchObject({ amount: "5000000", decimals: 6, image: "https://i/cat.png" });
});

test("rejects an invalid address", async () => {
  await makeWebContext();
  expect((await GET(new Request("http://x"), { params: Promise.resolve({ owner: "nope" }) })).status).toBe(400);
});
