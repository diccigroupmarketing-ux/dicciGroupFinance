"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SkuRow } from "@/lib/recon";

type Row = { sku: string; product_name: string; paid: number; free: number };

function toRows(init: SkuRow[]): Row[] {
  return init.map((r) => ({
    sku: r.sku, product_name: r.product_name ?? "",
    paid: r.paid, free: r.free,
  }));
}

export default function SkuEditor({ initial }: { initial: SkuRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [q, setQ] = useState("");

  // Tapis untuk PAPARAN sahaja; edit/delete kekal ikut index baris asal supaya
  // patch tak tersasar ke baris lain masa senarai ditapis.
  const visible = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const all = rows.map((r, i) => ({ r, i }));
    if (!needle) return all;
    return all.filter(({ r }) =>
      r.sku.toUpperCase().includes(needle) ||
      r.product_name.toUpperCase().includes(needle));
  }, [rows, q]);

  const edit = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
    setMsg(null);
  };
  const addRow = () => {
    setRows((prev) => [...prev, { sku: "", product_name: "", paid: 0, free: 0 }]);
    setDirty(true);
    setMsg(null);
    setQ(""); // baris baru kosong, kosongkan tapisan supaya dia nampak
  };
  const delRow = (i: number) => {
    setRows((prev) => prev.filter((_, j) => j !== i));
    setDirty(true);
    setMsg(null);
  };

  // SKU pendua (huruf besar/kecil dikira sama) & SKU kosong = tak sah untuk simpan.
  const dupKeys = useMemo(() => {
    const seen = new Set<string>(); const dup = new Set<string>();
    for (const r of rows) {
      const k = r.sku.trim().toUpperCase();
      if (!k) continue;
      if (seen.has(k)) dup.add(k); else seen.add(k);
    }
    return dup;
  }, [rows]);
  const hasEmpty = rows.some((r) => !r.sku.trim());
  const canSave = dirty && !busy && dupKeys.size === 0 && !hasEmpty;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/skus", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: j.error ?? "simpan gagal" });
      } else {
        setMsg({ kind: "ok", text: `Saved · ${j.saved} SKUs` });
        setDirty(false);
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "network error" });
    }
    setBusy(false);
  };

  const revert = () => { setRows(toRows(initial)); setDirty(false); setMsg(null); };

  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">SKU mapping</div>
        <div className="cardHint">
          {q.trim() ? `${visible.length} of ${rows.length} SKUs` : `${rows.length} SKUs · edit inline`}
        </div>
        <div className="searchBox" style={{ marginLeft: 12 }}>
          <svg className="searchIc" width="15" height="15" viewBox="0 0 20 20" fill="none"
               stroke="currentColor" strokeWidth="1.8">
            <circle cx="9" cy="9" r="6" /><path d="m14 14 3.5 3.5" />
          </svg>
          <input
            className="searchInput" type="search" value={q}
            placeholder="Search SKU or product…"
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search SKUs"
            style={{ maxWidth: 220, padding: "7px 10px", fontSize: 13 }}
          />
        </div>
        {msg && (
          <span className={"chip " + (msg.kind === "ok" ? "chipPos" : "chipDan")}
                style={{ marginLeft: "auto" }}>
            <span className="cdot" /> {msg.text}
          </span>
        )}
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th><th>Product name</th>
              <th className="num">Paid bottles</th>
              <th className="num">Free bottles</th>
              <th className="num">Total</th>
              <th aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {visible.map(({ r, i }) => {
              const isDup = dupKeys.has(r.sku.trim().toUpperCase());
              const isEmpty = !r.sku.trim();
              return (
                <tr key={i}>
                  <td>
                    <input
                      className={"cellInput mono" + (isDup || isEmpty ? " bad" : "")}
                      value={r.sku}
                      placeholder="SKU code"
                      onChange={(e) => edit(i, { sku: e.target.value })}
                      aria-label={`SKU ${i + 1}`}
                      aria-invalid={isDup || isEmpty}
                    />
                  </td>
                  <td>
                    <input
                      className="cellInput"
                      value={r.product_name}
                      placeholder="—"
                      onChange={(e) => edit(i, { product_name: e.target.value })}
                      aria-label={`Product name ${i + 1}`}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="cellInput num" type="number" min={0} step={1}
                      value={r.paid}
                      onChange={(e) => edit(i, { paid: Math.max(0, Math.trunc(+e.target.value || 0)) })}
                      aria-label={`Paid bottles ${i + 1}`}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="cellInput num" type="number" min={0} step={1}
                      value={r.free}
                      onChange={(e) => edit(i, { free: Math.max(0, Math.trunc(+e.target.value || 0)) })}
                      aria-label={`Free bottles ${i + 1}`}
                    />
                  </td>
                  <td className="num"><b>{r.paid + r.free}</b></td>
                  <td className="num">
                    <button className="rowDel" onClick={() => delRow(i)}
                            title="Remove SKU" aria-label={`Remove SKU ${i + 1}`}>
                      <svg width="15" height="15" viewBox="0 0 20 20" fill="none"
                           stroke="currentColor" strokeWidth="1.8">
                        <path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2 0v9.5A1.5 1.5 0 0 1 12.5 17h-5A1.5 1.5 0 0 1 6 15.5V6" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="cellMuted">No SKUs yet. Add one below.</td></tr>
            )}
            {rows.length > 0 && visible.length === 0 && (
              <tr><td colSpan={6} className="cellMuted">
                No SKU matches &quot;{q}&quot;. Clear the search to see all {rows.length}.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(dupKeys.size > 0 || hasEmpty) && (
        <div className="cauPanel">
          <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none"
               stroke="currentColor" strokeWidth="2">
            <path d="M10 7v4m0 3h.01M10 2.5 18 16H2z" />
          </svg>
          <div>
            <b>{hasEmpty ? "Every row needs a SKU code." : "Duplicate SKU codes."}</b>
            <p>Fix the highlighted rows before saving. SKU codes are compared
              case-insensitively.</p>
          </div>
        </div>
      )}

      <div className="editorBar">
        <button className="ghostBtn" onClick={addRow} disabled={busy}>
          + Add SKU
        </button>
        <div className="editorBarRight">
          <button className="ghostBtn" onClick={revert} disabled={!dirty || busy}>
            Revert
          </button>
          <button className="uploadBtn" onClick={save} disabled={!canSave}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
