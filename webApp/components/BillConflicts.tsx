import { fmtDate, fmtRM, trackingOrDash } from "@/lib/format";
import type { BillLineConflict } from "@/lib/recon";

// Seksyen "needs attention": parcel yang AWB-nya muncul dalam DUA bil courier
// berbeza (isu D3, double-billed). Baris baru TIDAK menimpa baris lama, ia
// dikuarantin supaya finance boleh bandingkan dua bil + amaun side by side.
// Hanya dirender bila ada konflik (page yang jaga syarat length > 0).
export default function BillConflicts({ rows }: { rows: BillLineConflict[] }) {
  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="cardHead">
        <div className="cardTitle">Needs attention · parcels billed twice</div>
        <div className="cardHint">
          {rows.length} tracking number{rows.length === 1 ? "" : "s"} appear in two
          different courier bills
        </div>
      </div>

      <div className="danPanel" style={{ marginBottom: 14 }}>
        <WarnIcon />
        <div>
          <b>The same parcel was listed in two separate bills.</b>
          <p>
            This can mean a double payout or a corrected bill. The newer line was
            <b> not applied</b> over the existing one, so no money was silently
            overwritten. Compare both bills below and keep the correct one.
          </p>
        </div>
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Stockist</th>
              <th>Tracking</th>
              <th>Existing bill</th>
              <th className="num">Existing COD</th>
              <th>New bill</th>
              <th className="num">New COD</th>
              <th className="num">New fee</th>
              <th>Detected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.awb}-${r.bill_id_new}`}>
                <td className="cellMain">{r.order_id ?? "— no order —"}</td>
                <td>{r.seller_name ?? "—"}</td>
                <td>{trackingOrDash(r.awb)}</td>
                <td>{r.bill_id_existing}</td>
                <td className="num">{r.cod_existing != null ? fmtRM(r.cod_existing) : "—"}</td>
                <td>{r.bill_id_new}</td>
                <td className="num">{r.cod_new != null ? fmtRM(r.cod_new) : "—"}</td>
                <td className="num">{r.fee_new != null ? fmtRM(r.fee_new) : "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.detected_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WarnIcon() {
  return (
    <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 3.5 18 16.5H2z" /><path d="M10 8.8v3.4M10 14.6v.2" />
    </svg>
  );
}
