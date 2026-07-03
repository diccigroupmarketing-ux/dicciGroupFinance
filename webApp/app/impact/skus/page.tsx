import { skuMap } from "@/lib/recon";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SkusPage() {
  const rows = await skuMap();

  return (
    <>
      <div className="pageHead">
        <div>
          <div className="eyebrow">Dicci Impact · Configuration</div>
          <h1>SKU / Bottles</h1>
          <div className="pageSub">
            How each SKU converts into bottles. paid = paid bottles, free = giveaway
            portion (e.g. +1 / +2 KORBAN), tracked separately for costing.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">SKU mapping</div>
          <div className="cardHint">{fmtInt(rows.length)} SKUs configured</div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th><th>Product name</th>
                <th className="num">Paid bottles</th>
                <th className="num">Free bottles</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td className="cellMain">{r.sku}</td>
                  <td>{r.product_name ?? "—"}</td>
                  <td className="num">{fmtInt(r.paid)}</td>
                  <td className="num">{fmtInt(r.free)}</td>
                  <td className="num"><b>{fmtInt(r.paid + r.free)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cauPanel">
          <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="9" width="12" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
          </svg>
          <div>
            <b>Editing unlocks with the sign-in phase.</b>
            <p>Until then, Finance edits this mapping in the current Streamlit app
              (SKU / Bottles tab); changes appear here instantly since both apps share
              the same store.</p>
          </div>
        </div>
      </div>

      <div className="footNote">
        Orders with SKUs missing from this table count as 0 bottles until mapped.
      </div>
    </>
  );
}
