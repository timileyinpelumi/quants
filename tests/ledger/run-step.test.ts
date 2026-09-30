import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { FakeChain } from "../helpers/fake-chain";
import { runTxStep, resolveSent, MAX_ATTEMPTS } from "../../src/ledger/run-step";
import { getBalance, openSentSteps } from "../../src/ledger/ledger";

const resolve = async () => [{ bucket: "unsplit" as const, mint: "m", amount: 100n }];

test("sends once and credits on confirmation", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  const spec = { launchId, idemKey: "claim:1", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("confirmed");
  expect(await runTxStep(sql, chain, spec)).toBe("confirmed");
  expect(chain.sent.length).toBe(1);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("crash after send: resolving the stored signature credits without resending", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const spec = { launchId, idemKey: "claim:2", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("pending");
  const [row] = await openSentSteps(sql);
  chain.states.set(row!.signature!, "confirmed");
  expect(await resolveSent(sql, chain, row!, resolve)).toBe("confirmed");
  expect(chain.sent.length).toBe(1);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("unknown status is not retried until the blockhash has expired", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const spec = { launchId, idemKey: "claim:3", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  await runTxStep(sql, chain, spec);
  expect(await runTxStep(sql, chain, spec)).toBe("pending");
  expect(chain.sent.length).toBe(1);
  chain.height += 1_000n;
  chain.nextOutcome = "confirmed";
  expect(await runTxStep(sql, chain, spec)).toBe("confirmed");
  expect(chain.sent.length).toBe(2);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("a send that throws is resolved by status, not assumed failed", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.sendThrows = true;
  const spec = { launchId, idemKey: "claim:4", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("pending");
  const [row] = await openSentSteps(sql);
  expect(row!.status).toBe("sent");
});

test("stops after MAX_ATTEMPTS expiries", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const spec = { launchId, idemKey: "claim:5", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  let last = "";
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    last = await runTxStep(sql, chain, spec);
    chain.height += 1_000n;
  }
  expect(last).toBe("failed");
  expect(chain.sent.length).toBe(MAX_ATTEMPTS);
});

test("on-chain failure marks the step failed and credits nothing", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "failed";
  const spec = { launchId, idemKey: "claim:6", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("failed");
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(0n);
});
