import { test, expect } from "bun:test";
import { makeWebContext } from "../helpers/web-context";
import { GET as search } from "../../src/app/api/tokens/search/route";

const CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const tok = (mint: string, symbol: string, tokenProgram: string) => ({ mint, symbol, name: symbol, icon: null, decimals: 6, tokenProgram });

async function ctx() {
  const checked: string[][] = [];
  const problems: Record<string, string | null> = { Meta1: null, Fee1: "has the transfer fee config extension", Stock1: "has the pausable config extension" };
  const c = await makeWebContext({
    rewardMints: async (mints: string[]) => { checked.push(mints); return new Map(mints.map((m) => [m, { program: T22, problem: m in problems ? problems[m]! : "was not found on chain" }])); },
  });
  const list = [tok("Classic1", "AAA", CLASSIC), tok("Meta1", "META", T22), tok("Fee1", "FEE", T22), tok("Stock1", "NVDAx", T22)];
  (c.jupiter as any).popularVerified = async () => list;
  (c.jupiter as any).searchVerified = async () => list;
  return { c, checked };
}

test("popular reward tokens keep classic ones and Token-2022 ones with allowed extensions only", async () => {
  const { checked } = await ctx();
  const r = await (await search(new Request("http://x/api/tokens/search?q="))).json();
  expect(r.tokens.map((t: any) => t.symbol)).toEqual(["AAA", "META"]);
  expect(r.popular).toBe(true);
  expect(checked).toEqual([["Meta1", "Fee1", "Stock1"]]);
});

test("search results are filtered the same way", async () => {
  await ctx();
  const r = await (await search(new Request("http://x/api/tokens/search?q=meta"))).json();
  expect(r.tokens.map((t: any) => t.symbol)).toEqual(["AAA", "META"]);
});

test("popular tokens stop at 200", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).popularVerified = async () => Array.from({ length: 300 }, (_, i) => tok(`M${i}`, `T${i}`, CLASSIC));
  expect((await (await search(new Request("http://x/api/tokens/search?q="))).json()).tokens).toHaveLength(200);
});
