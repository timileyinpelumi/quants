import { registerWallet } from "@wallet-standard/wallet";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

const ICON = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#4C9DFF"/></svg>');
const CHAINS = ["solana:mainnet", "solana:devnet", "solana:localnet"] as const;

// Local end-to-end testing only: a Wallet Standard wallet backed by a keypair from NEXT_PUBLIC_TEST_WALLET_SECRET.
// Like Phantom it signs and sends wallet only transactions itself, and only signs ones that carry other signers.
export function registerTestWallet(secret: Uint8Array, rpcUrl: string) {
  const conn = new Connection(rpcUrl, "confirmed");
  // Read by the e2e specs: how many prompts of each kind, and the most transactions any one prompt carried.
  const calls = { signAndSend: 0, sign: 0, mostPerPrompt: 0 };
  (window as unknown as { __testWalletCalls: typeof calls }).__testWalletCalls = calls;
  const prompt = (kind: "signAndSend" | "sign", n: number) => { calls[kind]++; calls.mostPerPrompt = Math.max(calls.mostPerPrompt, n); };
  const kp = Keypair.fromSecretKey(secret);
  const account: WalletAccount = {
    address: kp.publicKey.toBase58(),
    publicKey: kp.publicKey.toBytes(),
    chains: CHAINS,
    features: ["solana:signAndSendTransaction", "solana:signTransaction", "solana:signMessage"],
  };
  const listeners = new Set<(p: { accounts: readonly WalletAccount[] }) => void>();
  let accounts: WalletAccount[] = [];
  const emit = () => listeners.forEach((l) => l({ accounts }));
  const sign = (bytes: Uint8Array) => {
    const tx = VersionedTransaction.deserialize(bytes);
    tx.sign([kp]);
    return tx.serialize();
  };

  const wallet: Wallet = {
    version: "1.0.0",
    name: "Test Wallet",
    icon: ICON as `data:image/svg+xml;base64,${string}`,
    chains: CHAINS,
    get accounts() { return accounts; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { accounts = [account]; emit(); return { accounts }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { accounts = []; emit(); } },
      "standard:events": { version: "1.0.0", on: (_e: "change", l: (p: { accounts: readonly WalletAccount[] }) => void) => { listeners.add(l); return () => listeners.delete(l); } },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
          prompt("sign", inputs.length);
          return inputs.map((i) => ({ signedTransaction: sign(i.transaction) }));
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: async (...inputs: { transaction: Uint8Array; options?: { preflightCommitment?: "processed" | "confirmed" | "finalized"; skipPreflight?: boolean; maxRetries?: number } }[]) => {
          prompt("signAndSend", inputs.length);
          const out: { signature: Uint8Array }[] = [];
          for (const i of inputs) {
            const signed = sign(i.transaction);
            await conn.sendRawTransaction(signed, { preflightCommitment: i.options?.preflightCommitment ?? "confirmed", skipPreflight: i.options?.skipPreflight, maxRetries: i.options?.maxRetries });
            out.push({ signature: VersionedTransaction.deserialize(signed).signatures[0]! });
          }
          return out;
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs: { message: Uint8Array }[]) => inputs.map((i) => ({ signedMessage: i.message, signature: nacl.sign.detached(i.message, kp.secretKey) })),
      },
    } as Wallet["features"],
  };
  registerWallet(wallet);
}
