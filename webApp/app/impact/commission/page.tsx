import { commissionSummary } from "@/lib/recon";
import { fmtInt, fmtRM } from "@/lib/format";
import { Chip } from "@/components/Chip";

export const dynamic = "force-dynamic";

export default async function CommissionPage() {
  const rows = await commissionSummary();

  if (!rows.length) {
    return (
      <>
        <Header />
        <div className="emptyCard">
          <div className="big">No commission data yet</div>
          Upload a Fighter Wallet export to see stockist commission.
        </div>
      </>
    );
  }

  const earned = rows.reduce((a, r) => a + r.earned, 0);
  const paid = rows.reduce((a, r) => a + r.paid, 0);
  const [rm, cents] = fmtRM(earned).split(".");

  return (
    <>
      <Header />
      <div className="hero">
        <div className="heroTop">
          <div className="heroLabel">Commission earned · uploaded period</div>
          <div className="heroChip warn"><span className="dot" /> Record only · full tally coming</div>
        </div>
        <div className="heroFigure">
          <small>RM</small>{rm.replace("RM ", "")}<span className="cents">.{cents}</span>
        </div>
        <div className="heroSub">
          <b>{fmtInt(rows.length)} stockists</b> · {fmtRM(paid)} paid out (withdrawals)
        </div>
      </div>

      <div className="sectionGap" />

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Per stockist</div>
          <div className="cardHint">earned (Sales + Recruitment) vs paid out (withdrawals)</div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Stockist</th><th>Level</th>
                <th className="num">Earned</th><th className="num">Paid out</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seller_name}>
                  <td className="cellMain">{r.seller_name}</td>
                  <td>{r.level ? <Chip tone="mut">{r.level}</Chip> : "—"}</td>
                  <td className="num">{fmtRM(r.earned)}</td>
                  <td className="num">{fmtRM(r.paid)}</td>
                  <td className="num"><b>{fmtRM(r.balance)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="footNote">
        Earned &amp; paid reflect the uploaded Wallet period only; balance is
        period-scoped, not the all-time wallet balance. Full tally against orders
        arrives once finance confirms the payment source.
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Dicci Impact · People</div>
        <h1>Commission</h1>
        <div className="pageSub">Stockist commission from Fighter Wallet, level included.</div>
      </div>
    </div>
  );
}
