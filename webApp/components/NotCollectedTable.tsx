"use client";

// Tab "Not collected": order yang duitnya belum masuk, silang kurier. READ-ONLY.
// Dua bahagian VISUAL berasingan (jangan dijumlahkan jadi satu "outstanding"):
//  - Overdue (hilang_lewat): merah, atas, susun umur menurun. Kejar.
//  - Awaiting remit (belum_remit): neutral, "normal until the bill lands".
// Semua tapis (kurier, stokis, kohort umur, cari order/tracking) di client atas
// baris yang dah dikira server. Tiada kiraan recon di sini.
import { useCallback, useMemo, useState } from "react";
import { fmtDate, fmtInt, fmtRM, trackingOrDash } from "@/lib/format";
import TableFilter from "@/components/TableFilter";
import ExportCsv from "@/components/ExportCsv";
import InfoTip from "@/components/InfoTip";
import ResolveButton from "@/components/ResolveButton";
import { badgeState } from "@/components/resolveTypes";
import type {
  ReasonOptionUI, ResolveLimits, ResolveTarget,
} from "@/components/resolveTypes";

export interface NotCollectedRowUI {
  order_id: string | null; order_date: string | null; seller_name: string | null;
  tracking: string | null; kategori: string; selling_price: number | null;
  umur_hari: number | null; courier: string; streamKey: string;
  source_file: string | null;
}

// Kohort umur: 0-14 dianggap normal (belum lewat pada ambang lalai), lepas tu
// makin tua makin perlu perhatian.
const COHORTS = [
  { key: "all", label: "All ages", lo: -Infinity, hi: Infinity },
  { key: "0-14", label: "0–14d", lo: 0, hi: 14 },
  { key: "15-30", label: "15–30d", lo: 15, hi: 30 },
  { key: "31-60", label: "31–60d", lo: 31, hi: 60 },
  { key: "60+", label: "60d+", lo: 61, hi: Infinity },
];

function inCohort(age: number | null, key: string): boolean {
  if (key === "all") return true;
  if (age == null) return false;
  const c = COHORTS.find((x) => x.key === key)!;
  return age >= c.lo && age <= c.hi;
}

const CSV_COLS = [
  { key: "section", header: "Section" },
  { key: "order_id", header: "Order" },
  { key: "order_date", header: "Order date" },
  { key: "age_days", header: "Age (days)" },
  { key: "courier", header: "Courier" },
  { key: "stockist", header: "Stockist" },
  { key: "expected", header: "Expected from orders" },
  { key: "tracking", header: "Tracking" },
  { key: "source_file", header: "Source file" },
];

function toCsv(rows: NotCollectedRowUI[], section: string) {
  return rows.map((r) => ({
    section, order_id: r.order_id, order_date: r.order_date,
    age_days: r.umur_hari, courier: r.courier, stockist: r.seller_name,
    expected: r.selling_price, tracking: r.tracking, source_file: r.source_file,
  }));
}

export default function NotCollectedTable({
  overdue, awaiting, couriers, overdueTotalN, awaitingTotalN,
  targets, reasons, limits,
}: {
  overdue: NotCollectedRowUI[];
  awaiting: NotCollectedRowUI[];
  couriers: string[];
  overdueTotalN: number;
  awaitingTotalN: number;
  // Lapisan Resolution: dikunci ikut order_id supaya tapisan client tak
  // memutuskan pautan antara baris dan kes.
  targets: Record<string, ResolveTarget>;
  reasons: ReasonOptionUI[];
  limits: ResolveLimits;
}) {
  const [q, setQ] = useState("");
  const [seller, setSeller] = useState("");
  const [courier, setCourier] = useState("all");
  const [cohort, setCohort] = useState("all");
  const [hideDone, setHideDone] = useState(false);

  const apply = useCallback((rows: NotCollectedRowUI[]) => {
    const needle = q.trim().toLowerCase();
    const sneedle = seller.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideDone && r.order_id) {
        const b = targets[r.order_id]?.badge;
        if (b) {
          const st = badgeState(b);
          if (st === "settled" || st === "snoozed") return false;
        }
      }
      if (courier !== "all" && r.courier !== courier) return false;
      if (!inCohort(r.umur_hari, cohort)) return false;
      if (sneedle && !(r.seller_name ?? "").toLowerCase().includes(sneedle)) return false;
      if (needle) {
        const hay = `${r.order_id ?? ""} ${r.tracking ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [q, seller, courier, cohort, hideDone, targets]);

  // Overdue: umur menurun (tertua dulu). Awaiting: umur menurun juga (paling
  // hampir jadi overdue di atas), tapi nadanya neutral.
  const vOverdue = useMemo(
    () => apply(overdue).sort((a, b) => (b.umur_hari ?? 0) - (a.umur_hari ?? 0)),
    [overdue, apply],
  );
  const vAwaiting = useMemo(
    () => apply(awaiting).sort((a, b) => (b.umur_hari ?? 0) - (a.umur_hari ?? 0)),
    [awaiting, apply],
  );

  const csvRows = [...toCsv(vOverdue, "Overdue"), ...toCsv(vAwaiting, "Awaiting remit")];
  const filtering = q.trim() || seller.trim() || courier !== "all" || cohort !== "all";
  const closedN = useMemo(() => [...overdue, ...awaiting].filter((r) => {
    const b = r.order_id ? targets[r.order_id]?.badge : undefined;
    if (!b) return false;
    const st = badgeState(b);
    return st === "settled" || st === "snoozed";
  }).length, [overdue, awaiting, targets]);

  return (
    <>
      <div className="card">
        <div className="cardHead" style={{ flexWrap: "wrap", gap: 10 }}>
          <TableFilter placeholder="Find order ID / tracking…" value={q} onChange={setQ} />
          <TableFilter placeholder="Filter stockist…" value={seller} onChange={setSeller} />
          <div className="segRow" role="group" aria-label="Filter courier">
            <button className={"segBtn" + (courier === "all" ? " active" : "")}
              onClick={() => setCourier("all")}>All couriers</button>
            {couriers.map((c) => (
              <button key={c} className={"segBtn" + (courier === c ? " active" : "")}
                onClick={() => setCourier(c)}>{c}</button>
            ))}
          </div>
          <div className="segRow" role="group" aria-label="Filter age">
            {COHORTS.map((c) => (
              <button key={c.key} className={"segBtn" + (cohort === c.key ? " active" : "")}
                onClick={() => setCohort(c.key)}>{c.label}</button>
            ))}
          </div>
          <ExportCsv rows={csvRows} columns={CSV_COLS} filename="not-collected.csv"
            label="Download CSV" />
        </div>
        {closedN > 0 && (
          <div className="resolveToolbar">
            <label className="resolveToggle">
              <input type="checkbox" checked={hideDone}
                onChange={(e) => setHideDone(e.target.checked)} />
              Hide settled and snoozed ({fmtInt(closedN)})
            </label>
            <span className="resolveToolbarNote">
              Closed rows stay listed by default, so the counts here always match the
              raw engine figures.
            </span>
          </div>
        )}
      </div>

      <div className="sectionGap" />

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Overdue
            <InfoTip text="Completed orders that have gone past the aging threshold with no matching courier bill yet. Money to chase, unless the bill simply has not been uploaded." />
          </div>
          <div className="cardHint">
            {filtering
              ? `${fmtInt(vOverdue.length)} shown`
              : `${fmtInt(overdueTotalN)} order${overdueTotalN === 1 ? "" : "s"}`}
            {overdue.length < overdueTotalN ? ` · showing ${fmtInt(overdue.length)} of ${fmtInt(overdueTotalN)} (view capped)` : ""}
            {" · oldest first"}
          </div>
        </div>
        <NotCollectedRows rows={vOverdue} tone="dan" targets={targets}
          reasons={reasons} limits={limits}
          empty="No overdue orders match these filters." />
      </div>

      <div className="sectionGap" />

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Awaiting remit
            <InfoTip text="Completed orders still within the normal window. This is expected until the courier bill lands, so it is not a leak on its own." />
          </div>
          <div className="cardHint">
            {filtering
              ? `${fmtInt(vAwaiting.length)} shown`
              : `${fmtInt(awaitingTotalN)} order${awaitingTotalN === 1 ? "" : "s"}`}
            {awaiting.length < awaitingTotalN ? ` · showing ${fmtInt(awaiting.length)} of ${fmtInt(awaitingTotalN)} (view capped)` : ""}
          </div>
        </div>
        <div className="cauPanel" style={{ marginBottom: 12 }}>
          <div>
            <b>Normal until the bill lands.</b>
            <p>These are not overdue and not a leak. They move to Overdue on their own
              if the aging threshold passes with still no bill.</p>
          </div>
        </div>
        <NotCollectedRows rows={vAwaiting} tone="mut" targets={targets}
          reasons={reasons} limits={limits}
          empty="No awaiting-remit orders match these filters." />
      </div>
    </>
  );
}

function NotCollectedRows({
  rows, tone, empty, targets, reasons, limits,
}: {
  rows: NotCollectedRowUI[]; tone: "dan" | "mut"; empty: string;
  targets: Record<string, ResolveTarget>;
  reasons: ReasonOptionUI[];
  limits: ResolveLimits;
}) {
  if (rows.length === 0) {
    return <div className="cellMuted">{empty}</div>;
  }
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th className="num">Age</th>
            <th>Courier</th>
            <th>Stockist</th>
            <th className="num">Expected from orders</th>
            <th>Tracking</th>
            <th>Resolution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const t = r.order_id ? targets[r.order_id] : undefined;
            const st = t?.badge ? badgeState(t.badge) : null;
            const dim = st === "settled" || st === "snoozed";
            return (
            <tr key={`${r.order_id ?? r.tracking}-${i}`}
              className={dim ? "rowResolved" : undefined}>
              <td className="cellMain">{r.order_id ?? "—"}
                <div className="cellSub">{fmtDate(r.order_date)}</div>
              </td>
              <td className="num">
                <b style={{ color: tone === "dan" ? "var(--danText)" : "var(--muted)" }}>
                  {r.umur_hari != null ? `${fmtInt(r.umur_hari)}d` : "—"}
                </b>
              </td>
              <td>{r.courier}</td>
              <td>{r.seller_name ?? "—"}
                {r.source_file && (
                  <div className="cellSub" title={r.source_file}>
                    from {r.source_file.length > 28 ? r.source_file.slice(0, 27) + "…" : r.source_file}
                  </div>
                )}
              </td>
              <td className="num">{r.selling_price != null ? fmtRM(r.selling_price) : "—"}</td>
              <td>{trackingOrDash(r.tracking)}</td>
              <td>
                {t
                  ? <ResolveButton target={t} reasons={reasons} limits={limits} compact />
                  : <span className="cellSub">—</span>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
