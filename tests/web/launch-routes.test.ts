import { test, expect } from "bun:test";
import { makeWebContext, OURS } from "../helpers/web-context";
import { POST as prepare } from "../../src/app/api/launch/prepare/route";
import { POST as confirm } from "../../src/app/api/launch/confirm/route";
import { GET as search } from "../../src/app/api/tokens/search/route";
import { NATIVE_MINT } from "../../src/domain/types";

const body = (over: object = {}) => ({
  name: "Cat", symbol: "CAT", uri: "https://ipfs.io/ipfs/x", creator: "Creator111111111111111111111111111111111111",
  quoteMint: NATIVE_MINT, feeTierBps: 200, basket: [{ mint: "Zec1111111111111111111111111111111111111111", weightBps: 10000 }], ...over,
});
const post = (h: (r: Request) => Promise<Response>, b: object) => h(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));

test("SOL launch returns one legacy transaction and passes the first buy through", async () => {
  const c = await makeWebContext();
  const r = await post(prepare, body({ devBuySol: "1000000000" }));
  const j = await r.json();
  expect(r.status).toBe(200);
  expect(j.transactions.map((t: any) => t.versioned)).toEqual([false]);
  expect((c.meteora as any).launches[0].devBuyQuoteAmount).toBe(1_000_000_000n);
});

test("OURTOKEN launch with a first buy puts the Jupiter swap first and caps the buy by slippage", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).rates.set(OURS, 2);
  const r = await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000" }));
  const j = await r.json();
  expect(j.transactions.map((t: any) => t.versioned)).toEqual([true, false]);
  expect((c.meteora as any).launches[0].devBuyQuoteAmount).toBe(1_980_000_000n);
});

test("OURTOKEN first buy with no route is a readable 400", async () => {
  await makeWebContext();
  const r = await post(prepare, body({ quoteMint: OURS, devBuySol: "1000000000" }));
  expect(r.status).toBe(400);
});

test("prepare maps validation errors to 400", async () => {
  await makeWebContext();
  const r = await post(prepare, body({ symbol: "TOO LONG SYMBOL" }));
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("invalid_input");
});

test("confirm returns 400 with a readable code for an unknown mint", async () => {
  await makeWebContext();
  const r = await post(confirm, { signature: "5".repeat(64), mint: "Mint1111111111111111111111111111111111111111" });
  expect(r.status).toBe(400);
  expect((await r.json()).error.code).toBe("not_found_on_chain");
});

test("token search proxies verified tokens and ignores short queries", async () => {
  const c = await makeWebContext();
  (c.jupiter as any).searchVerified = async () => [{ mint: "Z", symbol: "ZEC", name: "Zcash", icon: null, decimals: 8, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }];
  expect((await (await search(new Request("http://x/api/tokens/search?q=zec"))).json()).tokens[0].symbol).toBe("ZEC");
  expect((await (await search(new Request("http://x/api/tokens/search?q=z"))).json()).tokens).toEqual([]);
});
