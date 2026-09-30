import { test, expect } from "bun:test";
import { makeWebContext, FakePinata } from "../helpers/web-context";
import { POST } from "../../src/app/api/metadata/route";

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return new Request("http://x/api/metadata", { method: "POST", body: f });
};

test("uploads image then metadata and returns the uri", async () => {
  const c = await makeWebContext();
  const r = await POST(form({ image: new File([png(512, 512)], "cat.png", { type: "image/png" }), name: "Cat", symbol: "CAT", website: "https://cat.xyz" }));
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.uri).toContain("ipfs/cid-2");
  expect(body.image).toContain("ipfs/cid-1");
  const meta = (c.pinata as FakePinata).json[0]!;
  expect(meta).toMatchObject({ name: "Cat", symbol: "CAT", extensions: { website: "https://cat.xyz" } });
  expect(meta.image).toContain("ipfs/cid-1");
});

test("rejects non square, too large, wrong type, bad links and a missing image before uploading", async () => {
  const c = await makeWebContext();
  const cases = [
    form({ image: new File([png(512, 300)], "a.png", { type: "image/png" }), name: "Cat", symbol: "CAT" }),
    form({ image: new File([png(512, 512), new Uint8Array(2 * 1024 * 1024)], "a.png", { type: "image/png" }), name: "Cat", symbol: "CAT" }),
    form({ image: new File(["GIF89a"], "a.gif", { type: "image/gif" }), name: "Cat", symbol: "CAT" }),
    form({ image: new File([png(64, 64)], "a.png", { type: "image/png" }), name: "Cat", symbol: "CAT", x: "https://evil.com/cat" }),
    form({ image: new File([png(64, 64)], "a.png", { type: "image/png" }), name: "Cat", symbol: "CAT", website: "http://cat.xyz" }),
    form({ name: "Cat", symbol: "CAT" }),
  ];
  for (const req of cases) {
    const r = await POST(req);
    expect(r.status).toBe(400);
    expect((await r.json()).error.message.length).toBeGreaterThan(0);
  }
  expect((c.pinata as FakePinata).files.length).toBe(0);
});
