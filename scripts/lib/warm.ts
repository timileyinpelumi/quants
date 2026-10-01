import { readdirSync } from "node:fs";
import { join } from "node:path";

export function appPaths(appDir: string, param: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), [...segs, /^\[.+\]$/.test(e.name) ? param : e.name]);
      else if (e.name === "page.tsx" || e.name === "route.ts") out.push("/" + segs.join("/"));
    }
  };
  walk(appDir, []);
  return out;
}

// webpack dev reloads every open page when it compiles a route for the first time, so compile them all up front
export async function warm(base: string, appDir = "src/app") {
  for (const p of appPaths(appDir, "11111111111111111111111111111111")) {
    await fetch(base + p, { signal: AbortSignal.timeout(120_000) }).then((r) => r.arrayBuffer()).catch(() => {});
  }
}
