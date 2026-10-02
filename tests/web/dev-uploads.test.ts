import { test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { DevUploads } from "../../src/web/server/uploads";
import { GET } from "../../src/app/api/dev-uploads/[cid]/route";

const saved = { PINATA_JWT: process.env.PINATA_JWT, DEV_UPLOADS_BASE: process.env.DEV_UPLOADS_BASE };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
const get = (cid: string) => GET(new Request(`http://x/api/dev-uploads/${cid}`), { params: Promise.resolve({ cid }) });
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const BASE = "http://localhost:3000/api/dev-uploads";
const cidOf = (url: string) => url.slice(BASE.length + 1);

test("dev uploads land outside public so the dev server does not reload pages", async () => {
  const url = await new DevUploads(BASE).uploadImage(new File([png], "a.png"));
  expect(url.startsWith(`${BASE}/`)).toBe(true);
  expect(existsSync(`.dev-uploads/${cidOf(url)}`)).toBe(true);
  expect(existsSync(`public/dev-uploads/${cidOf(url)}`)).toBe(false);
});

test("serves a dev upload with its type when local uploads are on", async () => {
  delete process.env.PINATA_JWT;
  process.env.DEV_UPLOADS_BASE = BASE;
  const p = new DevUploads(BASE);
  const r = await get(cidOf(await p.uploadImage(new File([png], "a.png"))));
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("image/png");
  expect(await (await get(cidOf(await p.uploadJson({ name: "CAT" })))).json()).toEqual({ name: "CAT" });
  delete process.env.DEV_UPLOADS_BASE;
  process.env.PINATA_JWT = "stub";
  expect((await get(cidOf(await p.uploadImage(new File([png], "a.png"))))).status).toBe(200);
});

test("does not serve anything when local uploads are off or the id is not a cid", async () => {
  process.env.DEV_UPLOADS_BASE = BASE;
  expect((await get("../package.json")).status).toBe(404);
  delete process.env.DEV_UPLOADS_BASE;
  delete process.env.PINATA_JWT;
  const url = await new DevUploads(BASE).uploadImage(new File([png], "a.png"));
  expect((await get(cidOf(url))).status).toBe(404);
});
