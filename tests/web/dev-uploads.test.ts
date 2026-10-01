import { test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { DevPinata } from "../../src/web/server/pinata";
import { GET } from "../../src/app/api/dev-uploads/[cid]/route";

const jwt = process.env.PINATA_JWT;
afterEach(() => { process.env.PINATA_JWT = jwt; });
const get = (cid: string) => GET(new Request(`http://x/api/dev-uploads/${cid}`), { params: Promise.resolve({ cid }) });
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("dev uploads land outside public so the dev server does not reload pages", async () => {
  const cid = await new DevPinata().uploadFile(new File([png], "a.png"));
  expect(existsSync(`.dev-uploads/${cid}`)).toBe(true);
  expect(existsSync(`public/dev-uploads/${cid}`)).toBe(false);
});

test("serves a dev upload with its type when uploads are stubbed", async () => {
  process.env.PINATA_JWT = "stub";
  const p = new DevPinata();
  const img = await p.uploadFile(new File([png], "a.png"));
  const r = await get(img);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("image/png");
  const meta = await p.uploadJson({ name: "CAT" });
  expect(await (await get(meta)).json()).toEqual({ name: "CAT" });
});

test("does not serve anything when uploads are real or the id is not a cid", async () => {
  process.env.PINATA_JWT = "stub";
  expect((await get("../package.json")).status).toBe(404);
  process.env.PINATA_JWT = "real";
  const cid = await new DevPinata().uploadFile(new File([png], "a.png"));
  expect((await get(cid)).status).toBe(404);
});
