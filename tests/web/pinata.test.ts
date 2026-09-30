import { test, expect } from "bun:test";
import { PinataRest, gatewayUrl } from "../../src/web/server/pinata";

test("uploads a file publicly with the bearer token and returns the cid", async () => {
  let seen: unknown = null;
  const p = new PinataRest("jwt1", async (url, init) => {
    const body = init!.body as FormData;
    seen = { url: String(url), auth: new Headers(init!.headers).get("authorization"), network: body.get("network") };
    return new Response(JSON.stringify({ data: { cid: "bafy123" } }));
  });
  expect(await p.uploadFile(new File(["x"], "a.png", { type: "image/png" }), "a.png")).toBe("bafy123");
  expect(seen).toEqual({ url: "https://uploads.pinata.cloud/v3/files", auth: "Bearer jwt1", network: "public" });
});

test("uploads json as a file", async () => {
  let type = "";
  const p = new PinataRest("jwt1", async (_u, init) => {
    type = ((init!.body as FormData).get("file") as File).type;
    return new Response(JSON.stringify({ data: { cid: "bafyjson" } }));
  });
  expect(await p.uploadJson({ a: 1 }, "m.json")).toBe("bafyjson");
  expect(type).toStartWith("application/json");
});

test("throws on a failed upload", async () => {
  const p = new PinataRest("jwt1", async () => new Response("nope", { status: 401 }));
  await expect(p.uploadJson({}, "m.json")).rejects.toThrow("pinata upload failed: 401");
});

test("gatewayUrl", () => {
  delete process.env.PINATA_GATEWAY;
  expect(gatewayUrl("bafy")).toBe("https://ipfs.io/ipfs/bafy");
  process.env.PINATA_GATEWAY = "g.mypinata.cloud";
  expect(gatewayUrl("bafy")).toBe("https://g.mypinata.cloud/ipfs/bafy");
  delete process.env.PINATA_GATEWAY;
});
