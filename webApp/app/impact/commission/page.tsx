import { commissionSummary } from "@/lib/recon";
import { fmtInt, fmtRM } from "@/lib/format";
import CommissionTable from "@/components/CommissionTable";
import InfoTip from "@/components/InfoTip";

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
          <div className="heroLabel">Commission earned · uploaded period
            <InfoTip text="Commission is what stockists earn on their sales, taken straight from the Fighter Wallet export. These figures cover only the period of the file you uploaded, not their all-time total." />
          </div>
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

      <CommissionTable rows={rows} />

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
