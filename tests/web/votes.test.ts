import { test, expect } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { makeWebContext } from "../helpers/web-context";
import { insertLaunch } from "../helpers/fixtures";
import { castVote, voteTotals } from "../../src/web/server/votes";
import { GET, POST } from "../../src/app/api/token/[mint]/vote/route";

const params = (mint: string) => ({ params: Promise.resolve({ mint }) });
const req = (mint: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x/api/token/${mint}/vote`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const voterCookie = (r: Response) => /quants_voter=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];

test("totals rank tokens by score with up and down counts", async () => {
  const { sql } = await makeWebContext();
  await insertLaunch(sql, { mint: "mint-A" });
  await insertLaunch(sql, { mint: "mint-B" });
  await sql`update launches set symbol = 'AAA' where mint = 'mint-A'`;
  await castVote(sql, "mint-A", "v1", 1);
  await castVote(sql, "mint-A", "v2", 1);
  await castVote(sql, "mint-A", "v3", -1);
  await castVote(sql, "mint-B", "v1", -1);
  await castVote(sql, "mint-B", "v1", 1);
  await castVote(sql, "mint-B", "v2", 1);
  await castVote(sql, "mint-B", "v3", 1);
  await castVote(sql, "mint-B", "v3", 0);
  expect(await voteTotals(sql, 10)).toEqual([
    { mint: "mint-B", symbol: null, up: 2, down: 0, score: 2 },
    { mint: "mint-A", symbol: "AAA", up: 2, down: 1, score: 1 },
  ]);
  expect(await voteTotals(sql, 1)).toHaveLength(1);
});

test("an anonymous voter gets a cookie, and a vote can be changed and cleared", async () => {
  const { sql } = await makeWebContext();
  await insertLaunch(sql, { mint: "mint-A" });
  const first = await POST(req("mint-A", { vote: "up" }), params("mint-A"));
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ vote: "up" });
  const set = first.headers.get("set-cookie")!;
  expect(set).toContain("HttpOnly");
  const id = voterCookie(first)!;
  expect(id).toMatch(/^[0-9a-f]{32}$/);
  const cookie = { cookie: `quants_voter=${id}` };
  const changed = await POST(req("mint-A", { vote: "down" }, cookie), params("mint-A"));
  expect(changed.headers.get("set-cookie")).toBeNull();
  expect(await (await GET(new Request("http://x/api/token/mint-A/vote", { headers: cookie }), params("mint-A"))).json()).toEqual({ vote: "down" });
  expect((await voteTotals(sql, 10))[0]).toMatchObject({ up: 0, down: 1 });
  await POST(req("mint-A", { vote: null }, cookie), params("mint-A"));
  expect(await voteTotals(sql, 10)).toEqual([]);
});

test("a wallet address in the request is not a voter id", async () => {
  const { sql } = await makeWebContext();
  await insertLaunch(sql, { mint: "mint-A" });
  const wallet = Keypair.generate().publicKey.toBase58();
  const r = await POST(req("mint-A", { vote: "up", wallet }), params("mint-A"));
  expect(r.status).toBe(200);
  const [row] = await sql`select voter from token_votes`;
  expect(row.voter).toBe(voterCookie(r)!);
  expect(await (await GET(new Request(`http://x/api/token/mint-A/vote?wallet=${wallet}`), params("mint-A"))).json()).toEqual({ vote: null });
});

test("bad input, unknown tokens and floods are refused", async () => {
  const { sql } = await makeWebContext();
  await insertLaunch(sql, { mint: "mint-A" });
  expect((await POST(req("mint-A", { vote: "sideways" }), params("mint-A"))).status).toBe(400);
  expect((await POST(req("mint-A", { vote: "up" }, { cookie: "quants_voter=../../x" }), params("mint-A"))).status).toBe(200);
  expect((await POST(req("mint-Nope", { vote: "up" }), params("mint-Nope"))).status).toBe(404);
  let last = 200;
  for (let i = 0; i < 40; i++) last = (await POST(req("mint-A", { vote: "up" }), params("mint-A"))).status;
  expect(last).toBe(429);
});

test("the admin votes list needs an admin session", async () => {
  await makeWebContext();
  const { GET: adminVotes } = await import("../../src/app/api/whitehouse/votes/route");
  expect((await adminVotes(new Request("http://x/api/whitehouse/votes"))).status).toBe(401);
});
