"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/web/ui/Button";
import { inputClass } from "@/web/ui/Field";
import { CopyButton } from "@/web/ui/CopyButton";
import { ADMIN_API } from "./api";

type Code = { id: number; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "Something went wrong");
  return j as T;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "Never");

/** Read only codes: made here, shown once, revoked here. Revoking signs out every session made with that code. */
export function AccessCodes() {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ code: string; label: string } | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<{ codes: Code[] }>(`${ADMIN_API}/codes`).then((r) => setCodes(r.codes), (e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ code: string; item: Code }>(`${ADMIN_API}/codes`, { method: "POST", body: JSON.stringify({ label }) });
      setFresh({ code: r.code, label: r.item.label });
      setLabel("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setError(null);
    try {
      await call(`${ADMIN_API}/codes`, { method: "DELETE", body: JSON.stringify({ id }) });
      setConfirm(null);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <section className="flex flex-col gap-6 max-w-4xl">
      <p className="m-0 text-sm text-muted max-w-2xl">
        Read only codes sign in to see every tab without changing anything. Derivation paths and the alert webhook stay hidden from them. A new code is shown once. Revoking a code signs out everyone using it straight away.
      </p>

      <form onSubmit={create} className="flex flex-col md:flex-row md:items-end gap-3">
        <label className="flex flex-col gap-2 text-[13px] text-muted flex-1 min-w-0">
          <span>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Who it is for" className={`${inputClass} text-base py-3`} />
        </label>
        <Button type="submit" disabled={busy || !label.trim()}>{busy ? "Creating" : "Create code"}</Button>
      </form>

      {fresh && (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-accent/40 p-5">
          <span className="font-semibold">New read only code for {fresh.label}</span>
          <div className="flex flex-wrap items-center gap-3">
            <code data-new-code className="font-mono text-lg tracking-wider break-all">{fresh.code}</code>
            <CopyButton value={fresh.code} label="Copy" />
          </div>
          <span className="text-sm text-muted">Copy it now. It is not shown again, and only its hash is stored.</span>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setFresh(null)}>Done</Button>
        </div>
      )}

      {error && <p role="alert" className="m-0 text-sm text-burn">{error}</p>}

      {codes === null ? <p className="m-0 text-muted">Loading</p> : codes.length === 0 ? <p className="m-0 text-muted">No read only codes yet.</p> : (
        <div className="flex flex-col text-sm">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_190px_190px_150px] gap-4 pb-2 text-[13px] text-muted">
            <span>Label</span><span>Created</span><span>Last used</span><span />
          </div>
          {codes.map((c) => (
            <div key={c.id} data-code-row className={`grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_190px_190px_150px] gap-x-4 gap-y-1 py-3 border-t line md:items-center ${c.revokedAt ? "text-muted" : ""}`}>
              <span className="font-semibold truncate">{c.label}</span>
              <span className="md:hidden row-span-3 self-center">{action(c)}</span>
              <span className="text-muted"><span className="md:hidden">Created </span>{when(c.createdAt)}</span>
              <span className="text-muted"><span className="md:hidden">Last used </span>{when(c.lastUsedAt)}</span>
              <span className="hidden md:flex justify-end">{action(c)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  function action(c: Code) {
    if (c.revokedAt) return <span className="text-[13px]">Revoked</span>;
    if (confirm === c.id) {
      return (
        <span className="flex gap-2">
          <Button variant="danger" size="sm" onClick={() => revoke(c.id)}>Revoke now</Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>Keep</Button>
        </span>
      );
    }
    return <Button variant="outline" size="sm" onClick={() => setConfirm(c.id)}>Revoke</Button>;
  }
}
