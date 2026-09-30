"use client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { registerTestWallet } from "./test-wallet";

const TEST_SECRET = process.env.NEXT_PUBLIC_TEST_WALLET_SECRET;
if (typeof window !== "undefined" && TEST_SECRET) registerTestWallet(Uint8Array.from(JSON.parse(TEST_SECRET)));

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899"}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
