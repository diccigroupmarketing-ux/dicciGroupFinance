import { getRecentEvents } from "@/lib/audit";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  upload: "Upload", sku_save: "SKU mapping", store_reset: "Store reset",
  bank_confirm: "Bank confirmed", bank_clear: "Bank cleared",
  upload_delete: "Upload deleted",
};
const ACTION_TONE: Record<string, string> = {
  upload: "chipPos", sku_save: "chipMut", store_reset: "chipDan",
  bank_confirm: "chipPos", bank_clear: "chipCau",
  upload_delete: "chipDan",
};

// ts disimpan dalam UTC (new Date().toISOString()). Papar dalam waktu Malaysia
// secara EKSPLISIT (timeZone Asia/Kuala_Lumpur) supaya konsisten di dev dan di
// prod (server prod = UTC). Contoh: "2026-07-23T12:34:56Z" -> "23 Jul, 20:34".
const KL_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuala_Lumpur",
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
function fmtStamp(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const p = KL_FMT.formatToParts(d).reduce<Record<string, string>>(
    (a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

export default async function ActivityPage() {
  const events = await getRecentEvents(80);

  return (
    <>
      <div className="pageHead">
        <div>
          <div className="eyebrow">Dicci Impact · Governance</div>
          <h1>Activity</h1>
          <div className="pageSub">
            Who changed what: uploads, SKU edits, bank confirmations, and resets.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Recent activity</div>
          <div className="cardHint">{fmtInt(events.length)} latest events</div>
        </div>
        {events.length === 0 ? (
          <div className="cardHint" style={{ padding: "22px 0" }}>
            No activity recorded yet. Actions appear here as the team uses the app.
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>When</th><th>Action</th><th>Detail</th><th>By</th></tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td className="cellMain" style={{ whiteSpace: "nowrap" }}>{fmtStamp(e.ts)}</td>
                    <td>
                      <span className={"chip " + (ACTION_TONE[e.action ?? ""] ?? "chipMut")}>
                        <span className="cdot" /> {ACTION_LABEL[e.action ?? ""] ?? e.action}
                      </span>
                    </td>
                    <td>{e.detail ?? "—"}</td>
                    <td>{e.actor ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footNote">
        Append-only log · newest first · retained in the shared store.
      </div>
    </>
  );
}
