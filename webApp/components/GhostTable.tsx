"use client";

// Tab "Ghost money": duit masuk (baris bil / bayaran) tanpa order padan, silang
// kurier. READ-ONLY. Nota jujur MENONJOL: selalunya order cuma belum diupload,
// jadi semak Uploads dulu sebelum anggap ia bocor betul. Drill ke search page
// ikut AWB.
import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtDate, fmtInt, fmtRM, trackingOrDash } from "@/lib/format";
import TableFilter from "@/components/TableFilter";
import ExportCsv from "@/components/ExportCsv";
import InfoTip from "@/components/InfoTip";
import ResolveButton from "@/components/ResolveButton";
import { badgeState } from "@/components/resolveTypes";
import type {
  ReasonOptionUI, ResolveLimits, ResolveTarget,
} from "@/components/resolveTypes";

export interface GhostRowUI {
  awb: string | null; cod_amount: number | null; bill_id: string | null;
  settlement_date: string | null; source_file: string | null;
  courier: string; streamKey: string;
}

const CSV_COLS = [
  { key: "awb", header: "AWB / tracking" },
  { key: "courier", header: "Courier" },
  { key: "bill_id", header: "Bill / statement" },
  { key: "source_file", header: "Source file" },
  { key: "settlement_date", header: "Settlement date" },
  { key: "received", header: "Received from bill" },
];

export default function GhostTable({
  rows, totalN, couriers, targets, reasons, limits,
}: {
  rows: GhostRowUI[];
  totalN: number;
  couriers: string[];
  // Dikunci `${streamKey}:${awb}` (AWB sahaja tak unik merentas gateway).
  targets: Record<string, ResolveTarget>;
  reasons: ReasonOptionUI[];
  limits: ResolveLimits;
}) {
  const [q, setQ] = useState("");
  const [courier, setCourier] = useState("all");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (courier !== "all" && r.courier !== courier) return false;
      if (needle) {
        const hay = `${r.awb ?? ""} ${r.bill_id ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, courier]);

  const csvRows = visible.map((r) => ({
    awb: r.awb, courier: r.courier, bill_id: r.bill_id,
    source_file: r.source_file, settlement_date: r.settlement_date,
    received: r.cod_amount,
  }));
  const filtering = q.trim() || courier !== "all";

  return (
    <>
      <div className="cauPanel" style={{ marginBottom: 14 }}>
        <div>
          <b>Money in with no matching order.</b>
          <p>Usually means the order isn&apos;t uploaded yet. Check Uploads before
            treating this as a leak. Only a payment that never maps to any order is a
            real ghost.</p>
        </div>
      </div>

      <div className="card">
        <div className="cardHead" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="cardTitle">Ghost money
            <InfoTip text="A payment that appears on a courier bill or CHIP statement but has no matching Fighter order. The most common cause is that the order file has not been uploaded yet, so always check Uploads first. A true ghost is money we received that maps to no order at all." />
          </div>
          <TableFilter placeholder="Find AWB / bill…" value={q} onChange={setQ} />
          <div className="segRow" role="group" aria-label="Filter courier">
            <button className={"segBtn" + (courier === "all" ? " active" : "")}
              onClick={() => setCourier("all")}>All</button>
            {couriers.map((c) => (
              <button key={c} className={"segBtn" + (courier === c ? " active" : "")}
                onClick={() => setCourier(c)}>{c}</button>
            ))}
          </div>
          <ExportCsv rows={csvRows} columns={CSV_COLS} filename="ghost-money.csv"
            label="Download CSV" />
        </div>
        <div className="cardHint" style={{ marginBottom: 6 }}>
          {filtering ? `${fmtInt(visible.length)} shown` : `${fmtInt(totalN)} line${totalN === 1 ? "" : "s"}`}
          {rows.length < totalN ? ` · showing ${fmtInt(rows.length)} of ${fmtInt(totalN)} (view capped)` : ""}
        </div>

        {visible.length === 0 ? (
          <div className="cellMuted">
            {rows.length === 0
              ? "No ghost money. Every payment maps to an order."
              : "No ghost lines match these filters."}
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>AWB / tracking</th>
                  <th>Courier</th>
                  <th>Bill</th>
                  <th>Settlement date</th>
                  <th className="num">Received from bill</th>
                  <th>Resolution</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const t = r.awb ? targets[`${r.streamKey}:${r.awb}`] : undefined;
                  const st = t?.badge ? badgeState(t.badge) : null;
                  const dim = st === "settled" || st === "snoozed";
                  return (
                  <tr key={`${r.awb ?? r.bill_id}-${i}`}
                    className={dim ? "rowResolved" : undefined}>
                    <td className="cellMain">{trackingOrDash(r.awb)}</td>
                    <td>{r.courier}</td>
                    <td>{r.bill_id ?? "—"}
                      {r.source_file && (
                        <div className="cellSub" title={r.source_file}>
                          {r.source_file.length > 28 ? r.source_file.slice(0, 27) + "…" : r.source_file}
                        </div>
                      )}
                    </td>
                    <td>{fmtDate(r.settlement_date)}</td>
                    <td className="num"><b>{r.cod_amount != null ? fmtRM(r.cod_amount) : "—"}</b></td>
                    <td>
                      {t
                        ? <ResolveButton target={t} reasons={reasons} limits={limits} compact />
                        : <span className="cellSub">—</span>}
                    </td>
                    <td>
                      {r.awb && (
                        <Link className="cardLink"
                          href={`/impact/search?q=${encodeURIComponent(r.awb)}`}>
                          Investigate
                        </Link>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
