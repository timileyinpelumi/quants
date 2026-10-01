import { test, expect } from "bun:test";
import { assertNoDevSwitches, checkWebEnv } from "../src/env";

const SECRET = "ab".repeat(32);

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
  expect(() => checkWebEnv({ ...base, ADMIN_SESSION_SECRET: SECRET })).not.toThrow();
});

test("the web env check also refuses dev switches", () => {
  expect(() => checkWebEnv({ RPC_URL: "https://mainnet.example", ADMIN_SESSION_SECRET: SECRET, PINATA_JWT: "stub" })).toThrow(/dev switches/);
});
