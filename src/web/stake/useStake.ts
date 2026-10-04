"use client";
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { sendOne } from "@/web/wallet/send";
import { reportSendFailure } from "@/web/wallet/report";
import { tokenBalance } from "@/web/wallet/balance";

export type Tier = { id: string; lockSeconds: number; multiplierBps: number };
export type Position = {
  tierId: string; multiplierBps: number; lockSeconds: number; staked: string; unlocksAt: number; locked: boolean;
  earned: { mint: string; symbol: string | null; decimals: number | null; amount: string }[];
  paysAt: number | null; paying: boolean;
  exitPreview: { back: string; burned: string; penaltyBps: number; daysLeft: number } | null;
};

export const STAKE_DECIMALS = 6;
export const days = (s: number) => Math.round(s / 86_400);
export const mult = (bps: number) => `${bps / 10_000}x`;
export const dateOf = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function toBase(v: string, decimals = STAKE_DECIMALS): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [w, f = ""] = v.split(".");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals));
}

export function useStake(mint: string) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const modal = useWalletModal();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = wallet.publicKey?.toBase58();

  const refresh = useCallback(async () => {
    if (!owner) { setPositions([]); setBalance(null); return; }
    const [p, b] = await Promise.all([
      fetch(`/api/launches/${mint}/positions?owner=${owner}`).then((r) => r.json()).catch(() => ({ positions: [] })),
      tokenBalance(connection, mint, new PublicKey(owner)),
    ]);
    setPositions(p.positions ?? []);
    setBalance(b);
  }, [owner, mint, connection]);

  useEffect(() => { refresh(); }, [refresh]);

  async function act(action: "stake" | "claim" | "exit" | "withdraw", tierId: string, body: object = {}): Promise<boolean> {
    if (!owner) { modal.setVisible(true); return false; }
    setError(null);
    setBusy(`${action}:${tierId}`);
    try {
      const r = await fetch(`/api/stake/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mint, tierId, owner, ...body }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Something went wrong. Try again.");
      await sendOne(wallet, connection, j.transaction);
      await refresh();
      return true;
    } catch (e) {
      reportSendFailure(`stake:${action}`, e, wallet.wallet?.adapter.name);
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { owner, balance, positions, busy, error, act, refresh };
}
