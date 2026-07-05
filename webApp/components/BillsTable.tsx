"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate, fmtInt, fmtRM } from "@/lib/format";

export type BillRow = {
  bill_id: string;
  settlement_date: string | null;
  parcel: number; cod: number; fee: number; net: number; exc: number;
  actual: number | null; note: string | null; entered_by: string | null;
};

// Variance dianggap padan bila beza < 1 sen (bulatan RM).
const isMatched = (net: number, actual: number) => Math.abs(net - actual) < 0.005;

export default function BillsTable({ rows, courierName }: { rows: BillRow[]; courierName: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = (r: BillRow) => {
    setEditing(r.bill_id);
    setAmount(r.actual != null ? String(r.actual) : String(Math.max(0, r.net)));
    setNote(r.note ?? "");
    setErr(null);
  };
  const close = () => { setEditing(null); setErr(null); };

  const save = async (bill_id: string) => {
    const val = Number(amount);
    if (!Number.isFinite(val) || val < 0) { setErr("Jumlah tidak sah"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/bank", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bill_id, actual_amount: val, note: note.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "Simpan gagal"); }
      else { setEditing(null); router.refresh(); }
    } catch { setErr("Network error"); }
    setBusy(false);
  };

  const clear = async (bill_id: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/bank?bill_id=${encodeURIComponent(bill_id)}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json(); setErr(j.error ?? "Padam gagal"); }
      else { setEditing(null); router.refresh(); }
    } catch { setErr("Network error"); }
    setBusy(false);
  };

  // Ringkasan: berapa bil disahkan, jumlah bank vs jangka, variance keseluruhan.
  const totNet = rows.reduce((a, r) => a + r.net, 0);
  const confirmed = rows.filter((r) => r.actual != null);
  const totActual = confirmed.reduce((a, r) => a + (r.actual ?? 0), 0);
  const totVar = Math.round((confirmed.reduce((a, r) => a + (r.net - (r.actual ?? 0)), 0)) * 100) / 100;

  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">Settlement bills</div>
        <div className="cardHint">one bill = one payout from {courierName} · confirm the bank amount to close the loop</div>
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Bill</th><th>Settled</th><th className="num">Parcels</th>
              <th className="num">Net remit</th>
              <th className="num">In bank</th><th className="num">Variance</th>
              <th>Books</th><th aria-label="Confirm" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isEd = editing === r.bill_id;
              const has = r.actual != null;
              const matched = has && isMatched(r.net, r.actual!);
              const variance = has ? Math.round((r.net - r.actual!) * 100) / 100 : null;
              return (
                <tr key={r.bill_id}>
                  <td className="cellMain">{r.bill_id}</td>
                  <td>{fmtDate(r.settlement_date)}</td>
                  <td className="num">{fmtInt(r.parcel)}</td>
                  <td className="num"><b>{fmtRM(r.net)}</b></td>

                  {isEd ? (
                    <td className="num" colSpan={2}>
                      <div className="bankEdit">
                        <input
                          className="cellInput num" type="number" step="0.01" min={0}
                          value={amount} autoFocus
                          onChange={(e) => setAmount(e.target.value)}
                          aria-label={`Bank amount for ${r.bill_id}`}
                          placeholder="Amount in bank"
                        />
                        <input
                          className="cellInput" value={note}
                          onChange={(e) => setNote(e.target.value)}
                          aria-label={`Note for ${r.bill_id}`}
                          placeholder="Note (optional)"
                        />
                        <div className="bankEditBtns">
                          <button className="uploadBtn" style={{ padding: "7px 12px" }}
                                  disabled={busy} onClick={() => save(r.bill_id)}>
                            {busy ? "…" : "Save"}
                          </button>
                          <button className="ghostBtn" style={{ padding: "7px 10px" }}
                                  disabled={busy} onClick={close}>Cancel</button>
                          {has && (
                            <button className="linkDanger" disabled={busy}
                                    onClick={() => clear(r.bill_id)}>Clear</button>
                          )}
                        </div>
                        {err && <div className="bankErr">{err}</div>}
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="num">
                        {has ? fmtRM(r.actual!) : <span className="faintCell">not confirmed</span>}
                      </td>
                      <td className="num">
                        {!has ? (
                          <span className="chip chipMut"><span className="cdot" /> Awaiting</span>
                        ) : matched ? (
                          <span className="chip chipPos"><span className="cdot" /> Matched</span>
                        ) : (
                          <span className="chip chipDan" title={variance! > 0 ? "Short in bank" : "Over in bank"}>
                            <span className="cdot" /> {variance! > 0 ? "−" : "+"}{fmtRM(Math.abs(variance!)).replace("RM ", "")}
                          </span>
                        )}
                      </td>
                    </>
                  )}

                  <td>{r.exc === 0
                    ? <span className="chip chipPos"><span className="cdot" /> Clean</span>
                    : <span className="chip chipDan"><span className="cdot" /> {r.exc} exceptions</span>}</td>
                  <td className="num">
                    {!isEd && (
                      <button className="cardLink" onClick={() => open(r)}>
                        {r.actual != null ? "Edit" : "Confirm"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="cardHint" style={{ marginTop: 12 }}>
        Confirmed <b>{confirmed.length}</b> of <b>{rows.length}</b> bills ·
        {" "}<b>{fmtRM(totActual)}</b> in bank vs <b>{fmtRM(totNet)}</b> expected
        {confirmed.length > 0 && (
          <> · variance{" "}
            <b style={{ color: Math.abs(totVar) < 0.005 ? "var(--pos)" : "var(--dan)" }}>
              {fmtRM(totVar)}
            </b>
          </>
        )}
      </div>
    </div>
  );
}
