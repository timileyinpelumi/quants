import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appPaths } from "../../scripts/lib/warm";

test("lists every page and route under the app dir with params filled", () => {
  const app = mkdtempSync(join(tmpdir(), "app-"));
  const add = (p: string) => { mkdirSync(join(app, p, ".."), { recursive: true }); writeFileSync(join(app, p), ""); };
  add("page.tsx");
  add("docs/page.tsx");
  add("t/[mint]/stake/page.tsx");
  add("api/chart/[mint]/route.ts");
  add("docs/Thing.tsx");
  expect(appPaths(app, "M").sort()).toEqual(["/", "/api/chart/M", "/docs", "/t/M/stake"]);
});
