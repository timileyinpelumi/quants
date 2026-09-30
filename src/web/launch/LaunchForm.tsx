"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Avatar } from "@/web/ui/Avatar";
import { Button } from "@/web/ui/Button";
import { Field, Suffixed, TextArea, TextInput, inputClass } from "@/web/ui/Field";
import { Segmented } from "@/web/ui/Segmented";
import { fmtAmount } from "@/web/ui/format";
import { signAndSendAll, SendError, type UnsignedTx } from "@/web/wallet/send";
import { BasketPicker, basketTotal, type BasketItem } from "./BasketPicker";

const SOL = "So11111111111111111111111111111111111111112";
const OURS = process.env.NEXT_PUBLIC_OURTOKEN_MINT ?? "";
const OURS_SYMBOL = process.env.NEXT_PUBLIC_OURTOKEN_SYMBOL ?? "OURTOKEN";
const GRADUATION: Record<string, string> = {
  [SOL]: `${process.env.NEXT_PUBLIC_SOL_GRADUATION ?? "85"} SOL raised`,
  [OURS]: `${process.env.NEXT_PUBLIC_OURTOKEN_GRADUATION ?? ""} ${OURS_SYMBOL} raised`,
};
const FEES = [100, 200, 300, 500];

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
    return "We could not read that image";
  }
  return null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "Something went wrong");
  return j as T;
}

export function LaunchForm({ split, tiers, launchFeeLamports, maxPenaltyBps }: {
  split: { basketBps: number; platformBps: number; creatorBps: number };
  tiers: Tier[];
  launchFeeLamports: string;
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
  const [pair, setPair] = useState<string>(SOL);
  const [fee, setFee] = useState(200);
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [devBuy, setDevBuy] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

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

  const problems = [
    !image && "Add an image",
    !name.trim() && "Add a name",
    !/^[A-Za-z0-9]{1,10}$/.test(symbol) && "Symbol is 1 to 10 letters or numbers",
    basket.length === 0 && "Pick at least one reward token",
    basket.length > 0 && basketTotal(basket) !== 100 && "Basket weights need to add up to 100",
    devBuyLamports === null && "First buy must be a number",
  ].filter(Boolean) as string[];

  const busy = status !== "idle";
  const pairLabel = pair === SOL ? "SOL" : OURS_SYMBOL;

  async function launch() {
    if (!wallet.publicKey) { modal.setVisible(true); return; }
    if (problems.length) { setError(problems[0]!); return; }
    setError(null);
    try {
      setStatus("uploading");
      const form = new FormData();
      form.set("image", image!);
      form.set("name", name.trim());
      form.set("symbol", symbol);
      for (const [k, v] of Object.entries({ description, website, x, telegram })) if (v.trim()) form.set(k, v.trim());
      const metaRes = await fetch("/api/metadata", { method: "POST", body: form });
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.error?.message ?? "Upload failed");

      setStatus("preparing");
      const prepared = await postJson<{ mint: string; transactions: UnsignedTx[] }>("/api/launch/prepare", {
        name: name.trim(), symbol, uri: meta.uri, image: meta.image, creator: wallet.publicKey.toBase58(),
        quoteMint: pair, feeTierBps: fee, devBuySol: (devBuyLamports ?? 0n).toString(),
        basket: basket.map((b) => ({ mint: b.mint, weightBps: b.weight * 100, symbol: b.symbol, decimals: b.decimals })),
      });

      setStatus("signing");
      const sigs = await signAndSendAll(wallet, connection, prepared.transactions);

      setStatus("confirming");
      await postJson("/api/launch/confirm", { signature: sigs[sigs.length - 1], mint: prepared.mint });
      router.push(`/t/${prepared.mint}`);
    } catch (e) {
      setError(e instanceof SendError || e instanceof Error ? e.message : "Something went wrong");
      setStatus("idle");
    }
  }

  const section = "grid grid-cols-1 md:grid-cols-[56px_minmax(0,1fr)] gap-4 md:gap-6 py-7 border-t line";
  const num = "hidden md:block font-display font-bold text-[15px] text-faint";

  return (
    <main className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] gap-10 lg:gap-16 px-4 md:px-16 pt-10 md:pt-14 pb-16">
      <section className="flex flex-col gap-10 min-w-0">
        <div className="flex flex-col gap-3.5">
          <h1 className="m-0 font-display font-black text-[40px] md:text-[64px] leading-[1.02] tracking-[-0.03em]">
            Launch a token.<br /><span className="text-lime">Stakers earn three.</span>
          </h1>
          <p className="m-0 text-lg text-muted max-w-[560px] leading-normal">Trading fees buy the tokens you pick and pay them to people who stake yours. Longer locks earn more.</p>
        </div>

        <div className="flex flex-col">
          <div className={section}>
            <span className={num}>01</span>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] md:grid-cols-[132px_minmax(0,1fr)_200px] gap-5 items-end">
              <div className="flex flex-col gap-2.5 text-[13px] text-muted row-span-2 md:row-span-1">
                <span>Image</span>
                <label className="w-28 h-28 md:w-[132px] md:h-[132px] rounded-[28px] border-[1.5px] border-dashed border-lime/45 bg-lime/5 flex flex-col items-center justify-center gap-2 text-lime text-[13px] cursor-pointer overflow-hidden focus-within:border-lime">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-7 md:gap-8">
              <div className="flex flex-col gap-3">
                <span className="text-[13px] text-muted">Paired with</span>
                <Segmented label="Paired with" value={pair} onChange={setPair} options={[{ value: SOL, label: "SOL" }, ...(OURS ? [{ value: OURS, label: OURS_SYMBOL }] : [])]} />
              </div>
              <div className="flex flex-col gap-3">
                <span className="text-[13px] text-muted">Trading fee</span>
                <Segmented label="Trading fee" value={fee} onChange={setFee} options={FEES.map((f) => ({ value: f, label: `${f / 100}%` }))} />
              </div>
            </div>
          </div>

          <div className={section}>
            <span className={num}>03</span>
            <BasketPicker value={basket} onChange={setBasket} />
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
                {pair === SOL ? "Bought on the curve in the same approval as the launch." : `Swapped to ${OURS_SYMBOL} first, then bought on the curve. One approval.`}
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
            <span className="bg-lime" style={{ width: `${split.basketBps / 100}%` }} />
            <span className="bg-violet" style={{ width: `${split.platformBps / 100}%` }} />
            <span className="bg-ink" style={{ width: `${split.creatorBps / 100}%` }} />
          </div>
          <div className="flex flex-col text-sm">
            {[
              { c: "bg-lime", l: "Reward basket for stakers", v: split.basketBps },
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
              <span key={t.id} className="flex flex-col items-center gap-1 py-3.5 rounded-[18px] bg-violet/[0.08] border border-violet/20">
                <span className="font-display font-black text-xl text-violet-light">{t.multiplierBps / 10_000}x</span>
                <span className="text-xs text-muted">{Math.round(t.lockSeconds / 86_400)} days</span>
              </span>
            ))}
          </div>
          <span className="text-[13px] text-muted leading-normal">Leave early and up to {maxPenaltyBps / 100}% of your stake is burned. Quants never keeps it.</span>
        </div>

        <div className="flex flex-col text-sm border-t line pt-3">
          <span className="flex justify-between py-1.5"><span className="text-muted">Launch fee</span><span className="font-mono">{fmtAmount(launchFeeLamports, 9)} SOL</span></span>
          <span className="flex justify-between py-1.5"><span className="text-muted">Graduates at</span><span className="font-mono">{GRADUATION[pair]}</span></span>
          <span className="flex justify-between py-1.5"><span className="text-muted">Supply</span><span className="font-mono">1,000,000,000</span></span>
        </div>

        {error && <p role="alert" className="m-0 text-sm text-burn">{error}</p>}
        <Button size="lg" onClick={launch} disabled={busy}>
          {busy ? LABELS[status] : wallet.publicKey ? `Launch ${symbol || "token"}` : "Connect wallet"}
        </Button>
      </aside>
    </main>
  );
}
