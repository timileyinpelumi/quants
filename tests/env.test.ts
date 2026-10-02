import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNoDevSwitches, checkWebEnv, readKeypairFiles } from "../src/env";

const SECRET = "ab".repeat(32);
const HASH = Buffer.from("$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g").toString("base64");

test("dev switches are refused against a remote RPC", () => {
  for (const sw of [{ PINATA_JWT: "stub" }, { ALLOW_LOCAL_URIS: "1" }, { DEV_UPLOADS_BASE: "http://x" }, { LOCAL_TOKEN_LIST: "[]" }, { LOCAL_REWARD_MINTS: "a" }]) {
    expect(() => assertNoDevSwitches({ RPC_URL: "https://mainnet.helius-rpc.com/?api-key=k", ...sw })).toThrow(/dev switches/);
  }
});

test("dev switches are allowed against a local RPC or with ALLOW_DEV_SWITCHES=1", () => {
  expect(() => assertNoDevSwitches({ RPC_URL: "http://127.0.0.1:8899", PINATA_JWT: "stub" })).not.toThrow();
  expect(() => assertNoDevSwitches({ RPC_URL: "http://localhost:8899", LOCAL_TOKEN_LIST: "[]" })).not.toThrow();
  expect(() => assertNoDevSwitches({ RPC_URL: "https://tunnel.example", PINATA_JWT: "stub", ALLOW_DEV_SWITCHES: "1" })).not.toThrow();
  expect(() => assertNoDevSwitches({ RPC_URL: "https://mainnet.example", PINATA_JWT: "real" })).not.toThrow();
});

test("the admin session secret must be at least 32 bytes of hex", () => {
  const base = { RPC_URL: "http://127.0.0.1:8899" };
  expect(() => checkWebEnv({ ...base })).toThrow(/ADMIN_SESSION_SECRET/);
  expect(() => checkWebEnv({ ...base, ADMIN_SESSION_SECRET: "short" })).toThrow(/ADMIN_SESSION_SECRET/);
  expect(() => checkWebEnv({ ...base, ADMIN_SESSION_SECRET: "z".repeat(64) })).toThrow(/ADMIN_SESSION_SECRET/);
  expect(() => checkWebEnv({ ...base, ADMIN_SESSION_SECRET: SECRET, ADMIN_CODE_HASH: HASH })).not.toThrow();
});

test("the admin code hash must be an argon2id hash", () => {
  const base = { RPC_URL: "http://127.0.0.1:8899", ADMIN_SESSION_SECRET: SECRET };
  expect(() => checkWebEnv(base)).toThrow(/ADMIN_CODE_HASH/);
  expect(() => checkWebEnv({ ...base, ADMIN_CODE_HASH: "plain-code" })).toThrow(/ADMIN_CODE_HASH/);
  expect(() => checkWebEnv({ ...base, ADMIN_CODE_HASH: Buffer.from("$2b$10$abc").toString("base64") })).toThrow(/ADMIN_CODE_HASH/);
  expect(() => checkWebEnv({ ...base, ADMIN_CODE_HASH: Buffer.from(HASH, "base64").toString() })).not.toThrow();
});

test("the web env check also refuses dev switches", () => {
  expect(() => checkWebEnv({ RPC_URL: "https://mainnet.example", ADMIN_SESSION_SECRET: SECRET, ADMIN_CODE_HASH: HASH, PINATA_JWT: "stub" })).toThrow(/dev switches/);
});

test("keypairs can be read from files", () => {
  const dir = mkdtempSync(join(tmpdir(), "quants-env-"));
  writeFileSync(join(dir, "keeper.json"), "[1,2,3]\n");
  writeFileSync(join(dir, "spill.json"), "[4,5,6]");
  const env = readKeypairFiles({ KEEPER_KEYPAIR_PATH: join(dir, "keeper.json"), SPILL_KEYPAIR_PATH: join(dir, "spill.json") });
  expect(env.KEEPER_KEYPAIR).toBe("[1,2,3]");
  expect(env.SPILL_KEYPAIR).toBe("[4,5,6]");
  expect(readKeypairFiles({ KEEPER_KEYPAIR: "[7]" }).KEEPER_KEYPAIR).toBe("[7]");
  expect(() => readKeypairFiles({ KEEPER_KEYPAIR: "[7]", KEEPER_KEYPAIR_PATH: join(dir, "keeper.json") })).toThrow(/not both/);
  expect(() => readKeypairFiles({ SPILL_KEYPAIR_PATH: join(dir, "missing.json") })).toThrow();
});

test("a bad keypair error never quotes the secret", async () => {
  const { loadKeypair } = await import("../src/chain/solana");
  const secret = "[12,34,secretbytes-here]";
  let msg = "";
  try { loadKeypair(secret); } catch (e) { msg = String(e); }
  expect(msg).toContain("keypair is not a JSON array");
  expect(msg).not.toContain("secretbytes");
});
