import { test, expect } from "bun:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import {
  NATIVE_MINT as WSOL, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction,
  createTransferInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DAMM_V2, DammSwap, assertSafeDammSwap, poolTokens, type DammBackend, type PoolToken } from "../../src/jupiter/damm";
import { NATIVE_MINT } from "../../src/domain/types";

const keeper = Keypair.generate();
const ZEC = Keypair.generate().publicKey;
const POOL = Keypair.generate().publicKey;
const tokens: PoolToken[] = [
  { mint: ZEC.toBase58(), symbol: "dZEC", name: "Devnet ZEC", decimals: 8, pool: POOL.toBase58() },
  { mint: Keypair.generate().publicKey.toBase58(), symbol: "dJUP", name: "Devnet JUP", decimals: 6, pool: Keypair.generate().publicKey.toBase58() },
];

const SWAP = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);
function swapIx(o: { pool?: PublicKey; payer?: PublicKey; output?: PublicKey; data?: Buffer } = {}) {
  const payer = o.payer ?? keeper.publicKey;
  const ata = (m: PublicKey) => getAssociatedTokenAddressSync(m, payer, true, TOKEN_PROGRAM_ID);
  const keys = [
    Keypair.generate().publicKey, o.pool ?? POOL, ata(WSOL), o.output ?? ata(ZEC), Keypair.generate().publicKey, Keypair.generate().publicKey,
    ZEC, WSOL, payer, TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  ].map((pubkey, i) => ({ pubkey, isSigner: i === 8, isWritable: true }));
  return new TransactionInstruction({ programId: new PublicKey(DAMM_V2), keys, data: o.data ?? Buffer.concat([SWAP, Buffer.alloc(16)]) });
}
const wsolAta = getAssociatedTokenAddressSync(WSOL, keeper.publicKey);
const goodIxs = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, wsolAta, keeper.publicKey, WSOL),
  createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, getAssociatedTokenAddressSync(ZEC, keeper.publicKey), keeper.publicKey, ZEC),
  SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: wsolAta, lamports: 1000 }),
  createSyncNativeInstruction(wsolAta),
  swapIx(),
  createCloseAccountInstruction(wsolAta, keeper.publicKey, keeper.publicKey),
];
const pools = new Set(tokens.map((t) => t.pool));

class FakeBackend implements DammBackend {
  quotes: unknown[] = [];
  ixs: TransactionInstruction[] = goodIxs();
  swaps: unknown[] = [];
  async quote(pool: string, inputMint: string, amountIn: bigint, slippageBps: number) {
    this.quotes.push({ pool, inputMint, amountIn, slippageBps });
    return { out: amountIn / 2n, minOut: (amountIn / 2n) * 99n / 100n, impactBps: 37 };
  }
  async swapIxs(pool: string, inputMint: string, amountIn: bigint, minOut: bigint, payer: PublicKey) {
    this.swaps.push({ pool, inputMint, amountIn, minOut, payer: payer.toBase58() });
    return this.ixs;
  }
  async priceInSol() { return 0.5; }
}

function adapter(backend = new FakeBackend()) {
  const signed: Transaction[] = [];
  const chain = {
    keeper,
    async signLegacy(tx: Transaction) { signed.push(tx); return { signature: "sig", lastValidBlockHeight: 1n, send: async () => {} }; },
  };
  const blockhash = async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 99 });
  return { d: new DammSwap(chain, backend, tokens, blockhash), backend, signed };
}

test("quotes SOL to a pool token and back through that token's pool", async () => {
  const { d, backend } = adapter();
  const buy = await d.quote(NATIVE_MINT, ZEC.toBase58(), 1_000n, 100);
  expect(buy).toMatchObject({ inAmount: 1_000n, outAmount: 500n, priceImpactBps: 37 });
  expect(buy!.raw).toEqual({ pool: POOL.toBase58(), inputMint: NATIVE_MINT, outputMint: ZEC.toBase58(), minOut: "495" });
  const sell = await d.quote(ZEC.toBase58(), NATIVE_MINT, 2_000n, 50);
  expect(sell!.outAmount).toBe(1_000n);
  expect(backend.quotes).toEqual([
    { pool: POOL.toBase58(), inputMint: NATIVE_MINT, amountIn: 1_000n, slippageBps: 100 },
    { pool: POOL.toBase58(), inputMint: ZEC.toBase58(), amountIn: 2_000n, slippageBps: 50 },
  ]);
});

test("no route between two pool tokens, to an unknown mint or for nothing", async () => {
  const { d, backend } = adapter();
  expect(await d.quote(ZEC.toBase58(), tokens[1]!.mint, 1_000n, 100)).toBeNull();
  expect(await d.quote(NATIVE_MINT, Keypair.generate().publicKey.toBase58(), 1_000n, 100)).toBeNull();
  expect(await d.quote(NATIVE_MINT, NATIVE_MINT, 1_000n, 100)).toBeNull();
  expect(await d.quote(NATIVE_MINT, ZEC.toBase58(), 0n, 100)).toBeNull();
  expect(backend.quotes).toHaveLength(0);
});

test("the keeper swap uses the quoted minimum and is signed as a legacy transaction", async () => {
  const { d, backend, signed } = adapter();
  const q = await d.quote(NATIVE_MINT, ZEC.toBase58(), 1_000n, 100);
  const tx = await d.buildSwap(q!);
  expect(tx.signature).toBe("sig");
  expect(backend.swaps).toEqual([{ pool: POOL.toBase58(), inputMint: NATIVE_MINT, amountIn: 1_000n, minOut: 495n, payer: keeper.publicKey.toBase58() }]);
  expect(signed[0]!.instructions).toHaveLength(7);
});

test("a keeper swap with anything unexpected is refused before signing", async () => {
  const cases: [string, TransactionInstruction[]][] = [
    ["unknown pool", [swapIx({ pool: Keypair.generate().publicKey })]],
    ["other payer", [swapIx({ payer: Keypair.generate().publicKey })]],
    ["output elsewhere", [swapIx({ output: Keypair.generate().publicKey })]],
    ["not a swap", [swapIx({ data: Buffer.alloc(24) })]],
    ["SOL out", [SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })]],
    ["token out", [createTransferInstruction(wsolAta, Keypair.generate().publicKey, keeper.publicKey, 1)]],
    ["close elsewhere", [createCloseAccountInstruction(wsolAta, Keypair.generate().publicKey, keeper.publicKey)]],
    ["ata for someone else", [createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, wsolAta, Keypair.generate().publicKey, WSOL)]],
    ["other program", [new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) })]],
  ];
  for (const [name, ixs] of cases) {
    expect(() => assertSafeDammSwap(ixs, keeper.publicKey, pools), name).toThrow(/swap refused/);
  }
  expect(() => assertSafeDammSwap(goodIxs(), keeper.publicKey, pools)).not.toThrow();

  const backend = new FakeBackend();
  backend.ixs = [...goodIxs(), SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
  const { d, signed } = adapter(backend);
  const q = await d.quote(NATIVE_MINT, ZEC.toBase58(), 1_000n, 100);
  await expect(d.buildSwap(q!)).rejects.toThrow(/swap refused/);
  expect(signed).toHaveLength(0);
});

test("a quote naming a pool outside the list is refused", async () => {
  const { d } = adapter();
  const q = { inAmount: 1n, outAmount: 1n, priceImpactBps: 0, raw: { pool: Keypair.generate().publicKey.toBase58(), inputMint: NATIVE_MINT, outputMint: ZEC.toBase58(), minOut: "1" } };
  await expect(d.buildSwap(q)).rejects.toThrow(/not a known pool/);
});

test("an unsigned user swap is a v0 transaction paid by the user", async () => {
  const { d, backend } = adapter();
  const user = Keypair.generate().publicKey;
  const q = await d.quote(NATIVE_MINT, ZEC.toBase58(), 1_000n, 100);
  const r = await d.buildUnsignedSwap(q!, user.toBase58());
  const tx = VersionedTransaction.deserialize(Buffer.from(r.base64, "base64"));
  expect(tx.message.staticAccountKeys[0]!.equals(user)).toBe(true);
  expect(r.lastValidBlockHeight).toBe(99n);
  expect((backend.swaps[0] as any).payer).toBe(user.toBase58());
});

test("the token list stands in for Jupiter's verified list", async () => {
  const { d } = adapter();
  expect((await d.popularVerified()).map((t) => t.symbol)).toEqual(["dZEC", "dJUP"]);
  expect((await d.searchVerified("jup")).map((t) => t.symbol)).toEqual(["dJUP"]);
  expect((await d.searchVerified(ZEC.toBase58()))[0]).toEqual({ mint: ZEC.toBase58(), symbol: "dZEC", name: "Devnet ZEC", icon: null, decimals: 8, tokenProgram: TOKEN_PROGRAM_ID.toBase58() });
  expect(await d.isVerified(ZEC.toBase58())).toBe(true);
  expect(await d.isVerified(NATIVE_MINT)).toBe(false);
});

test("poolTokens reads DEVNET_TOKENS", () => {
  expect(poolTokens({})).toEqual([]);
  expect(poolTokens({ DEVNET_TOKENS: JSON.stringify(tokens) })).toEqual(tokens);
});
