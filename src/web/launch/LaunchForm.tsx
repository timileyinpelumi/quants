"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Avatar } from "@/web/ui/Avatar";
import { Button } from "@/web/ui/Button";
import { Field, Suffixed, TextArea, TextInput, inputClass } from "@/web/ui/Field";
import { Segmented } from "@/web/ui/Segmented";
import { fmtAmount, lockLabel, lockShort } from "@/web/ui/format";
import { signAndSendAll, SendError, type UnsignedTx } from "@/web/wallet/send";
import { BasketPicker, basketTotal, type BasketItem } from "./BasketPicker";
import { launchCost } from "@/domain/launch-cost";
import { FEE_TIERS_BPS } from "@/domain/fees";
import { useUsd, usdText } from "@/web/ui/usd";

const SOL = "So11111111111111111111111111111111111111112";
export type QuoteOption = { mint: string; symbol: string; name: string; decimals: number; graduation: number; icon: string | null };
const FEES: readonly number[] = FEE_TIERS_BPS;

type Tier = { id: string; lockSeconds: number; multiplierBps: number };
type Status = "idle" | "uploading" | "preparing" | "signing" | "confirming";
const LABELS: Record<Status, string> = {
  idle: "", uploading: "Uploading image", preparing: "Preparing", signing: "Approve in your wallet", confirming: "Confirming",
};

async function imageProblem(file: File): Promise<string | null> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Image must be PNG, JPEG or WebP";
  if (file.size > 2 * 1024 * 1024) return "Image must be 2 MB or smaller";
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width !== bmp.height) return "Image must be square";
  } catch {
    return "Image could not be read. Try another file.";
  }
  return null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "Something went wrong. Try again.");
  return j as T;
}

export function LaunchForm({ split, tiers, maxPenaltyBps, quotes }: {
  quotes: QuoteOption[];
  split: { basketBps: number; platformBps: number; creatorBps: number };
  tiers: Tier[];
  maxPenaltyBps: number;
}) {
  const router = useRouter();
  const wallet = useWallet();
  const { connection } = useConnection();
  const modal = useWalletModal();

  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [pair, setPair] = useState<string>(quotes[0]?.mint ?? SOL);
  const [fee, setFee] = useState(200);
  const [mode, setMode] = useState<"pair" | "basket">("basket");
  const [picked, setBasket] = useState<BasketItem[]>([]);
  const [devBuy, setDevBuy] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ mint: string; sig: string } | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    const problem = await imageProblem(file);
    setImageError(problem);
    if (problem) return;
    setImage(file);
    setPreview(URL.createObjectURL(file));
  };

  const devBuyLamports = useMemo(() => {
    const v = Number(devBuy);
    return devBuy.trim() === "" ? 0n : Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v * 1e9)) : null;
  }, [devBuy]);

  const pairQuote = quotes.find((q) => q.mint === pair);
  const pairLabel = pairQuote?.symbol ?? "SOL";
  const basket: BasketItem[] = mode === "pair"
    ? [{ mint: pair, symbol: pairLabel, name: pairQuote?.name ?? pairLabel, icon: pairQuote?.icon ?? null, decimals: pairQuote?.decimals ?? 9, weight: 100 }]
    : picked;

  const problems = [
    !image && "Add an image",
    !name.trim() && "Add a name",
    !/^[A-Za-z0-9]{1,10}$/.test(symbol) && "Symbol is 1 to 10 letters or numbers",
    basket.length === 0 && "Pick at least one reward token",
    basket.length > 0 && basketTotal(basket) !== 100 && "Basket weights must add up to 100",
    devBuyLamports === null && "First buy must be a number",
  ].filter(Boolean) as string[];

  const busy = status !== "idle";
  const solUsd = useUsd([SOL])[SOL];
  const { rent } = launchCost({ tiers }, Math.max(1, basket.length));
  const solText = (lamports: bigint) => `${fmtAmount(lamports, 9, 3)} SOL`;
  const usdOf = (lamports: bigint) => usdText(Number(lamports) / 1e9, solUsd);

  async function settle(p: { mint: string; sig: string }) {
    setStatus("confirming");
    for (let i = 0; i < 20; i++) {
      const { value } = await connection.getSignatureStatuses([p.sig], { searchTransactionHistory: true });
      const st = value[0];
      if (st?.err) { setPending(null); setError("The launch transaction failed on chain. Nothing was created. Try again."); setStatus("idle"); return; }
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
        try {
          await postJson("/api/launch/confirm", { signature: p.sig, mint: p.mint });
        } catch {
          // The keeper records launches that landed but were never confirmed, so the page will exist shortly either way.
        }
        router.push(`/t/${p.mint}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setPending(p);
    setError("Launch not confirmed yet. Don't launch again. If it landed, it shows on Explore within a few minutes.");
    setStatus("idle");
  }

  async function launch() {
    if (pending) { setError(null); await settle(pending); return; }
    if (!wallet.publicKey) { modal.setVisible(true); return; }
    if (problems.length) { setError(problems[0]!); return; }
    setError(null);
    let prepared: { mint: string; transactions: UnsignedTx[] } | null = null;
    try {
      setStatus("uploading");
      const form = new FormData();
      form.set("image", image!);
      form.set("name", name.trim());
      form.set("symbol", symbol);
      for (const [k, v] of Object.entries({ description, website, x, telegram })) if (v.trim()) form.set(k, v.trim());
      const metaRes = await fetch("/api/metadata", { method: "POST", body: form });
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.error?.message ?? "Image upload failed. Try again.");

      setStatus("preparing");
      prepared = await postJson<{ mint: string; transactions: UnsignedTx[] }>("/api/launch/prepare", {
        name: name.trim(), symbol, uri: meta.uri, image: meta.image, creator: wallet.publicKey.toBase58(),
        quoteMint: pair, feeTierBps: fee, devBuySol: (devBuyLamports ?? 0n).toString(),
        basket: basket.map((b) => ({ mint: b.mint, weightBps: b.weight * 100, symbol: b.symbol, decimals: b.decimals })),
      });

      setStatus("signing");
      const sigs = await signAndSendAll(wallet, connection, prepared.transactions);

      await settle({ mint: prepared.mint, sig: sigs[sigs.length - 1]! });
    } catch (e) {
      const count = prepared?.transactions.length ?? 0;
      if (e instanceof SendError && prepared && e.unconfirmed && e.confirmed.length === count - 1) {
        await settle({ mint: prepared.mint, sig: e.unconfirmed });
        return;
      }
      if (e instanceof SendError && count === 2 && e.confirmed.length === 1) {
        setError(`The swap to ${pairLabel} went through but the launch did not. The ${pairLabel} is in your wallet. Try again with a smaller first buy, or none.`);
      } else {
        setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      }
      setStatus("idle");
    }
  }

  const section = "grid grid-cols-1 md:grid-cols-[56px_minmax(0,1fr)] gap-4 md:gap-6 py-7 border-t line";
  const num = "hidden md:block font-display font-bold text-[15px] text-faint";

  return (
    <main className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] gap-10 lg:gap-16 wrap pt-10 md:pt-14 pb-16">
      <section className="flex flex-col gap-10 min-w-0">
        <div className="flex flex-col gap-3.5">
          <h1 className="m-0 font-display font-black text-[40px] md:text-[56px] leading-[1.02] tracking-[-0.03em]">Launch a token</h1>
          <p className="m-0 text-lg text-muted max-w-[560px] leading-normal">Pick up to ten reward tokens. Trading fees on your token buy them and pay them to its stakers. Longer locks earn a bigger share.</p>
        </div>

        <div className="flex flex-col">
          <div className={section}>
            <span className={num}>01</span>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] md:grid-cols-[132px_minmax(0,1fr)_200px] gap-5 items-start md:items-end">
              <div className="flex flex-col gap-2.5 text-[13px] text-muted row-span-2 md:row-span-1">
                <span>Image</span>
                <label className="w-28 h-28 md:w-[132px] md:h-[132px] rounded-[28px] border-[1.5px] border-dashed border-accent/45 bg-accent/5 flex flex-col items-center justify-center gap-2 text-accent text-[13px] cursor-pointer overflow-hidden focus-within:border-accent">
                  {preview ? (
                    <img src={preview} alt="Token image preview" className="w-full h-full object-cover" />
                  ) : (
                    <>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="M6 10l6-6 6 6" /><path d="M4 20h16" /></svg>
                      <span className="text-center px-2">Square image</span>
                    </>
                  )}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pickImage(e.target.files?.[0])} />
                </label>
              </div>
              <Field label="Name"><TextInput value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Cat Coin" /></Field>
              <Field label="Symbol"><TextInput font="display" value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="CAT" /></Field>
            </div>
            {imageError && <p className="md:col-start-2 m-0 text-sm text-burn">{imageError}</p>}
          </div>

          <div className={section}>
            <span className={num}>02</span>
            <div className="grid grid-cols-1 gap-7">
              <div className="flex flex-col gap-3">
                <span className="text-[13px] text-muted">Paired with</span>
                <div role="radiogroup" aria-label="Paired with" className="flex flex-wrap gap-2">
                  {quotes.map((q) => (
                    <button key={q.mint} type="button" role="radio" aria-checked={pair === q.mint} onClick={() => setPair(q.mint)}
                      className={`flex items-center gap-2 pl-2 pr-4 min-h-11 rounded-full border text-sm font-semibold cursor-pointer ${pair === q.mint ? "bg-raised-2 border-accent/60 text-ink" : "border-white/10 text-muted hover:text-ink"}`}>
                      <Avatar seed={q.mint} label={q.symbol} image={q.icon} size={24} />
                      {q.symbol}
                    </button>
                  ))}
                </div>
                <span className="text-[13px] text-muted">Your token trades against {pairLabel}. Fees are earned in {pairLabel}.</span>
              </div>
              <div className="flex flex-col gap-3">
                <span className="text-[13px] text-muted">Trading fee</span>
                <Segmented label="Trading fee" value={fee} onChange={setFee} options={FEES.map((f) => ({ value: f, label: `${f / 100}%` }))} />
              </div>
            </div>
          </div>

          <div className={section}>
            <span className={num}>03</span>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <span className="text-[13px] text-muted">Stakers earn</span>
                <Segmented label="Stakers earn" value={mode} onChange={setMode}
                  options={[{ value: "pair", label: "The pair" }, { value: "basket", label: "A basket" }]} />
              </div>
              {mode === "pair" ? (
                <div className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-surface border line">
                  <Avatar seed={pair} label={pairLabel} image={pairQuote?.icon} size={40} />
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-display font-bold">{pairLabel}, 100%</span>
                    <span className="text-[13px] text-muted">The stakers&apos; share of fees is paid to them in {pairLabel} directly, without buying other tokens.</span>
                  </span>
                </div>
              ) : (
                <BasketPicker value={picked} onChange={setBasket} />
              )}
            </div>
          </div>

          <div className={section}>
            <span className={num}>04</span>
            <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-4 md:gap-8 items-end">
              <Field label="First buy (optional)">
                <Suffixed suffix="SOL">
                  <input inputMode="decimal" value={devBuy} onChange={(e) => setDevBuy(e.target.value)} placeholder="0" className="flex-1 min-w-0 font-mono text-xl text-ink bg-transparent border-0 py-[18px] outline-none" />
                </Suffixed>
              </Field>
              <p className="m-0 text-sm text-muted md:pb-[18px]">
                {devBuyLamports && devBuyLamports > 0n && usdOf(devBuyLamports) ? `About ${usdOf(devBuyLamports)}. ` : ""}
                {pair === SOL ? "Bought on the curve in the same approval as the launch." : `Swapped to ${pairLabel}, then bought on the curve, in one approval.`}
              </p>
            </div>
          </div>

          <div className={`${section} border-b`}>
            <span className={num}>05</span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="md:col-span-3">
                <Field label="Description (optional)"><TextArea value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="What is this token about?" /></Field>
              </div>
              <Field label="Website"><input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className={`${inputClass} text-base`} /></Field>
              <Field label="X"><input value={x} onChange={(e) => setX(e.target.value)} placeholder="https://x.com/" className={`${inputClass} text-base`} /></Field>
              <Field label="Telegram"><input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="https://t.me/" className={`${inputClass} text-base`} /></Field>
            </div>
          </div>
        </div>
      </section>

      <aside className="panel flex flex-col gap-7 self-start p-6 md:p-8 lg:sticky lg:top-8">
        <div className="flex items-center gap-4">
          {preview ? <img src={preview} alt="" className="w-16 h-16 rounded-[20px] object-cover puff" /> : <Avatar seed={symbol || "quants"} label={symbol || "Q"} size={64} />}
          <span className="flex flex-col gap-1 min-w-0">
            <span className="font-display font-black text-[26px] tracking-tight truncate">{symbol || "Your token"}</span>
            <span className="text-sm text-muted truncate">{name || "Name"} · {symbol || "TOKEN"} / {pairLabel} · {fee / 100}% fee</span>
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[13px] text-muted">Where each trading fee goes</span>
          <div className="flex h-3.5 rounded-full overflow-hidden gap-[3px]">
            <span className="bg-accent" style={{ width: `${split.basketBps / 100}%` }} />
            <span className="bg-violet" style={{ width: `${split.platformBps / 100}%` }} />
            <span className="bg-ink" style={{ width: `${split.creatorBps / 100}%` }} />
          </div>
          <div className="flex flex-col text-sm">
            {[
              { c: "bg-accent", l: "Reward basket for stakers", v: split.basketBps },
              { c: "bg-violet", l: "Platform", v: split.platformBps },
              { c: "bg-ink", l: "You, the creator", v: split.creatorBps },
            ].map((r, i) => (
              <span key={r.l} className={`flex justify-between py-2 ${i < 2 ? "border-b line" : ""}`}>
                <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${r.c}`} />{r.l}</span>
                <span className="font-mono">{r.v / 100}%</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] text-muted">Lock tiers for stakers</span>
          <div className="grid grid-cols-4 gap-2">
            {tiers.map((t) => (
              <span key={t.id} className="flex flex-col items-center gap-1 py-3.5 rounded-[18px] bg-stake/[0.08] border border-stake/20">
                <span className="font-display font-black text-xl text-stake-light">{t.multiplierBps / 10_000}x</span>
                <span className="text-xs text-muted">{lockLabel(t.lockSeconds)}</span>
              </span>
            ))}
          </div>
          <span className="text-[13px] text-muted leading-normal">Leaving early burns up to {maxPenaltyBps / 100}% of the stake. quants never keeps it.</span>
        </div>

        <div className="flex flex-col text-sm border-t line pt-3">
          <span className="flex flex-col gap-0.5 py-1.5">
            <span className="flex justify-between"><span className="text-muted">Staking opens</span><span className="font-mono text-right">after {solText(rent)}{usdOf(rent) && <span className="block text-[12px] text-faint">≈ {usdOf(rent)}</span>}</span></span>
            <span className="text-[13px] text-muted leading-normal">The stakers&apos; share of trading fees first pays for the staking farms, one per lock tier ({tiers.length}). Staking opens once it covers that.</span>
          </span>
          <span className="flex justify-between py-1.5"><span className="text-muted">Graduates at</span><span className="font-mono">{pairQuote ? `${pairQuote.graduation.toLocaleString("en-US")} ${pairQuote.symbol} raised` : ""}</span></span>
          <span className="flex justify-between py-1.5"><span className="text-muted">Supply</span><span className="font-mono">1,000,000,000</span></span>
        </div>

        {error && <p role="alert" className="m-0 text-sm text-burn">{error}</p>}
        <Button size="lg" onClick={launch} disabled={busy}>
          {busy ? LABELS[status] : pending ? "Check launch status" : wallet.publicKey ? `Launch ${symbol || "token"}` : "Connect wallet"}
        </Button>
      </aside>
    </main>
  );
}
