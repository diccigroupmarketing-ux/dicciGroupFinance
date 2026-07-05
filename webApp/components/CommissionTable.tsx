"use client";

import { useState } from "react";
import { fmtDate, fmtInt, fmtRM } from "@/lib/format";

type Row = { seller_name: string; level: string; earned: number; paid: number; balance: number };
type BySrc = { source: string; txn_type: string; count: number; total: number };
type Txn = {
  txn_date: string | null; order_id: string | null; source: string | null;
  txn_type: string | null; status: string | null; amount: number;
};
type Detail = { bySrc: BySrc[]; detail: Txn[]; total: number };

const DETAIL_SHOWN = 40;

export default function CommissionTable({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, Detail>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const toggle = async (seller: string) => {
    if (open === seller) { setOpen(null); return; }
    setOpen(seller);
    if (!cache[seller]) {
      setLoading(seller);
      try {
        const res = await fetch(`/api/commission?seller=${encodeURIComponent(seller)}`);
        const j = await res.json();
        if (res.ok) setCache((c) => ({ ...c, [seller]: j }));
      } catch { /* biar drill kosong */ }
      setLoading(null);
    }
  };

  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">Per stockist</div>
        <div className="cardHint">click a stockist to see sources &amp; transactions</div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Stockist</th><th>Level</th>
              <th className="num">Earned</th><th className="num">Paid out</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open === r.seller_name;
              const d = cache[r.seller_name];
              return (
                <FragmentRow key={r.seller_name}>
                  <tr>
                    <td className="cellMain">
                      <button className="billToggle" onClick={() => toggle(r.seller_name)}
                              aria-expanded={isOpen} title="Show transactions">
                        <span className={"billChev" + (isOpen ? " open" : "")}>▸</span>
                        {r.seller_name}
                      </button>
                    </td>
                    <td>{r.level ? <span className="chip chipMut"><span className="cdot" /> {r.level}</span> : "—"}</td>
                    <td className="num">{fmtRM(r.earned)}</td>
                    <td className="num">{fmtRM(r.paid)}</td>
                    <td className="num"><b>{fmtRM(r.balance)}</b></td>
                  </tr>
                  {isOpen && (
                    <tr className="drillRow">
                      <td colSpan={5}>
                        {loading === r.seller_name ? (
                          <div className="drillNote">Loading transactions…</div>
                        ) : !d ? (
                          <div className="drillNote">No data.</div>
                        ) : (
                          <>
                            <div className="drillNote" style={{ marginTop: 0, marginBottom: 8 }}>
                              <b>By source</b> (approved only)
                            </div>
                            <div className="tableWrap">
                              <table className="drillTable">
                                <thead>
                                  <tr><th>Source</th><th>Type</th><th className="num">Count</th><th className="num">Total</th></tr>
                                </thead>
                                <tbody>
                                  {d.bySrc.map((b, i) => (
                                    <tr key={i}>
                                      <td>{b.source}</td><td>{b.txn_type}</td>
                                      <td className="num">{fmtInt(b.count)}</td>
                                      <td className="num"><b>{fmtRM(b.total)}</b></td>
                                    </tr>
                                  ))}
                                  {d.bySrc.length === 0 && (
                                    <tr><td colSpan={4} className="cellMuted">No approved transactions.</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            <div className="drillNote">
                              <b>Transactions</b> · showing {fmtInt(Math.min(d.detail.length, DETAIL_SHOWN))} of {fmtInt(d.total)}
                            </div>
                            <div className="tableWrap">
                              <table className="drillTable">
                                <thead>
                                  <tr><th>Date</th><th>Order</th><th>Source</th><th>Type</th><th>Status</th><th className="num">Amount</th></tr>
                                </thead>
                                <tbody>
                                  {d.detail.slice(0, DETAIL_SHOWN).map((t, i) => (
                                    <tr key={i}>
                                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(t.txn_date)}</td>
                                      <td className="cellMain">{t.order_id ?? "—"}</td>
                                      <td>{t.source ?? "—"}</td>
                                      <td>{t.txn_type ?? "—"}</td>
                                      <td>{t.status ?? "—"}</td>
                                      <td className="num">{fmtRM(t.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
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
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
