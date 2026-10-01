import { test, expect, afterAll } from "bun:test";
import { Connection, Keypair } from "@solana/web3.js";
import { address } from "@solana/kit";
import { getUserStatePDA, FARMS_PROGRAM_ADDRESS } from "@kamino-finance/farms-sdk";
import { SolanaChain } from "../../src/chain/solana";
import { KaminoBackend } from "../../src/staking/kamino";

const calls: { method: string; params: any }[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = await req.json() as any;
    calls.push({ method: body.method, params: body.params });
    const result = body.method === "getMultipleAccounts"
      ? { context: { slot: 1 }, value: body.params[0].map(() => null) }
      : body.method === "getProgramAccounts" ? [] : null;
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  },
});
afterAll(() => server.stop(true));

const url = `http://127.0.0.1:${server.port}`;
const kamino = new KaminoBackend(new SolanaChain(new Connection(url), Keypair.generate(), Keypair.generate()), url, Keypair.generate().publicKey.toBase58());
const owner = Keypair.generate().publicKey.toBase58();
const farms = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];

test("position reads the derived user state account instead of scanning the program", async () => {
  calls.length = 0;
  expect(await kamino.position(owner, farms[0]!)).toBeNull();
  expect(calls.map((c) => c.method)).toEqual(["getMultipleAccounts"]);
  const pda = await getUserStatePDA(FARMS_PROGRAM_ADDRESS, address(farms[0]!), address(owner));
  expect(calls[0]!.params[0]).toEqual([pda]);
});

test("userFarms checks the given farms with one batched read", async () => {
  calls.length = 0;
  expect(await kamino.userFarms(owner, farms)).toEqual([]);
  expect(calls.map((c) => c.method)).toEqual(["getMultipleAccounts"]);
  expect(calls[0]!.params[0].length).toBe(2);
});
