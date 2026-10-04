"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/web/ui/Button";
import { fmtAmount, shortAddr } from "@/web/ui/format";
import { ADMIN_API } from "./api";

type Burn = { id: number; mint: string; symbol: string | null; amount: string; usd: number | null; status: "pending" | "approved" | "burned"; createdAt: string; decidedAt: string | null; burnedAt: string | null };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "Something went wrong");
  return j as T;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const usd = (n: number | null) => (n === null ? "" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const LABEL: Record<Burn["status"], string> = { pending: "Waiting", approved: "Approved, burning", burned: "Burned" };

/** Early exit penalties collected by the keeper. Nothing is burned until it is approved here. */
export function BurnApprovals({ readOnly }: { readOnly: boolean }) {
  const [rows, setRows] = useState<Burn[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<{ burns: Burn[] }>(`${ADMIN_API}/burns`).then((r) => setRows(r.burns), (e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function approve(ids: number[]) {
    if (busy || !ids.length) return;
    setBusy(true);
    setError(null);
    try {
      await call(`${ADMIN_API}/burns`, { method: "POST", body: JSON.stringify({ ids }) });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const pending = rows?.filter((r) => r.status === "pending") ?? [];
  const cols = readOnly ? "md:grid-cols-[140px_minmax(0,1fr)_160px_160px]" : "md:grid-cols-[140px_minmax(0,1fr)_160px_160px_120px]";

  return (
    <section className="flex flex-col gap-5 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted">Early exit penalties the keeper collected into the spill wallet. Each one is burned on the keeper's next run after it is approved.</p>
        {!readOnly && pending.length > 1 && <Button variant="accent" disabled={busy} onClick={() => approve(pending.map((r) => r.id))}>Approve all {pending.length}</Button>}
      </div>
      {error && <p className="m-0 text-sm text-burn">{error}</p>}
      {rows === null ? <p className="m-0 text-muted">Loading</p> : rows.length === 0 ? <p className="m-0 text-muted">No penalties collected yet.</p> : (
        <div className="flex flex-col text-sm">
          <div className={`hidden md:grid ${cols} gap-4 pb-2 text-[13px] text-muted`}>
            <span>Token</span><span>Amount</span><span>Collected</span><span>Status</span>{!readOnly && <span />}
          </div>
          {rows.map((r) => (
            <div key={r.id} className={`grid grid-cols-1 ${cols} gap-2 md:gap-4 py-3 border-t line md:items-center`}>
              <a href={`/t/${r.mint}`} className="font-mono font-semibold hover:text-accent">{r.symbol ?? shortAddr(r.mint)}</a>
              <span className="font-mono">{fmtAmount(r.amount, 6, 2)}{r.usd !== null && <span className="text-muted"> · {usd(r.usd)}</span>}</span>
              <span className="text-muted">{when(r.createdAt)}</span>
              <span className={r.status === "burned" ? "text-up" : ""}>{LABEL[r.status]}{r.burnedAt && <span className="block text-[12px] text-muted">{when(r.burnedAt)}</span>}</span>
              {!readOnly && <span className="flex md:justify-end">{r.status === "pending" && <Button size="sm" variant="burn" disabled={busy} onClick={() => approve([r.id])}>Approve</Button>}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
