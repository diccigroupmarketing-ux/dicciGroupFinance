import { getRecentEvents } from "@/lib/audit";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  upload: "Upload", sku_save: "SKU mapping", store_reset: "Store reset",
  bank_confirm: "Bank confirmed", bank_clear: "Bank cleared",
};
const ACTION_TONE: Record<string, string> = {
  upload: "chipPos", sku_save: "chipMut", store_reset: "chipDan",
  bank_confirm: "chipPos", bank_clear: "chipCau",
};

// "2026-07-05T12:34:56.000Z" -> "5 Jul, 12:34"
function fmtStamp(ts: string | null): string {
  if (!ts) return "—";
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return ts;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}, ${m[4]}:${m[5]}`;
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
