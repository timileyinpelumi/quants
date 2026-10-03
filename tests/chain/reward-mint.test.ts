import { test, expect } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ExtensionType } from "@solana/spl-token";
import { readMint } from "../../src/chain/mints";
import { rewardMintChecker, rewardMintProblem } from "../../src/chain/reward-mint";
import { mintAccount, mintData, pausable, scaledUi, transferFee, transferHook, type Ext } from "../helpers/mint-data";

const addr = Keypair.generate().publicKey;
const ext = (type: ExtensionType, len: number): Ext => ({ type, data: Buffer.alloc(len) });
const metadataPointer = ext(ExtensionType.MetadataPointer, 64);
const tokenMetadata = ext(ExtensionType.TokenMetadata, 120);
const closeAuthority = ext(ExtensionType.MintCloseAuthority, 32);
const problem = (exts: Ext[], token2022 = true) => rewardMintProblem(readMint(addr, mintAccount(mintData(6, exts), token2022)));

test("classic mints and Token-2022 mints with metadata or a close authority only can be rewards", () => {
  expect(problem([], false)).toBeNull();
  expect(problem([])).toBeNull();
  expect(problem([metadataPointer, tokenMetadata])).toBeNull();
  expect(problem([metadataPointer, tokenMetadata, closeAuthority])).toBeNull();
  expect(problem([ext(ExtensionType.ConfidentialTransferMint, 65)])).toBeNull();
});

test("fee bearing, hooked, delegated, frozen by default, scaled or pausable Token-2022 mints cannot", () => {
  expect(problem([metadataPointer, transferFee()])).toBe("has the transfer fee config extension");
  expect(problem([transferHook(PublicKey.default)])).toBe("has the transfer hook extension");
  expect(problem([ext(ExtensionType.PermanentDelegate, 32)])).toBe("has the permanent delegate extension");
  expect(problem([ext(ExtensionType.DefaultAccountState, 1)])).toBe("has the default account state extension");
  expect(problem([ext(ExtensionType.InterestBearingConfig, 52)])).toBe("has the interest bearing config extension");
  expect(problem([scaledUi(1), pausable(false)])).toBe("has the scaled ui amount config and pausable config extensions");
  expect(problem([ext(ExtensionType.GroupMemberPointer, 64)])).toBe("has the group member pointer extension");
});

test("the checker reads mints in batches, remembers answers and does not remember missing mints", async () => {
  const good = Keypair.generate().publicKey, bad = Keypair.generate().publicKey, gone = Keypair.generate().publicKey, notMint = Keypair.generate().publicKey;
  const accounts = new Map<string, unknown>([
    [good.toBase58(), mintAccount(mintData(6, [metadataPointer, tokenMetadata]))],
    [bad.toBase58(), mintAccount(mintData(6, [transferFee()]))],
    [notMint.toBase58(), { ...mintAccount(mintData(6)), owner: PublicKey.default }],
  ]);
  const calls: number[] = [];
  const check = rewardMintChecker({ getMultipleAccountsInfo: async (keys: PublicKey[]) => { calls.push(keys.length); return keys.map((k) => accounts.get(k.toBase58()) ?? null); } } as any);
  const r = await check([good, bad, gone, notMint].map((k) => k.toBase58()));
  expect(r.get(good.toBase58())).toEqual({ program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", problem: null });
  expect(r.get(bad.toBase58())!.problem).toBe("has the transfer fee config extension");
  expect(r.get(gone.toBase58())!.problem).toBe("was not found on chain");
  expect(r.get(notMint.toBase58())!.problem).toBe("is not a token mint");
  await check([good.toBase58(), bad.toBase58(), gone.toBase58()]);
  expect(calls).toEqual([4, 1]);
  const many = Array.from({ length: 150 }, () => Keypair.generate().publicKey.toBase58());
  await check(many);
  expect(calls.slice(2)).toEqual([100, 50]);
});
