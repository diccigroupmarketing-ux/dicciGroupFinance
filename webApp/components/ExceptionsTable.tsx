"use client";

// Jadual "Integrity exceptions" pada page stream, dengan butang Resolve inline.
//
// PERATURAN PAPARAN (jangan dilanggar bila mengubah fail ni):
//   , Baris yang sudah settled / snoozed TIDAK hilang. Ia jadi kelabu dengan
//     chip keadaan + tooltip sebab. "Hide settled" ada, tapi lalainya MATI.
//   , Angka mentah baris tak pernah diubah. Adjustment cuma catatan sebab.
import { useMemo, useState } from "react";
import { fmtRM, trackingOrDash } from "@/lib/format";
import AmountCell from "@/components/AmountCell";
import ResolveButton from "@/components/ResolveButton";
import { ToneChip } from "@/components/ResolutionChip";
import { badgeState } from "@/components/resolveTypes";
import type {
  ReasonOptionUI, ResolveLimits, ResolveTarget,
} from "@/components/resolveTypes";

function tone(kat: string): "pos" | "cau" | "dan" | "mut" {
  if (kat === "tally") return "pos";
  if (kat === "hilang_lewat" || kat === "belum_remit" || kat === "belum_bayar") return "cau";
  return "dan";
}

export default function ExceptionsTable({
  rows, reasons, limits, showTracking = true,
}: {
  rows: ResolveTarget[];
  reasons: ReasonOptionUI[];
  limits: ResolveLimits;
  showTracking?: boolean;
}) {
  const [hideDone, setHideDone] = useState(false);

  const closed = useMemo(
    () => rows.filter((r) => {
      if (!r.badge) return false;
      const st = badgeState(r.badge);
      return st === "settled" || st === "snoozed";
    }).length,
    [rows],
  );

  const visible = useMemo(() => {
    if (!hideDone) return rows;
    return rows.filter((r) => {
      if (!r.badge) return true;
      const st = badgeState(r.badge);
      return st !== "settled" && st !== "snoozed";
    });
  }, [rows, hideDone]);

  return (
    <>
      {closed > 0 && (
        <div className="resolveToolbar">
          <label className="resolveToggle">
            <input type="checkbox" checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)} />
            Hide settled and snoozed ({closed})
          </label>
          <span className="resolveToolbarNote">
            Closed rows stay in this table by default, so the count you see always
            matches the raw figure above.
          </span>
        </div>
      )}

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Stockist</th>
              {showTracking && <th>Tracking</th>}
              <th>Status</th>
              <th className="num">Selling price</th>
              <th className="num">COD amount</th>
              <th>Resolution</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const st = r.badge ? badgeState(r.badge) : null;
              const dim = st === "settled" || st === "snoozed";
              return (
                <tr key={`${r.subjectType}:${r.subjectId}`}
                  className={dim ? "rowResolved" : undefined}>
                  <td className="cellMain">{r.title}</td>
                  <td>{r.sub ?? "—"}</td>
                  {showTracking && <td>{trackingOrDash(r.tracking)}</td>}
                  <td><ToneChip tone={tone(r.category)}>{r.categoryLabel}</ToneChip></td>
                  <td className="num">{r.expected != null ? fmtRM(r.expected) : "—"}</td>
                  <td className="num">
                    <AmountCell value={r.amount} hasPayment={r.hasPayment} />
                  </td>
                  <td>
                    <ResolveButton target={r} reasons={reasons} limits={limits} compact />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visible.length === 0 && (
        <div className="cellMuted">Every row here is settled or snoozed.</div>
      )}
    </>
  );
}
