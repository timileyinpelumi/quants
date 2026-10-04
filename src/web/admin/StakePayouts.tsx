"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/web/ui/Button";
import { CopyButton } from "@/web/ui/CopyButton";
import { fmtAmount, shortAddr } from "@/web/ui/format";
import { ADMIN_API } from "./api";

type Payout = {
  id: number; mint: string; symbol: string | null; tierId: string; owner: string; status: "due" | "approved" | "paid" | "rejected";
  startedAt: string; endsAt: string; decidedAt: string | null; paidAt: string | null;
  amounts: { mint: string; symbol: string | null; decimals: number | null; amount: string }[];
  usd: number | null;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "Something went wrong");
  return j as T;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const usd = (n: number | null) => (n === null ? "" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const LABEL: Record<Payout["status"], string> = { due: "Due", approved: "Approved, sending", paid: "Paid", rejected: "Rejected" };

/** Staker payouts for finished lock periods. Nothing is sent until a row is approved here. */
export function StakePayouts({ readOnly }: { readOnly: boolean }) {
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<{ payouts: Payout[] }>(`${ADMIN_API}/stake-payouts`).then((r) => setRows(r.payouts), (e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(ids: number[], action: "approve" | "reject") {
    if (busy || !ids.length) return;
    setBusy(true);
    setError(null);
    try {
      await call(`${ADMIN_API}/stake-payouts`, { method: "POST", body: JSON.stringify({ ids, action }) });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const due = rows?.filter((r) => r.status === "due") ?? [];
  const dueUsd = due.every((r) => r.usd !== null) ? due.reduce((a, r) => a + r.usd!, 0) : null;

  return (
    <section className="flex flex-col gap-5 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted">Staker earnings for finished locks. The keeper sends a payout on its next run after it is approved. Rejected earnings go back to that token's reward pool.</p>
        {!readOnly && due.length > 1 && (
          <Button variant="accent" disabled={busy} onClick={() => decide(due.map((r) => r.id), "approve")}>Approve all {due.length}{dueUsd !== null ? ` · ${usd(dueUsd)}` : ""}</Button>
        )}
      </div>
      {error && <p className="m-0 text-sm text-burn">{error}</p>}
      {rows === null ? <p className="m-0 text-muted">Loading</p> : rows.length === 0 ? <p className="m-0 text-muted">No payouts yet.</p> : (
        <div className="flex flex-col text-sm">
          <div className={`hidden md:grid ${readOnly ? "md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.4fr)_150px]" : "md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.4fr)_150px_190px]"} gap-4 pb-2 text-[13px] text-muted`}>
            <span>Token</span><span>Staker</span><span>Earned</span><span>Status</span>{!readOnly && <span />}
          </div>
          {rows.map((r) => (
            <div key={r.id} className={`grid grid-cols-1 ${readOnly ? "md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.4fr)_150px]" : "md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.4fr)_150px_190px]"} gap-2 md:gap-4 py-3 border-t line md:items-center`}>
              <a href={`/t/${r.mint}`} className="flex flex-col hover:text-accent">
                <span className="font-mono font-semibold">{r.symbol ?? shortAddr(r.mint)}</span>
                <span className="text-[12px] text-muted">{r.tierId} lock, {day(r.startedAt)} to {day(r.endsAt)}</span>
              </a>
              <span className="flex items-center gap-2 min-w-0">
                <a href={`https://solscan.io/account/${r.owner}`} target="_blank" rel="noreferrer" className="font-mono truncate hover:text-accent">{shortAddr(r.owner)}</a>
                <CopyButton value={r.owner} label="Copy" />
              </span>
              <span className="flex flex-col font-mono text-[13px]">
                {r.amounts.map((a) => <span key={a.mint}>{fmtAmount(a.amount, a.decimals ?? 0, 4)} {a.symbol ?? shortAddr(a.mint)}</span>)}
                {r.usd !== null && <span className="text-muted">{usd(r.usd)}</span>}
              </span>
              <span className={r.status === "rejected" ? "text-muted" : r.status === "paid" ? "text-up" : ""}>
                {LABEL[r.status]}
                {r.paidAt && <span className="block text-[12px] text-muted">{day(r.paidAt)}</span>}
              </span>
              {!readOnly && (
                <span className="flex gap-2 md:justify-end">
                  {r.status === "due" && (
                    <>
                      <Button size="sm" variant="accent" disabled={busy} onClick={() => decide([r.id], "approve")}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide([r.id], "reject")}>Reject</Button>
                    </>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
