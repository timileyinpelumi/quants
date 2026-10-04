import { test, expect } from "bun:test";
import { makeWebContext, ADMIN_CODE } from "../helpers/web-context";
import { insertLaunch } from "../helpers/fixtures";
import { POST as loginRoute } from "../../src/app/api/whitehouse/session/route";
import { POST as createCode } from "../../src/app/api/whitehouse/codes/route";
import { GET, POST } from "../../src/app/api/whitehouse/stake-payouts/route";
import { getBalance } from "../../src/ledger/ledger";

const ORIGIN = "http://x";
const req = (cookie: string, init: RequestInit = {}) => new Request(ORIGIN, { ...init, headers: { origin: ORIGIN, cookie } });
async function signIn(code = ADMIN_CODE) {
  const r = await loginRoute(new Request(ORIGIN, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ code }) }));
  return r.headers.get("set-cookie")!.split(";")[0]!;
}

async function duePeriods(c: Awaited<ReturnType<typeof makeWebContext>>) {
  const id = await insertLaunch(c.sql, { mint: "CATmint" });
  await c.sql`insert into baskets (launch_id, reward_mint, weight_bps, symbol, decimals) values (${id}, 'ZECmint', 10000, 'ZEC', 8)`;
  await c.sql`insert into escrow (launch_id, bucket, mint, amount) values (${id}, 'owed', 'ZECmint', 300), (${id}, 'reward', 'ZECmint', 1000)`;
  const ids: number[] = [];
  for (const [owner, amount] of [["Alice", 100], ["Bob", 200]] as const) {
    const [p] = await c.sql`insert into stake_periods (launch_id, tier_id, owner, stake, started_at, ends_at, status)
      values (${id}, '1d', ${owner}, 1, now() - interval '2 days', now() - interval '1 day', 'due') returning id`;
    await c.sql`insert into stake_earnings (period_id, mint, amount) values (${p.id}, 'ZECmint', ${amount})`;
    ids.push(Number(p.id));
  }
  return { id, ids };
}

test("lists due payouts, approves one and rejects the other back into the reward pool", async () => {
  const c = await makeWebContext();
  const { id, ids } = await duePeriods(c);
  const full = await signIn();
  const list = await (await GET(req(full))).json();
  expect(list.payouts.map((p: any) => [p.owner, p.status, p.amounts[0].amount, p.amounts[0].symbol])).toEqual([["Bob", "due", "200", "ZEC"], ["Alice", "due", "100", "ZEC"]].sort((a, b) => (a[0]! < b[0]! ? 1 : -1)));

  const approve = await POST(req(full, { method: "POST", body: JSON.stringify({ ids: [ids[0]], action: "approve" }) }));
  expect(await approve.json()).toEqual({ changed: 1 });
  const reject = await POST(req(full, { method: "POST", body: JSON.stringify({ ids: [ids[1], ids[0]], action: "reject" }) }));
  expect(await reject.json()).toEqual({ changed: 1 });
  const rows = await c.sql`select owner, status from stake_periods order by owner`;
  expect(rows.map((r: any) => [r.owner, r.status])).toEqual([["Alice", "approved"], ["Bob", "rejected"]]);
  expect(await getBalance(c.sql, id, "owed", "ZECmint")).toBe(100n);
  expect(await getBalance(c.sql, id, "reward", "ZECmint")).toBe(1200n);
});

test("a read only session can see payouts but not decide them", async () => {
  const c = await makeWebContext();
  const { ids } = await duePeriods(c);
  const full = await signIn();
  const { code } = await (await createCode(req(full, { method: "POST", body: JSON.stringify({ label: "auditor" }) }))).json();
  const read = await signIn(code);
  expect((await GET(req(read))).status).toBe(200);
  expect((await POST(req(read, { method: "POST", body: JSON.stringify({ ids, action: "approve" }) }))).status).toBe(403);
  const rows = await c.sql`select status from stake_periods`;
  expect(rows.every((r: any) => r.status === "due")).toBe(true);
});
