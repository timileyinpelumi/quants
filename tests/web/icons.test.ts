import { test, expect } from "bun:test";
import { TokenIcons } from "../../src/web/server/icons";
import { imgSrc } from "../../src/web/ui/format";

const row = (id: string, icon: string | null) => ({ id, symbol: id, icon });

test("looks icons up in one batched request and caches them", async () => {
  const urls: string[] = [];
  const icons = new TokenIcons("https://jup/tokens/v2", "k", async (u, init) => {
    urls.push(String(u));
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("k");
    return Response.json([row("A", "https://a.png"), row("B", null)]);
  });
  expect(await icons.get(["A", "B", "C"])).toEqual({ A: "https://a.png", B: null, C: null });
  expect(await icons.get(["A", "B"])).toEqual({ A: "https://a.png", B: null });
  expect(urls).toEqual(["https://jup/tokens/v2/search?query=A%2CB%2CC"]);
});

test("splits more than 100 mints into several requests and survives a failure", async () => {
  let n = 0;
  const icons = new TokenIcons("https://jup/tokens/v2", undefined, async () => { n++; if (n === 2) throw new Error("down"); return Response.json([]); });
  const mints = Array.from({ length: 150 }, (_, i) => `M${i}`);
  const r = await icons.get(mints);
  expect(n).toBe(2);
  expect(Object.keys(r)).toHaveLength(150);
});

test("remote images go through the resizing proxy, local ones do not", () => {
  expect(imgSrc("https://a.test/x.png", 40)).toBe("https://wsrv.nl/?url=https%3A%2F%2Fa.test%2Fx.png&w=80&h=80&fit=cover&output=webp");
  expect(imgSrc("/brand/quants-mark.svg", 40)).toBe("/brand/quants-mark.svg");
  expect(imgSrc("http://localhost:3000/api/dev-uploads/abc", 40)).toBe("http://localhost:3000/api/dev-uploads/abc");
  expect(imgSrc("data:image/png;base64,AAA", 40)).toBe("data:image/png;base64,AAA");
  expect(imgSrc("https://res.cloudinary.com/demo/image/upload/v1/quants/abc.png", 40)).toBe("https://res.cloudinary.com/demo/image/upload/w_80,h_80,c_fill,f_webp/v1/quants/abc.png");
});

test("the icon cache holds at most maxEntries mints", async () => {
  let n = 0;
  const icons = new TokenIcons("https://jup/tokens/v2", undefined, async () => { n++; return Response.json([]); }, 60_000, 2);
  await icons.get(["A"]); await icons.get(["B"]); await icons.get(["C"]);
  await icons.get(["A"]);
  expect(n).toBe(4);
  await icons.get(["C"]);
  expect(n).toBe(4);
});
