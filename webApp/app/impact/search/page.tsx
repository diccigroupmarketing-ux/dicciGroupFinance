import { searchOrders } from "@/lib/recon";
import { fmtDate, fmtInt, fmtRM, trackingOrDash } from "@/lib/format";
import SearchBox from "@/components/SearchBox";

export const dynamic = "force-dynamic";

export default async function SearchPage(
  { searchParams }: { searchParams: Promise<{ q?: string }> },
) {
  const q = ((await searchParams).q ?? "").trim();
  const rows = q.length >= 2 ? await searchOrders(q) : [];

  return (
    <>
      <div className="pageHead">
        <div>
          <div className="eyebrow">Dicci Impact · Investigate</div>
          <h1>Find an order</h1>
          <div className="pageSub">
            Search by order ID or tracking number to see if the money landed, in which
            bill, and at what amount.
          </div>
        </div>
      </div>

      <div className="card">
        <SearchBox initial={q} />
      </div>

      {q.length >= 2 && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Results</div>
              <div className="cardHint">
                {rows.length === 0 ? "no match" : `${fmtInt(rows.length)} match${rows.length === 1 ? "" : "es"}`}
                {rows.length === 50 ? " (showing first 50)" : ""}
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="cardHint" style={{ padding: "22px 0" }}>
                No order matches “{q}”. Try the full order ID or tracking number.
              </div>
            ) : (
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th><th>Stockist</th><th>Tracking</th>
                      <th className="num">Selling price</th>
                      <th>Settlement</th><th className="num">In bill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const settled = r.bill_id != null;
                      const prepaid = r.prepaid_gateway != null;
                      return (
                        <tr key={`${r.order_id ?? r.tracking}-${i}`}>
                          <td className="cellMain">{r.order_id ?? "—"}
                            <div className="cellSub">{fmtDate(r.order_date)}</div>
                          </td>
                          <td>{r.seller_name ?? "—"}
                            <div className="cellSub">{r.shipping_provider ?? r.payment_method ?? ""}</div>
                          </td>
                          <td>{trackingOrDash(r.tracking)}</td>
                          <td className="num">{r.selling_price != null ? fmtRM(r.selling_price) : "—"}</td>
                          <td>
                            {settled ? (
                              <>
                                <span className="chip chipPos"><span className="cdot" /> In bill {r.bill_id}</span>
                                <div className="cellSub">
                                  {r.courier ?? ""}{r.settlement_date ? ` · ${fmtDate(r.settlement_date)}` : ""}
                                </div>
                              </>
                            ) : prepaid ? (
                              <>
                                <span className="chip chipPos"><span className="cdot" /> {r.prepaid_gateway}</span>
                                <div className="cellSub">{r.prepaid_status ?? ""}</div>
                              </>
                            ) : (
                              <span className="chip chipMut"><span className="cdot" /> No settlement yet</span>
                            )}
                          </td>
                          <td className="num">
                            {settled ? (
                              <>
                                <b>{fmtRM(r.cod_amount ?? 0)}</b>
                                <div className="cellSub">fee {fmtRM(r.fee ?? 0)}</div>
                              </>
                            ) : prepaid ? (
                              <b>{fmtRM(r.prepaid_amount ?? 0)}</b>
                            ) : "—"}
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
      )}

      <div className="footNote">
        Settlement shows whether the tracking appears in a COD bill or a prepaid
        statement. It does not re-run the full category logic.
      </div>
    </>
  );
}
