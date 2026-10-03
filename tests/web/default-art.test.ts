import { test, expect } from "bun:test";
import { imageSize } from "image-size";
import { defaultArt } from "../../src/web/server/default-art";

test("default art is a square PNG, the same for the same symbol", async () => {
  const a = await defaultArt("CAT");
  const dims = imageSize(new Uint8Array(await a.arrayBuffer()));
  expect(a.type).toBe("image/png");
  expect([dims.type, dims.width, dims.height]).toEqual(["png", 512, 512]);
  const b = await defaultArt("CAT");
  expect(Buffer.from(await b.arrayBuffer()).equals(Buffer.from(await a.arrayBuffer()))).toBe(true);
});
