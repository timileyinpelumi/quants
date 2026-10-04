import { test, expect } from "bun:test";
import { makeWebContext, ADMIN_CODE } from "../helpers/web-context";
import { insertLaunch } from "../helpers/fixtures";
import { POST as loginRoute } from "../../src/app/api/whitehouse/session/route";
import { GET, POST } from "../../src/app/api/whitehouse/burns/route";

const ORIGIN = "http://x";
const req = (cookie: string, init: RequestInit = {}) => new Request(ORIGIN, { ...init, headers: { origin: ORIGIN, cookie } });

test("lists pending burns and approves only pending ones", async () => {
  const c = await makeWebContext();
  const id = await insertLaunch(c.sql, { mint: "CATmint" });
  const [a] = await c.sql`insert into burn_requests (launch_id, mint, amount, status) values (${id}, 'CATmint', 144050000000, 'pending') returning id`;
  const [b] = await c.sql`insert into burn_requests (launch_id, mint, amount, status) values (${id}, 'CATmint', 5, 'burned') returning id`;
  const login = await loginRoute(new Request(ORIGIN, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ code: ADMIN_CODE }) }));
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const list = await (await GET(req(cookie))).json();
  expect(list.burns.map((r: any) => [r.amount, r.status])).toEqual([["144050000000", "pending"], ["5", "burned"]]);
  const r = await POST(req(cookie, { method: "POST", body: JSON.stringify({ ids: [Number(a.id), Number(b.id)] }) }));
  expect(await r.json()).toEqual({ changed: 1 });
  const rows = await c.sql`select status from burn_requests order by id`;
  expect(rows.map((x: any) => x.status)).toEqual(["approved", "burned"]);
});
