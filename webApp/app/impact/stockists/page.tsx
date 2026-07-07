import Link from "next/link";
import { stockistBottles, stockistOrders, storeCounts } from "@/lib/recon";
import { fmtDate, fmtInt, trackingOrDash } from "@/lib/format";
import { Chip } from "@/components/Chip";
import ExportCsv from "@/components/ExportCsv";

const BOTTLE_COLS = [
  { key: "stockist", header: "Stockist" },
  { key: "confirmed_orders", header: "Confirmed orders" },
  { key: "paid_bottles", header: "Paid bottles" },
  { key: "free_bottles", header: "Free bottles" },
  { key: "total_bottles", header: "Total bottles" },
  { key: "unconfirmed_bottles", header: "Unconfirmed bottles" },
];
const DRILL_COLS = [
  { key: "order_id", header: "Order" }, { key: "order_date", header: "Date" },
  { key: "status", header: "Status" }, { key: "payment_method", header: "Payment" },
  { key: "shipping_provider", header: "Courier" }, { key: "tracking", header: "Tracking" },
  { key: "botol_paid", header: "Paid" }, { key: "botol_free", header: "Free" },
  { key: "botol_total", header: "Total bottles" }, { key: "duit", header: "Money" },
];

export const dynamic = "force-dynamic";

export default async function StockistsPage(
  { searchParams }: { searchParams: Promise<{ s?: string }> },
) {
  const { s } = await searchParams;
  const counts = await storeCounts();

  if (counts.orders === 0) {
    return (
      <>
        <Header />
        <div className="emptyCard">
          <div className="big">No data yet</div>
          Upload a Fighter export to see bottles per stockist.
        </div>
      </>
    );
  }

  const rows = await stockistBottles();
  const totBottles = rows.reduce((a, r) => a + r.total_bottles, 0);
  const totFree = rows.reduce((a, r) => a + r.free_bottles, 0);
  const totUnconfirmed = rows.reduce((a, r) => a + r.unconfirmed_bottles, 0);

  const picked = s && rows.some((r) => r.stockist === s) ? s : null;
  const drill = picked ? await stockistOrders(picked) : null;

  return (
    <>
      <Header />

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Bottles per stockist</div>
          <div className="cardHint">
            paid (sales) + free (cost), counted once payment is confirmed
          </div>
          <ExportCsv rows={rows} columns={BOTTLE_COLS}
            filename="impact-stockist-bottles.csv" />
        </div>
        <p className="pageSub" style={{ marginTop: 2 }}>
          Confirmed: <b>{fmtInt(totBottles)}</b> bottles ({fmtInt(totFree)} free) across{" "}
          {rows.length} stockists. Awaiting payment confirmation: {fmtInt(totUnconfirmed)} bottles.
          Bottles count across all couriers, but only for Completed orders whose money is
          confirmed by an uploaded money feed.
        </p>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drill && picked && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">{picked}</div>
              <div className="cardHint">orders one by one, latest first</div>
              <ExportCsv rows={drill.rows} columns={DRILL_COLS} total={drill.total}
                filename={`stockist-${picked}-orders.csv`} />
              <Link href="/impact/stockists" className="cardLink">Close ×</Link>
            </div>
            {drill.rows.length < drill.total && (
              <div className="cardHint">
                Showing latest {fmtInt(drill.rows.length)} of {fmtInt(drill.total)} orders.
              </div>
            )}
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th><th>Date</th><th>Status</th><th>Payment</th>
                    <th>Courier</th><th>Tracking</th>
                    <th className="num">Paid</th><th className="num">Free</th>
                    <th>Money</th>
                  </tr>
                </thead>
                <tbody>
                  {drill.rows.map((o) => (
                    <tr key={o.order_id}>
                      <td className="cellMain">{o.order_id}</td>
                      <td>{fmtDate(o.order_date)}</td>
                      <td>{o.status ?? "—"}</td>
                      <td>{o.payment_method ?? "—"}</td>
                      <td>{o.shipping_provider ?? "—"}</td>
                      <td>{trackingOrDash(o.tracking)}</td>
                      <td className="num">{fmtInt(o.botol_paid)}</td>
                      <td className="num">{fmtInt(o.botol_free)}</td>
                      <td>{o.duit === "confirmed"
                        ? <Chip tone="pos">Confirmed</Chip>
                        : <Chip tone="mut">Unconfirmed</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="footNote">
        &quot;Unconfirmed&quot; flips automatically once the matching money feed
        (courier bill, CHIP statement) is uploaded, no rework needed.
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Dicci Impact · People</div>
        <h1>Stockists</h1>
        <div className="pageSub">Bottles moved per stockist, across every courier and payment method.</div>
      </div>
    </div>
  );
}
