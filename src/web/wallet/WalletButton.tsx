"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Avatar } from "@/web/ui/Avatar";
import { Jazzicon } from "@/web/ui/Jazzicon";
import { fmtAmount, shortAddr } from "@/web/ui/format";

type Held = { mint: string; amount: string; decimals: number; symbol: string | null; name: string | null; image: string | null; kind: "launch" | "platform" | "reward" | "other" };
const KIND: Record<Held["kind"], string> = { launch: "Launched here", platform: "Platform token", reward: "Reward token", other: "Other" };

export function WalletButton() {
  const wallet = useWallet();
  const modal = useWalletModal();
  const [open, setOpen] = useState(false);
  const owner = wallet.publicKey?.toBase58();

  if (!owner) {
    return (
      <button type="button" onClick={() => modal.setVisible(true)} disabled={wallet.connecting} className="font-display font-bold text-sm md:text-[15px] px-5 min-h-11 rounded-full bg-ink text-ground cursor-pointer disabled:opacity-60">
        {wallet.connecting ? "Connecting" : "Connect wallet"}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Wallet ${owner}`}
        className="flex items-center gap-2.5 pl-1.5 pr-4 min-h-11 rounded-full bg-raised-2 border border-white/10 hover:border-white/25 cursor-pointer"
      >
        <Jazzicon address={owner} size={30} />
        <span className="font-mono text-sm">{shortAddr(owner)}</span>
      </button>
      {open && <AccountModal owner={owner} onClose={() => setOpen(false)} />}
    </>
  );
}

function AccountModal({ owner, onClose }: { owner: string; onClose: () => void }) {
  const wallet = useWallet();
  const modal = useWalletModal();
  const [data, setData] = useState<{ sol: string; tokens: Held[] } | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await fetch(`/api/wallet/${owner}`);
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      setError(true);
    }
  }, [owner]);

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [load, onClose]);

  const copy = async () => { await navigator.clipboard.writeText(owner); setCopied(true); setTimeout(() => setCopied(false), 1200); };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-start justify-center md:justify-end p-0 md:p-6 md:pt-24">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default" />
      <div role="dialog" aria-modal="true" aria-label="Your wallet" className="panel relative w-full md:w-[420px] max-h-[85vh] flex flex-col rounded-b-none md:rounded-[32px]">
        <div className="flex items-center gap-4 p-6 pb-4">
          <Jazzicon address={owner} size={52} />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="font-mono text-base truncate">{shortAddr(owner)}</span>
            <button type="button" onClick={copy} className="self-start text-[13px] text-lime cursor-pointer min-h-6">{copied ? "Copied" : "Copy address"}</button>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="w-11 h-11 rounded-full border border-white/10 text-muted hover:text-ink flex items-center justify-center cursor-pointer shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="mx-6 px-5 py-4 rounded-[22px] bg-ground border border-white/[0.06] flex items-end justify-between">
          <span className="flex flex-col gap-1">
            <span className="text-[13px] text-muted">SOL balance</span>
            <span className="font-display font-black text-3xl tracking-tight">{data ? fmtAmount(data.sol, 9, 4) : "…"}</span>
          </span>
          <button type="button" onClick={load} className="text-[13px] text-muted hover:text-ink cursor-pointer min-h-11">Refresh</button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 min-h-32">
          <p className="m-0 px-3 pb-2 text-[13px] text-muted">Tokens</p>
          {error && <p className="m-0 px-3 py-3 text-sm text-burn">Balances could not load. Try Refresh.</p>}
          {!data && !error && [0, 1, 2].map((i) => <div key={i} className="mx-3 my-1.5 h-12 rounded-2xl bg-white/[0.04] animate-pulse" />)}
          {data && data.tokens.length === 0 && <p className="m-0 px-3 py-3 text-sm text-muted">No tokens in this wallet yet.</p>}
          {data?.tokens.map((t) => {
            const row = (
              <>
                <Avatar seed={t.mint} label={t.symbol ?? "?"} image={t.image} size={40} />
                <span className="flex flex-col min-w-0">
                  <span className="font-semibold truncate">{t.symbol ?? shortAddr(t.mint)}</span>
                  <span className="text-[13px] text-muted truncate">{KIND[t.kind]}</span>
                </span>
                <span className="font-mono text-sm text-right">{fmtAmount(t.amount, t.decimals, 4)}</span>
              </>
            );
            const cls = "grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 items-center px-3 py-2.5 rounded-2xl min-h-14";
            return t.kind === "launch"
              ? <Link key={t.mint} href={`/t/${t.mint}`} onClick={onClose} className={`${cls} hover:bg-white/[0.04]`}>{row}</Link>
              : <div key={t.mint} className={cls}>{row}</div>;
          })}
        </div>

        <div className="grid grid-cols-3 gap-2 p-6 pt-3 border-t line">
          <Link href="/portfolio" onClick={onClose} className="col-span-3 flex items-center justify-center font-display font-bold text-[15px] min-h-12 rounded-full bg-violet-light text-ground glow-violet">Your stakes</Link>
          <button type="button" onClick={() => { onClose(); modal.setVisible(true); }} className="col-span-1 text-sm font-semibold min-h-11 rounded-full bg-raised-2 border border-white/10 cursor-pointer">Switch</button>
          <button type="button" onClick={async () => { onClose(); await wallet.disconnect(); }} className="col-span-2 text-sm font-semibold min-h-11 rounded-full border border-burn/40 text-burn cursor-pointer">Disconnect</button>
        </div>
      </div>
    </div>
  );
}
