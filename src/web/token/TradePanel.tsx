"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/web/ui/Button";
import { fmtAmount } from "@/web/ui/format";
import { signAndSendAll } from "@/web/wallet/send";
import { tokenBalance } from "@/web/wallet/balance";
import { rawToUi, uiToRaw } from "@/web/ui/scaled";
import { StakeForm } from "@/web/stake/StakeForm";
import { useUsd, usdText } from "@/web/ui/usd";
import type { Tier } from "@/web/stake/useStake";
import type { StakingOpens } from "@/web/server/reads";

const SOL = "So11111111111111111111111111111111111111112";
const FEE_RESERVE = 10_000_000n;
type Quote = { amountIn: string; filledIn: string; amountOut: string; minOut: string; fee: string; venue: "curve" | "damm" };

function toBase(v: string, decimals: number): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [w, f = ""] = v.split(".");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals));
}

export function TradePanel({ mint, symbol, quoteMint, quoteSymbol, quoteDecimals, quoteUiMultiplier = 1, stake }: {
  mint: string; symbol: string; quoteMint: string; quoteSymbol: string; quoteDecimals: number;
  /** Scaled UI multiplier of a Token-2022 quote: amounts show as the wallet shows them, transactions use raw amounts. */
  quoteUiMultiplier?: number;
  /** Null for trading only launches, which have no staking. */
  stake: { tiers: Tier[]; maxPenaltyBps: number; ready: boolean; earns: string; opens: StakingOpens | null } | null;
}) {
  const wallet = useWallet();
  const { connection } = useConnection();
  const modal = useWalletModal();
  const [tab, setTab] = useState<"buy" | "sell" | "stake">("buy");
  const side = tab === "sell" ? "sell" : "buy";
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippage] = useState(100);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ quote: bigint; token: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const owner = wallet.publicKey?.toBase58();

  const inDecimals = side === "buy" ? quoteDecimals : 6;
  const outDecimals = side === "buy" ? 6 : quoteDecimals;
  const inSymbol = side === "buy" ? quoteSymbol : symbol;
  const outSymbol = side === "buy" ? symbol : quoteSymbol;
  const inMult = side === "buy" ? quoteUiMultiplier : 1;
  const outMult = side === "buy" ? 1 : quoteUiMultiplier;
  const amountBase = useMemo(() => { const v = toBase(amount, inDecimals); return v === null ? null : uiToRaw(v, inMult); }, [amount, inDecimals, inMult]);

  const loadBalances = useCallback(async () => {
    if (!owner) { setBalances(null); return; }
    const o = new PublicKey(owner);
    const spl = (m: string) => tokenBalance(connection, m, o);
    const [q, t] = await Promise.all([quoteMint === SOL ? connection.getBalance(o).then(BigInt) : spl(quoteMint), spl(mint)]);
    setBalances({ quote: q, token: t });
  }, [owner, connection, mint, quoteMint]);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!amountBase || amountBase <= 0n) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/trade/quote?mint=${mint}&side=${side}&amount=${amountBase}&slippageBps=${slippageBps}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error?.message ?? "No quote available. Try again in a moment.");
        setQuote(j);
      } catch (e) {
        setQuoteError(e instanceof Error ? e.message : "No quote available. Try again in a moment.");
      }
    }, 300);
    return () => clearTimeout(t);
  }, [amountBase, side, slippageBps, mint]);

  const px = useUsd([quoteMint, mint]);
  const inPrice = side === "buy" ? px[quoteMint] : px[mint];
  const outPrice = side === "buy" ? px[mint] : px[quoteMint];
  const whole = (base: string | bigint, decimals: number, mult = 1) => Number(rawToUi(BigInt(base), mult)) / 10 ** decimals;
  const have = balances ? (side === "buy" ? balances.quote : balances.token) : null;
  const spendable = have === null ? null : side === "buy" && quoteMint === SOL ? (have > FEE_RESERVE ? have - FEE_RESERVE : 0n) : have;
  const tooMuch = amountBase !== null && spendable !== null && amountBase > spendable;
  const partial = quote && BigInt(quote.filledIn) < BigInt(quote.amountIn);

  const setFraction = (num: bigint, den: bigint) => { if (spendable !== null) setAmount(fmtAmount(rawToUi((spendable * num) / den, inMult), inDecimals, inDecimals).replace(/,/g, "")); };
  const presets = side === "buy"
    ? (quoteMint === SOL ? ["0.1", "0.5", "1", "5"] : ["100", "1000", "10000"]).map((v) => ({ label: v, run: () => setAmount(v) }))
    : [["25%", 1n, 4n], ["50%", 1n, 2n], ["Max", 1n, 1n]].map(([l, n, d]) => ({ label: l as string, run: () => setFraction(n as bigint, d as bigint) }));

  async function trade() {
    if (!owner) { modal.setVisible(true); return; }
    if (!quote || !amountBase) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/trade/swap", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint, side, amount: amountBase.toString(), minOut: quote.minOut, owner }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Something went wrong. Try again.");
      await signAndSendAll(wallet, connection, [j.transaction]);
      setMsg({ ok: true, text: `${side === "buy" ? "Bought" : "Sold"}. Balances updated.` });
      setAmount("");
      await loadBalances();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel flex flex-col gap-4 p-5 md:p-6 min-w-0">
      <div role="group" aria-label={stake ? "Buy, sell or stake" : "Buy or sell"} className={`grid ${stake ? "grid-cols-3" : "grid-cols-2"} gap-1.5 p-1.5 bg-ground rounded-full`}>
        {(["buy", "sell", "stake"] as const).filter((s) => s !== "stake" || stake).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={tab === s}
            onClick={() => { setTab(s); setAmount(""); setMsg(null); }}
            className={`font-display font-bold text-[15px] py-3 min-h-11 rounded-full cursor-pointer capitalize ${tab === s ? (s === "buy" ? "bg-lime text-ground" : s === "sell" ? "bg-burn text-ground" : "bg-violet-light text-ground") : "text-muted hover:text-ink"}`}
          >
            {s}
          </button>
        ))}
      </div>
      {tab === "stake" && stake ? <StakeForm mint={mint} symbol={symbol} {...stake} /> : <>

      <label className="flex flex-col gap-2.5 text-[13px] text-muted">
        <span className="flex justify-between"><span>You pay</span>{have !== null && <span className="font-mono">Balance {fmtAmount(rawToUi(have, inMult), inDecimals, 4)} {inSymbol}{usdText(whole(have, inDecimals, inMult), inPrice) && <span className="text-faint"> · {usdText(whole(have, inDecimals, inMult), inPrice)}</span>}</span>}</span>
        <span className="flex items-center bg-ground border border-white/10 rounded-[20px] px-5 focus-within:border-lime/60">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-label={`Amount of ${inSymbol}`} className="flex-1 min-w-0 font-display font-bold text-[28px] md:text-[32px] text-ink bg-transparent border-0 py-4 outline-none" />
          <span className="flex flex-col items-end pl-2">
            <span className="font-display font-bold text-[15px] text-muted">{inSymbol}</span>
            {amountBase && amountBase > 0n && usdText(whole(amountBase, inDecimals, inMult), inPrice) && <span className="font-mono text-[12px] text-faint">≈ {usdText(whole(amountBase, inDecimals, inMult), inPrice)}</span>}
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        {presets.map((p) => (
          <button key={p.label} type="button" onClick={p.run} className="flex-1 font-mono text-[13px] min-h-11 rounded-full bg-raised-2 border border-white/[0.08] cursor-pointer hover:border-white/20">{p.label}</button>
        ))}
      </div>

      <div className="flex flex-col text-sm">
        <span className="flex justify-between py-2 border-b line"><span className="text-muted">You get about</span><span className="font-mono">{quote ? `${fmtAmount(rawToUi(BigInt(quote.amountOut), outMult), outDecimals, 4)} ${outSymbol}` : "…"}{quote && usdText(whole(quote.amountOut, outDecimals, outMult), outPrice) && <span className="text-faint"> ≈ {usdText(whole(quote.amountOut, outDecimals, outMult), outPrice)}</span>}</span></span>
        <span className="flex justify-between py-2 border-b line"><span className="text-muted">At least</span><span className="font-mono">{quote ? `${fmtAmount(rawToUi(BigInt(quote.minOut), outMult), outDecimals, 4)} ${outSymbol}` : "…"}</span></span>
        <span className="flex justify-between items-center py-2">
          <span className="text-muted">Max slippage</span>
          <span className="flex gap-1">
            {[50, 100, 300].map((b) => (
              <button key={b} type="button" aria-pressed={slippageBps === b} onClick={() => setSlippage(b)} className={`font-mono text-[13px] px-2.5 min-h-9 rounded-full cursor-pointer ${slippageBps === b ? "bg-raised-2 border border-white/15 text-ink" : "text-muted"}`}>{b / 100}%</button>
            ))}
          </span>
        </span>
      </div>

      {partial && <p className="m-0 text-sm text-violet-light">Only {fmtAmount(rawToUi(BigInt(quote!.filledIn), inMult), inDecimals, 4)} {inSymbol} fills before this token graduates. The rest stays in your wallet.</p>}
      {tooMuch && <p className="m-0 text-sm text-burn">Not enough {inSymbol}{side === "buy" && quoteMint === SOL ? " after the 0.01 SOL kept for fees" : ""}.</p>}
      {quoteError && <p className="m-0 text-sm text-burn">{quoteError}</p>}
      {msg && <p role="status" className={`m-0 text-sm ${msg.ok ? "text-lime" : "text-burn"}`}>{msg.text}</p>}

      <Button size="lg" variant={side === "buy" ? "lime" : "burn"} disabled={busy || (!!owner && (!quote || tooMuch))} onClick={trade}>
        {busy ? "Approve in your wallet" : !owner ? "Connect wallet" : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
      </Button>
      <p className="m-0 text-[12px] text-faint text-center">{quote?.venue === "damm" ? "Trades on the graduated Meteora pool" : "Trades on the bonding curve"}</p>
      </>}
    </div>
  );
}
