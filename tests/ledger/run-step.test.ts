import { test, expect } from "bun:test";
import { freshDb } from "../helpers/db";
import { insertLaunch } from "../helpers/fixtures";
import { FakeChain } from "../helpers/fake-chain";
import { runTxStep, resolveSent, MAX_ATTEMPTS } from "../../src/ledger/run-step";
import { abandonUnsent, getBalance, openSentSteps } from "../../src/ledger/ledger";

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

// A load-balanced RPC can answer the status read from a node that has not seen the tx yet and the
// height read from one that has moved past expiry. Here the chain catches up right after the first status read.
class CatchUpChain extends FakeChain {
  catchUp: (() => void) | null = null;
  override async status(sig: string) {
    const s = await super.status(sig);
    const f = this.catchUp;
    this.catchUp = null;
    f?.();
    return s;
  }
}

test("a lagging status read followed by an expired height does not resend", async () => {
  const sql = await freshDb();
  const chain = new CatchUpChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const spec = { launchId, idemKey: "claim:lag", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  expect(await runTxStep(sql, chain, spec)).toBe("pending");
  const sig = chain.sent[0]!;
  chain.catchUp = () => { chain.height += 1_000n; chain.states.set(sig, "confirmed"); };
  const r1 = await runTxStep(sql, chain, spec);
  const r2 = await runTxStep(sql, chain, spec);
  expect([r1, r2]).toContain("confirmed");
  expect(chain.sent.length).toBe(1);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("every signature sent for a row is kept and an earlier one landing late confirms the row", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const spec = { launchId, idemKey: "claim:late", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve };
  await runTxStep(sql, chain, spec);
  chain.height += 1_000n;
  await runTxStep(sql, chain, spec);
  expect(chain.sent.length).toBe(2);
  const [row] = await sql`select detail from distributions where idem_key = 'claim:late'`;
  expect(row.detail.signatures.map((s: any) => s.signature)).toEqual(chain.sent);
  chain.states.set(chain.sent[0]!, "confirmed");
  expect(await runTxStep(sql, chain, spec)).toBe("confirmed");
  expect(chain.sent.length).toBe(2);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("a step reset by resume is not resent by a new run when the earlier tx lands late", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const mk = (run: string) => ({ launchId, idemKey: `claim:x:${run}`, stepKey: "claim:x", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve });
  await runTxStep(sql, chain, mk("r1"));
  const [row] = await openSentSteps(sql);
  chain.height += 1_000n;
  expect(await resolveSent(sql, chain, row!, resolve)).toBe("expired");
  chain.states.set(chain.sent[0]!, "confirmed");
  expect(await runTxStep(sql, chain, mk("r2"))).toBe("pending");
  expect(chain.sent.length).toBe(1);
  expect(await getBalance(sql, launchId, "unsplit", "m")).toBe(100n);
});

test("a new run waits while an earlier signature of the same step has not expired", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  const mk = (run: string) => ({ launchId, idemKey: `claim:y:${run}`, stepKey: "claim:y", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve });
  await runTxStep(sql, chain, mk("r1"));
  await sql`update distributions set status = 'failed' where idem_key = 'claim:y:r1'`;
  expect(await runTxStep(sql, chain, mk("r2"))).toBe("pending");
  expect(chain.sent.length).toBe(1);
});

test("resume marks an expired sent row as expired, not abandoned, so it counts toward the cap", async () => {
  const sql = await freshDb();
  const chain = new FakeChain();
  const launchId = await insertLaunch(sql);
  chain.nextOutcome = "unknown";
  await runTxStep(sql, chain, { launchId, idemKey: "claim:z:r1", stepKey: "claim:z", kind: "claim" as const, settingsVersion: 1, detail: {}, build: async () => chain.tx(), resolve });
  const [row] = await openSentSteps(sql);
  chain.height += 1_000n;
  await resolveSent(sql, chain, row!, resolve);
  await abandonUnsent(sql);
  const [r] = await sql`select status, error from distributions where idem_key = 'claim:z:r1'`;
  expect([r.status, r.error]).toEqual(["failed", "expired"]);
});
