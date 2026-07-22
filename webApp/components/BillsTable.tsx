"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate, fmtDay, fmtInt, fmtRM, trackingOrDash } from "@/lib/format";
import ExportCsv from "@/components/ExportCsv";

const BILL_COLS = [
  { key: "bill_id", header: "Bill" }, { key: "settlement_date", header: "Settled" },
  { key: "parcel", header: "Parcels" }, { key: "cod", header: "COD collected" },
  { key: "fee", header: "Fee" }, { key: "net", header: "Net remit" },
  { key: "actual", header: "In bank" }, { key: "deposited_on", header: "Deposited on" },
  { key: "exc", header: "Exceptions" },
  { key: "note", header: "Note" }, { key: "entered_by", header: "Confirmed by" },
];
const PARCEL_COLS = [
  { key: "awb", header: "AWB" }, { key: "order_id", header: "Order" },
  { key: "seller_name", header: "Stockist" }, { key: "katLabel", header: "Status" },
  { key: "selling_price", header: "Selling" }, { key: "cod_amount", header: "COD" },
  { key: "fee", header: "Fee" }, { key: "remit", header: "Remit" },
];

export type BillRow = {
  bill_id: string;
  settlement_date: string | null;
  parcel: number; cod: number; fee: number; net: number; exc: number;
  actual: number | null; note: string | null; entered_by: string | null;
  deposited_on: string | null;
};

type Parcel = {
  awb: string | null; order_id: string | null; seller_name: string | null;
  katLabel: string; katTone: "pos" | "cau" | "dan" | "mut";
  selling_price: number | null; cod_amount: number | null;
  fee: number | null; remit: number | null;
};

const TONE_CLASS: Record<string, string> = {
  pos: "chipPos", cau: "chipCau", dan: "chipDan", mut: "chipMut",
};

const isMatched = (net: number, actual: number) => Math.abs(net - actual) < 0.005;

// Tarikh hari ini dalam waktu tempatan (bukan UTC) sebagai YYYY-MM-DD, untuk
// default input date supaya tak tergelincir sehari pada zon waktu timur UTC.
const todayLocal = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// Papar tarikh deposit sebenar + lag vs settlement (maklumat, bukan amaran):
// "18 Jun" tanpa settlement, "18 Jun (+2d)" bila ada. Lag = deposited − settled.
function DepositLabel({ depositedOn, settlementDate }: {
  depositedOn: string; settlementDate: string | null;
}) {
  const short = fmtDay(depositedOn.slice(0, 10));
  let tag: string | null = null;
  if (settlementDate) {
    const a = Date.parse(depositedOn.slice(0, 10) + "T00:00:00");
    const b = Date.parse(settlementDate.slice(0, 10) + "T00:00:00");
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      const days = Math.round((a - b) / 86_400_000);
      tag = days === 0 ? "same day" : days > 0 ? `+${days}d` : `−${Math.abs(days)}d`;
    }
  }
  return (
    <span>
      {short}
      {tag && <span className="faintCell"> ({tag})</span>}
    </span>
  );
}

export default function BillsTable({
  rows, courierName, streamKey,
}: { rows: BillRow[]; courierName: string; streamKey: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [depositDate, setDepositDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Drill parcel per bil (on-demand).
  const [openBill, setOpenBill] = useState<string | null>(null);
  const [parcels, setParcels] = useState<Record<string, Parcel[]>>({});
  const [loadingBill, setLoadingBill] = useState<string | null>(null);

  const toggle = async (bill_id: string) => {
    if (openBill === bill_id) { setOpenBill(null); return; }
    setOpenBill(bill_id);
    if (!parcels[bill_id]) {
      setLoadingBill(bill_id);
      try {
        const res = await fetch(`/api/billParcels?key=${encodeURIComponent(streamKey)}&bill=${encodeURIComponent(bill_id)}`);
        const j = await res.json();
        setParcels((p) => ({ ...p, [bill_id]: res.ok ? (j.rows ?? []) : [] }));
      } catch {
        setParcels((p) => ({ ...p, [bill_id]: [] }));
      }
      setLoadingBill(null);
    }
  };

  const open = (r: BillRow) => {
    setEditing(r.bill_id);
    setAmount(r.actual != null ? String(r.actual) : String(Math.max(0, r.net)));
    setDepositDate(r.deposited_on?.slice(0, 10) ?? todayLocal());
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
        body: JSON.stringify({
          bill_id, actual_amount: val,
          deposited_on: depositDate || null, note: note.trim() || null,
        }),
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

  const totNet = rows.reduce((a, r) => a + r.net, 0);
  const confirmed = rows.filter((r) => r.actual != null);
  const totActual = confirmed.reduce((a, r) => a + (r.actual ?? 0), 0);
  const totVar = Math.round((confirmed.reduce((a, r) => a + (r.net - (r.actual ?? 0)), 0)) * 100) / 100;

  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">Settlement bills</div>
        <div className="cardHint">click a bill to see its parcels · confirm the bank amount to close the loop</div>
        <ExportCsv rows={rows} columns={BILL_COLS} filename={`${streamKey}-bills.csv`} />
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Bill</th><th>Settled</th><th className="num">Parcels</th>
              <th className="num">Net remit</th>
              <th className="num">In bank</th><th>Deposited</th><th className="num">Variance</th>
              <th>Books</th><th aria-label="Confirm" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isEd = editing === r.bill_id;
              const has = r.actual != null;
              const matched = has && isMatched(r.net, r.actual!);
              const variance = has ? Math.round((r.net - r.actual!) * 100) / 100 : null;
              const isOpen = openBill === r.bill_id;
              const list = parcels[r.bill_id];
              return (
                <FragmentRow key={r.bill_id}>
                  <tr>
                    <td className="cellMain">
                      <button className="billToggle" onClick={() => toggle(r.bill_id)}
                              aria-expanded={isOpen} title="Show parcels">
                        <span className={"billChev" + (isOpen ? " open" : "")}>▸</span>
                        {r.bill_id}
                      </button>
                    </td>
                    <td>{fmtDate(r.settlement_date)}</td>
                    <td className="num">{fmtInt(r.parcel)}</td>
                    <td className="num"><b>{fmtRM(r.net)}</b></td>

                    {isEd ? (
                      <td className="num" colSpan={3}>
                        <div className="bankEdit">
                          <input
                            className="cellInput num" type="number" step="0.01" min={0}
                            value={amount} autoFocus
                            onChange={(e) => setAmount(e.target.value)}
                            aria-label={`Bank amount for ${r.bill_id}`}
                            placeholder="Amount in bank"
                          />
                          <label className="bankDateRow">
                            <span className="bankDateLabel">Actual deposit date</span>
                            <input
                              className="cellInput" type="date"
                              value={depositDate}
                              onChange={(e) => setDepositDate(e.target.value)}
                              aria-label={`Actual deposit date for ${r.bill_id}`}
                            />
                          </label>
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
                        <td>
                          {!has ? (
                            <span className="faintCell">—</span>
                          ) : r.deposited_on ? (
                            <DepositLabel depositedOn={r.deposited_on}
                              settlementDate={r.settlement_date} />
                          ) : (
                            <span className="faintCell">not recorded</span>
                          )}
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

                  {isOpen && (
                    <tr className="drillRow">
                      <td colSpan={9}>
                        {loadingBill === r.bill_id ? (
                          <div className="drillNote">Loading parcels…</div>
                        ) : !list || list.length === 0 ? (
                          <div className="drillNote">No parcels found for this bill.</div>
                        ) : (
                          <div className="tableWrap">
                            <table className="drillTable">
                              <thead>
                                <tr>
                                  <th>AWB</th><th>Order</th><th>Stockist</th><th>Status</th>
                                  <th className="num">Selling</th><th className="num">COD</th>
                                  <th className="num">Fee</th><th className="num">Remit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {list.map((p, i) => (
                                  <tr key={`${p.awb ?? p.order_id}-${i}`}>
                                    <td>{trackingOrDash(p.awb)}</td>
                                    <td className="cellMain">{p.order_id ?? "—"}</td>
                                    <td>{p.seller_name ?? "—"}</td>
                                    <td><span className={"chip " + (TONE_CLASS[p.katTone] ?? "chipMut")}>
                                      <span className="cdot" /> {p.katLabel}</span></td>
                                    <td className="num">{p.selling_price != null ? fmtRM(p.selling_price) : "—"}</td>
                                    <td className="num">{p.cod_amount != null ? fmtRM(p.cod_amount) : "—"}</td>
                                    <td className="num">{p.fee != null ? fmtRM(p.fee) : "—"}</td>
                                    <td className="num">{p.remit != null ? fmtRM(p.remit) : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="drillNote">
                              {fmtInt(list.length)} parcels in {r.bill_id}
                              {" · "}
                              <ExportCsv rows={list} columns={PARCEL_COLS}
                                filename={`${r.bill_id}-parcels.csv`} label="Download CSV" />
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </FragmentRow>
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

// Pembungkus supaya dua <tr> (baris bil + baris drill) berkongsi satu key.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
