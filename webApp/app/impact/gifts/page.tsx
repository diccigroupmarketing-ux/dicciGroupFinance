import { skuGiftsList, giftCostSummary } from "@/lib/recon";
import { fmtInt, fmtRM } from "@/lib/format";
import GiftEditor from "@/components/GiftEditor";

export const dynamic = "force-dynamic";

export default async function GiftsPage() {
  const [skus, summary] = await Promise.all([skuGiftsList(), giftCostSummary()]);
  const maxCost = Math.max(1, ...summary.byGiftType.map((g) => g.cost));

  return (
    <>
      <div className="pageHead">
        <div>
          <div className="eyebrow">Dicci Impact · People</div>
          <h1>Free gifts</h1>
          <div className="pageSub">
            Free gift cost per SKU, auto-applied to every order that includes the SKU.
            Finance maps the gifts (click Edit), the system totals the cost.
          </div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="kpiLabel">Giveaway cost · confirmed</div>
          <div className="kpiValue"><small>RM</small> {fmtRM(summary.confirmedCost).replace("RM ", "")}</div>
          <div className="kpiNote">gifts on paid-confirmed orders</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">On returned / unpaid</div>
          <div className="kpiValue"><small>RM</small> {fmtRM(summary.atRiskCost).replace("RM ", "")}</div>
          <div className="kpiNote">
            {summary.atRiskCost > 0
              ? <span style={{ color: "var(--danText)", fontWeight: 700 }}>potential leak</span>
              : "clean"} · gift given, money not confirmed
          </div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">SKUs with gifts</div>
          <div className="kpiValue">{fmtInt(summary.skusWithGifts)} <small>/ {fmtInt(summary.skuCount)}</small></div>
          <div className="kpiNote">mapped SKUs</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Gift types</div>
          <div className="kpiValue">{fmtInt(summary.giftTypes)}</div>
          <div className="kpiNote">{fmtInt(summary.giftsGiven)} units given (confirmed)</div>
        </div>
      </div>

      <GiftEditor initial={skus} />

      {summary.byGiftType.length > 0 && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Cost by gift type</div>
              <div className="cardHint">confirmed orders</div>
            </div>
            {summary.byGiftType.map((g) => (
              <div className="breakRow" key={g.gift_name}>
                <div className="breakName">{g.gift_name}</div>
                <div className="breakTrack">
                  <div className="breakFill" style={{ width: `${Math.max(4, (g.cost / maxCost) * 100)}%` }} />
                </div>
                <div className="breakN">RM {fmtInt(Math.round(g.cost))}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="footNote">
        Cost = unit cost × gift qty per SKU × order quantity, counted once payment is
        confirmed. Gifts on returned or unpaid orders are flagged as potential leak.
      </div>
    </>
  );
}
