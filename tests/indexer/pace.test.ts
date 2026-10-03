import { test, expect } from "bun:test";
import { pacedFetch, nextWait } from "../../src/indexer/pace";

test("paced fetch runs requests one at a time and waits longer for bigger batches", async () => {
  const waits: number[] = [];
  const order: string[] = [];
  const f = pacedFetch((async (_u: any, init: any) => { order.push(init.body); return new Response("{}"); }) as any, 100, async (ms) => { waits.push(ms); });
  await Promise.all([f("x", { body: JSON.stringify({ id: 1 }) }), f("x", { body: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]) })]);
  expect(waits).toEqual([100, 300]);
  expect(order.length).toBe(2);
});

test("the indexer wait doubles while throttled and resets after a clean pass", () => {
  expect(nextWait(15_000, true, 15_000, 60_000)).toBe(30_000);
  expect(nextWait(30_000, true, 15_000, 60_000)).toBe(60_000);
  expect(nextWait(60_000, true, 15_000, 60_000)).toBe(60_000);
  expect(nextWait(60_000, false, 15_000, 60_000)).toBe(15_000);
});
