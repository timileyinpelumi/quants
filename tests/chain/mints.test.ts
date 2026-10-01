import { test, expect } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { readMint, fetchMint, mintPaused, uiMultiplier, stockMintProblem, isPausedError } from "../../src/chain/mints";
import { mintData, mintAccount, pausable, scaledUi, transferFee, transferHook } from "../helpers/mint-data";

const addr = Keypair.generate().publicKey;

test("reads decimals and program for classic and Token-2022 mints", () => {
  expect(readMint(addr, mintAccount(mintData(6), false)).decimals).toBe(6);
  const t = readMint(addr, mintAccount(mintData(8, [pausable(false)])));
  expect(t.decimals).toBe(8);
  expect(t.program.toBase58()).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  expect(() => readMint(addr, { ...mintAccount(mintData(6)), owner: PublicKey.default })).toThrow("not a token mint");
});

test("fetchMint reads decimals of a Token-2022 mint, which getMint would reject", async () => {
  const conn = { getAccountInfo: async (k: PublicKey) => (k.equals(addr) ? mintAccount(mintData(8, [pausable(false)])) : null) } as any;
  expect((await fetchMint(conn, addr.toBase58())).decimals).toBe(8);
  await expect(fetchMint(conn, Keypair.generate().publicKey.toBase58())).rejects.toThrow("not found");
});

test("paused flag and scaled UI multiplier", () => {
  expect(mintPaused(readMint(addr, mintAccount(mintData(8, [pausable(true)]))).mint)).toBe(true);
  expect(mintPaused(readMint(addr, mintAccount(mintData(8, [pausable(false)]))).mint)).toBe(false);
  expect(mintPaused(readMint(addr, mintAccount(mintData(8))).mint)).toBe(false);
  expect(uiMultiplier(readMint(addr, mintAccount(mintData(8))).mint)).toBe(1);
  const m = readMint(addr, mintAccount(mintData(8, [scaledUi(1.5, 2, 1_000n)]))).mint;
  expect(uiMultiplier(m, 999)).toBe(1.5);
  expect(uiMultiplier(m, 1_000)).toBe(2);
});

test("stock mints must be Token-2022 without a transfer fee or hook program", () => {
  expect(stockMintProblem(readMint(addr, mintAccount(mintData(8, [pausable(false), scaledUi(1), transferHook(PublicKey.default)]))))).toBeNull();
  expect(stockMintProblem(readMint(addr, mintAccount(mintData(8))))).toBeNull();
  expect(stockMintProblem(readMint(addr, mintAccount(mintData(6), false)))).toBe("not a Token-2022 mint");
  expect(stockMintProblem(readMint(addr, mintAccount(mintData(8, [transferFee()]))))).toBe("has a transfer fee");
  expect(stockMintProblem(readMint(addr, mintAccount(mintData(8, [transferHook(addr)]))))).toBe("has a transfer hook program");
});

test("recognises paused mint errors", () => {
  expect(isPausedError(Object.assign(new Error("Simulation failed."), { logs: ["Program log: Transferring, minting, and burning is paused on this mint", "failed: custom program error: 0x43"] }))).toBe(true);
  expect(isPausedError(new Error("failed: custom program error: 0x43"))).toBe(true);
  expect(isPausedError(new Error("failed: custom program error: 0x430"))).toBe(false);
  expect(isPausedError(new Error("insufficient funds"))).toBe(false);
});
