"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtInt, fmtRM } from "@/lib/format";
import TableFilter from "@/components/TableFilter";

export interface StockistTableRow {
  stockist: string;
  confirmed_orders: number;
  paid_bottles: number;
  free_bottles: number;
  total_bottles: number;
  unconfirmed_bottles: number;
  gifts: { name: string; qty: number }[];
  giftCost: number;
}

// Jadual botol per stokis (client) supaya boleh tapis nama live. Markup kekal
// sama macam versi server sebelum ni, cuma tambah kotak tapis di atas.
export default function StockistTable({
  rows, picked,
}: {
  rows: StockistTableRow[];
  picked: string | null;
}) {
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.stockist.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <>
      <div className="cardHead" style={{ marginTop: 4, marginBottom: 6 }}>
        <TableFilter placeholder="Filter stockists…" value={q} onChange={setQ} />
        {q.trim() && (
          <div className="cardHint">{visible.length} of {rows.length} stockists</div>
        )}
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Stockist</th>
              <th className="num">Confirmed orders</th>
              <th className="num">Paid bottles</th>
              <th className="num">Free bottles</th>
              <th className="num">Total bottles</th>
              <th className="num">Unconfirmed</th>
              <th>Free gifts</th>
              <th className="num">Giveaway cost</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.stockist}
                style={picked === r.stockist ? { background: "#FAF7EF" } : undefined}>
                <td>
                  <Link href={`/impact/stockists?s=${encodeURIComponent(r.stockist)}`}
                    className="cellMain" style={{ color: "var(--goldDark)" }}>
                    {r.stockist}
                  </Link>
                </td>
                <td className="num">{fmtInt(r.confirmed_orders)}</td>
                <td className="num">{fmtInt(r.paid_bottles)}</td>
                <td className="num">{fmtInt(r.free_bottles)}</td>
                <td className="num"><b>{fmtInt(r.total_bottles)}</b></td>
                <td className="num">{fmtInt(r.unconfirmed_bottles)}</td>
                <td>
                  {r.gifts.length === 0
                    ? <span style={{ color: "var(--faint)" }}>—</span>
                    : (
                      <div className="giftChips">
                        {r.gifts.slice(0, 4).map((x) => (
                          <span className="giftChip" key={x.name}>{x.name} <b>×{fmtInt(x.qty)}</b></span>
                        ))}
                        {r.gifts.length > 4 && (
                          <span className="giftChip">+{r.gifts.length - 4}</span>
                        )}
                      </div>
                    )}
                </td>
                <td className="num" style={{ color: "var(--goldDark)" }}>
                  {r.giftCost > 0 ? <b>{fmtRM(r.giftCost)}</b> : <span style={{ color: "var(--faint)" }}>—</span>}
                </td>
              </tr>
            ))}
            {rows.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="cellMuted">
                  No stockist matches &quot;{q}&quot;. Looking for an order? Search from the Dashboard.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
