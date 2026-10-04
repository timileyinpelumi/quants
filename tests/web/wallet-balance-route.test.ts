import { test, expect } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { makeWebContext } from "../helpers/web-context";
import { GET } from "../../src/app/api/wallet/[owner]/balance/route";

const OWNER = Keypair.generate().publicKey.toBase58();
const MINT = Keypair.generate().publicKey.toBase58();
const SOL = "So11111111111111111111111111111111111111112";
const ATA = getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey(OWNER), true, TOKEN_PROGRAM_ID).toBase58();
const read = async (mint: string) =>
  (await GET(new Request(`http://x/api/wallet/${OWNER}/balance?mint=${mint}`), { params: Promise.resolve({ owner: OWNER }) })).json();

test("reads SOL in lamports and a token from the owner's associated account", async () => {
  const c = await makeWebContext();
  c.conn = {
    getBalance: async () => 2_500_000_000,
    getAccountInfo: async (k: PublicKey) => (k.toBase58() === MINT ? { owner: TOKEN_PROGRAM_ID } : k.toBase58() === ATA ? {} : null),
    getTokenAccountBalance: async () => ({ value: { amount: "111000000" } }),
  } as any;
  expect(await read(SOL)).toEqual({ amount: "2500000000" });
  expect(await read(MINT)).toEqual({ amount: "111000000" });
});

test("a Token-2022 mint is read from the ATA under its own program", async () => {
  const c = await makeWebContext();
  const ata22 = getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey(OWNER), true, TOKEN_2022_PROGRAM_ID).toBase58();
  const reads: string[] = [];
  c.conn = {
    getAccountInfo: async (k: PublicKey) => (k.toBase58() === MINT ? { owner: TOKEN_2022_PROGRAM_ID } : k.toBase58() === ata22 ? {} : null),
    getTokenAccountBalance: async (k: PublicKey) => { reads.push(k.toBase58()); return { value: { amount: "7" } }; },
  } as any;
  expect(await read(MINT)).toEqual({ amount: "7" });
  expect(reads).toEqual([ata22]);
});

test("a missing token account is zero, a failed read is null", async () => {
  const c = await makeWebContext();
  c.conn = { getAccountInfo: async (k: PublicKey) => (k.toBase58() === MINT ? { owner: TOKEN_PROGRAM_ID } : null) } as any;
  expect(await read(MINT)).toEqual({ amount: "0" });
  c.conn = { getBalance: async () => { throw new Error("429"); }, getAccountInfo: async () => { throw new Error("429"); } } as any;
  expect(await read(SOL)).toEqual({ amount: null });
  expect(await read(MINT)).toEqual({ amount: null });
});

test("rejects an invalid mint", async () => {
  await makeWebContext();
  expect((await GET(new Request(`http://x/api/wallet/${OWNER}/balance?mint=nope`), { params: Promise.resolve({ owner: OWNER }) })).status).toBe(400);
});
