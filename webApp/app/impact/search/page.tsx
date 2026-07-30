import { searchOrders } from "@/lib/recon";
import { fmtDate, fmtInt, fmtRM, trackingOrDash } from "@/lib/format";
import AmountCell from "@/components/AmountCell";
import SearchBox from "@/components/SearchBox";
import ExportCsv, { CSV_UNREADABLE } from "@/components/ExportCsv";

const SEARCH_COLS = [
  { key: "order_id", header: "Order" }, { key: "order_date", header: "Date" },
  { key: "seller_name", header: "Stockist" }, { key: "tracking", header: "Tracking" },
  { key: "shipping_provider", header: "Courier" }, { key: "status", header: "Status" },
  { key: "payment_method", header: "Payment" }, { key: "selling_price", header: "Selling price" },
  { key: "courier", header: "Bill courier" }, { key: "bill_id", header: "Bill" },
  { key: "settlement_date", header: "Settlement" }, { key: "cod_amount", header: "COD amount" },
  { key: "fee", header: "Fee" }, { key: "prepaid_gateway", header: "Prepaid gateway" },
  { key: "prepaid_amount", header: "Prepaid amount" }, { key: "prepaid_status", header: "Prepaid status" },
];

// Baris hasil carian -> baris CSV. Bila baris duit memang WUJUD (ada bil, atau
// ada bayaran gateway) tapi amaunnya NULL, nilainya gagal dibaca masa ingest.
// Sel kosong dalam CSV mengaburkan itu dengan "tiada bayaran", jadi kita tulis
// token jujur , sama isyarat yang AmountCell pakai dalam jadual di bawah.
function searchToCsv(rows: Awaited<ReturnType<typeof searchOrders>>) {
  return rows.map((r) => ({
    ...r,
    cod_amount: r.cod_amount ?? (r.bill_id != null ? CSV_UNREADABLE : null),
    prepaid_amount: r.prepaid_amount
      ?? (r.prepaid_gateway != null ? CSV_UNREADABLE : null),
    // Fee hidup atas isyarat sama dengan cod_amount: ia datang dari baris bil.
    // Bil wujud tapi fee NULL = gagal dibaca, bukan "kurier tak potong fee".
    fee: r.fee ?? (r.bill_id != null ? CSV_UNREADABLE : null),
  }));
}

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
              {rows.length > 0 && (
                <ExportCsv rows={searchToCsv(rows)} columns={SEARCH_COLS}
                  label={rows.length === 50 ? "Download CSV (first 50)" : "Download CSV"}
                  filename={`search-${q.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}.csv`} />
              )}
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
                            {/* Dalam dua cabang ni baris duit memang WUJUD (ada
                                bil, atau ada bayaran gateway), jadi amount NULL
                                bermakna nilainya gagal dibaca masa ingest. Papar
                                RM 0.00 di sini = salah diagnosis "bayar kurang". */}
                            {settled ? (
                              <>
                                <AmountCell value={r.cod_amount} hasPayment bold />
                                {/* Fee ikut isyarat sama: baris bil wujud, jadi fee
                                    NULL = gagal dibaca, BUKAN "kurier tak potong
                                    fee". "fee RM 0.00" di sini buat finance ingat
                                    remit penuh sedangkan nilainya tak diketahui. */}
                                {r.fee != null ? (
                                  <div className="cellSub">fee {fmtRM(r.fee)}</div>
                                ) : (
                                  <div className="cellSub amtUnread">Fee unreadable</div>
                                )}
                              </>
                            ) : prepaid ? (
                              <AmountCell value={r.prepaid_amount} hasPayment bold />
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
