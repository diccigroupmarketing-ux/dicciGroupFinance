"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { SkuGifts, SkuGiftItem } from "@/lib/recon";

type Draft = { gift_name: string; unit_cost: number; qty: number };

const Trash = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2 0v9.5A1.5 1.5 0 0 1 12.5 17h-5A1.5 1.5 0 0 1 6 15.5V6" />
  </svg>
);

export default function GiftEditor({ initial }: { initial: SkuGifts[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<SkuGifts[]>(initial);
  const [editing, setEditing] = useState<SkuGifts | null>(null);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [nsku, setNsku] = useState("");
  const [nname, setNname] = useState("");
  const [npaid, setNpaid] = useState(0);
  const [nfree, setNfree] = useState(0);

  useEffect(() => setMounted(true), []);
  // Segerak semula bila data server berubah (lepas router.refresh).
  useEffect(() => setRows(initial), [initial]);

  const openEdit = (s: SkuGifts) => {
    setIsNew(false);
    setEditing(s);
    setDraft(s.gifts.map((g) => ({ ...g })));
    setErr(null);
  };
  const openAdd = () => {
    setIsNew(true);
    setNsku(""); setNname(""); setNpaid(0); setNfree(0);
    setDraft([]);
    setEditing({ sku: "", product_name: "", gifts: [], costPerUnit: 0 });
    setErr(null);
  };
  const close = () => { if (!busy) { setEditing(null); setIsNew(false); setErr(null); } };

  const edit = (i: number, patch: Partial<Draft>) =>
    setDraft((p) => p.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const addGift = () => setDraft((p) => [...p, { gift_name: "", unit_cost: 0, qty: 1 }]);
  const delGift = (i: number) => setDraft((p) => p.filter((_, j) => j !== i));

  const costPerUnit = draft.reduce(
    (a, g) => a + (Number(g.unit_cost) || 0) * (Number(g.qty) || 0), 0);

  const dupName = useMemo(() => {
    const seen = new Set<string>(); const dup = new Set<string>();
    for (const g of draft) {
      const k = g.gift_name.trim().toUpperCase();
      if (!k) continue;
      if (seen.has(k)) dup.add(k); else seen.add(k);
    }
    return dup;
  }, [draft]);
  const hasEmpty = draft.some((g) => !g.gift_name.trim());
  const canSave = !busy && dupName.size === 0 && !hasEmpty && (!isNew || nsku.trim() !== "");

  const save = async () => {
    if (!editing) return;
    setBusy(true); setErr(null);
    try {
      if (isNew) {
        const sku = nsku.trim();
        // 1. Cipta baris katalog sku_bottles (lengkap dengan botol).
        const res = await fetch("/api/skus", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sku, product_name: nname.trim(), paid: npaid, free: nfree }),
        });
        const j = await res.json();
        if (!res.ok) { setErr(j.error ?? "tambah SKU gagal"); setBusy(false); return; }
        // 2. Kalau ada gift diisi, simpan sekali (SKU dah wujud selepas step 1).
        const validGifts = draft.filter((g) => g.gift_name.trim());
        if (validGifts.length) {
          const gr = await fetch("/api/gifts", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sku, gifts: validGifts }),
          });
          if (!gr.ok) {
            const gj = await gr.json().catch(() => ({}));
            setErr((gj.error ?? "gift gagal disimpan") + " , SKU dah ditambah, klik Edit untuk gift.");
            setEditing(null); setIsNew(false);
            setFlash(`${sku} · added`);
            router.refresh(); setBusy(false); return;
          }
        }
        setEditing(null); setIsNew(false);
        setFlash(`${sku} · added${validGifts.length ? ` (${validGifts.length} gift${validGifts.length === 1 ? "" : "s"})` : ""}`);
        router.refresh();
      } else {
        const res = await fetch("/api/gifts", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sku: editing.sku, gifts: draft }),
        });
        const j = await res.json();
        if (!res.ok) {
          setErr(j.error ?? "simpan gagal");
        } else {
          const gifts: SkuGiftItem[] = draft
            .filter((g) => g.gift_name.trim())
            .map((g) => ({
              gift_name: g.gift_name.trim(),
              unit_cost: Math.max(0, Math.round((Number(g.unit_cost) || 0) * 100) / 100),
              qty: Math.max(1, Math.trunc(Number(g.qty) || 1)),
            }));
          const sku = editing.sku;
          setRows((prev) => prev.map((r) => (r.sku === sku
            ? { ...r, gifts, costPerUnit: gifts.reduce((a, g) => a + g.unit_cost * g.qty, 0) }
            : r)));
          setEditing(null);
          setFlash(`${sku} · saved (${gifts.length} gift${gifts.length === 1 ? "" : "s"})`);
          router.refresh();
        }
      }
    } catch {
      setErr("network error");
    }
    setBusy(false);
  };

  return (
    <>
      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Gift mapping</div>
          <div className="cardHint">{rows.length} SKUs · click Edit to manage each SKU&apos;s gifts</div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            {flash && (
              <span className="chip chipPos">
                <span className="cdot" /> {flash}
              </span>
            )}
            <button className="ghostBtn" onClick={openAdd}>+ Add SKU</button>
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th><th>Product</th><th>Free gifts</th>
                <th className="num">Cost / unit SKU</th><th aria-label="edit" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td><span className="cellMain">{r.sku}</span></td>
                  <td>{r.product_name || "—"}</td>
                  <td>
                    {r.gifts.length === 0 ? (
                      <span className="chip chipMut"><span className="cdot" /> No gifts yet</span>
                    ) : (
                      <div className="giftChips">
                        {r.gifts.map((g) => (
                          <span className="giftChip" key={g.gift_name}>
                            {g.gift_name} <b>×{g.qty}</b>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {r.costPerUnit > 0
                      ? <b>RM {r.costPerUnit.toFixed(2)}</b>
                      : <span style={{ color: "var(--faint)" }}>—</span>}
                  </td>
                  <td className="num">
                    <button className="ghostBtn giftEditBtn" onClick={() => openEdit(r)}>Edit</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="cellMuted">
                  No SKUs yet. Click <b>+ Add SKU</b> to create one (or add them in SKU / Bottles).
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {mounted && editing && createPortal(
        <div className="modalBack" onClick={close}>
          <div className="modal" style={{ width: "min(580px,100%)" }}
               onClick={(e) => e.stopPropagation()}
               role="dialog" aria-modal="true"
               aria-label={isNew ? "Add SKU" : `Edit free gifts ${editing.sku}`}>
            <div className="cardHead">
              <div className="cardTitle">{isNew ? "Add SKU" : `Edit free gifts · ${editing.sku}`}</div>
              <button className="cardLink" style={{ marginLeft: "auto" }} onClick={close}>Close</button>
            </div>
            <p className="modalNote">
              {isNew
                ? "Cipta SKU baru terus di sini (kod + botol). Boleh terus tambah free gift sekali, atau biar kosong dan tambah kemudian."
                : `Free gift yang datang sekali dengan SKU ni. Kos auto masuk setiap order yang ada ${editing.sku}. Boleh tambah seberapa banyak gift.`}
            </p>
            {isNew && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>SKU code</span>
                  <input className={"cellInput" + (!nsku.trim() ? " bad" : "")} value={nsku}
                    placeholder="e.g. KURMA-1" aria-invalid={!nsku.trim()}
                    onChange={(e) => setNsku(e.target.value)} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>Product name</span>
                  <input className="cellInput" value={nname} placeholder="optional"
                    onChange={(e) => setNname(e.target.value)} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>Paid bottles</span>
                  <input className="cellInput num" type="number" min={0} step={1} value={npaid}
                    onChange={(e) => setNpaid(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>Free bottles</span>
                  <input className="cellInput num" type="number" min={0} step={1} value={nfree}
                    onChange={(e) => setNfree(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} />
                </div>
              </div>
            )}
            {isNew && (
              <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 6, fontWeight: 600 }}>
                Free gifts (optional)
              </div>
            )}
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Gift item</th><th className="num">Unit cost (RM)</th>
                    <th className="num">Qty</th><th aria-label="row actions" />
                  </tr>
                </thead>
                <tbody>
                  {draft.map((g, i) => {
                    const isDup = dupName.has(g.gift_name.trim().toUpperCase());
                    const isEmpty = !g.gift_name.trim();
                    return (
                      <tr key={i}>
                        <td>
                          <input className={"cellInput" + (isDup || isEmpty ? " bad" : "")}
                            value={g.gift_name} placeholder="Gift name"
                            onChange={(e) => edit(i, { gift_name: e.target.value })}
                            aria-invalid={isDup || isEmpty} />
                        </td>
                        <td className="num">
                          <input className="cellInput num" type="number" min={0} step="0.01"
                            value={g.unit_cost}
                            onChange={(e) => edit(i, { unit_cost: Math.max(0, Number(e.target.value) || 0) })} />
                        </td>
                        <td className="num">
                          <input className="cellInput num" type="number" min={1} step={1}
                            value={g.qty}
                            onChange={(e) => edit(i, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />
                        </td>
                        <td className="num">
                          <button className="rowDel" onClick={() => delGift(i)} aria-label="Remove gift">
                            <Trash />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {draft.length === 0 && (
                    <tr><td colSpan={4} className="cellMuted">No gifts yet. Add one below.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <button className="ghostBtn" style={{ marginTop: 11 }} onClick={addGift}>+ Add gift</button>

            {(dupName.size > 0 || hasEmpty) && (
              <div className="cauPanel" style={{ marginTop: 12 }}>
                <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <path d="M10 7v4m0 3h.01M10 2.5 18 16H2z" />
                </svg>
                <div><b>{hasEmpty ? "Every gift needs a name." : "Duplicate gift names."}</b>
                  <p>Fix the highlighted rows before saving.</p></div>
              </div>
            )}

            <div className="giftModalTotal">
              <span className="lbl">Cost per unit SKU</span>
              <span className="val">RM {costPerUnit.toFixed(2)}</span>
            </div>
            {err && <div className="modalWarn">{err}</div>}
            <div className="modalActions">
              <button className="ghostBtn" style={{ flex: 1 }} onClick={close} disabled={busy}>Cancel</button>
              <button className="uploadBtn" style={{ flex: 1 }} onClick={save} disabled={!canSave}>
                {busy ? "Saving…" : (isNew ? "Add SKU" : "Save changes")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
