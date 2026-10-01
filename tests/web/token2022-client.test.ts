import { test, expect } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { tokenBalance } from "../../src/web/wallet/balance";
import { rawToUi, uiToRaw } from "../../src/web/ui/scaled";

test("wallet balances read the ATA under the mint's token program", async () => {
  const t22 = Keypair.generate().publicKey, classic = Keypair.generate().publicKey, owner = Keypair.generate().publicKey;
  const reads: string[] = [];
  const conn = {
    getAccountInfo: async (k: PublicKey) => (k.equals(t22) ? { owner: TOKEN_2022_PROGRAM_ID } : k.equals(classic) ? { owner: TOKEN_PROGRAM_ID } : null),
    getTokenAccountBalance: async (k: PublicKey) => { reads.push(k.toBase58()); return { value: { amount: "7" } }; },
  } as any;
  expect(await tokenBalance(conn, t22.toBase58(), owner)).toBe(7n);
  expect(await tokenBalance(conn, classic.toBase58(), owner)).toBe(7n);
  expect(await tokenBalance(conn, Keypair.generate().publicKey.toBase58(), owner)).toBe(0n);
  expect(reads).toEqual([
    getAssociatedTokenAddressSync(t22, owner, true, TOKEN_2022_PROGRAM_ID).toBase58(),
    getAssociatedTokenAddressSync(classic, owner, true, TOKEN_PROGRAM_ID).toBase58(),
  ]);
});

test("scaled UI amounts convert both ways and never round up", () => {
  expect(rawToUi(100n)).toBe(100n);
  expect(rawToUi(100n, 1.05)).toBe(105n);
  expect(uiToRaw(105n, 1.05)).toBe(100n);
  expect(uiToRaw(rawToUi(333n, 1.07), 1.07)).toBeLessThanOrEqual(333n);
  expect(rawToUi(10n ** 8n, 1.0234)).toBe(102_340_000n);
});
