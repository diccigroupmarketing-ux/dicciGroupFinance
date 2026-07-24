import { COURIERS, StreamKey, streamSummary, storeCounts, lastIngest, giftCostSummary, paymentBuckets } from "@/lib/recon";
import { fmtDate, fmtInt, fmtRM, GRAIN_LABEL, groupByGrain, parseGrain } from "@/lib/format";
import { Chip } from "@/components/Chip";
import GrainSwitcher from "@/components/GrainSwitcher";
import WeeklyChart from "@/components/WeeklyChart";
import PaymentBuckets from "@/components/PaymentBuckets";
import InfoTip from "@/components/InfoTip";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ACTIVE: StreamKey[] = ["jnt", "dhl", "ninja"];

export default async function Dashboard(
  { searchParams }: { searchParams: Promise<{ grain?: string }> },
) {
  const grain = parseGrain((await searchParams).grain);
  const [counts, asOf, gift, buckets] = await Promise.all([
    storeCounts(), lastIngest(), giftCostSummary(), paymentBuckets(),
  ]);

  if (counts.orders === 0) {
    return (
      <>
        <Header />
        <div className="emptyCard">
          <div className="big">No data yet</div>
          Upload a Fighter export and courier bills to see the money story.
          Use the <b>Upload data</b> button in the sidebar to bring in your first files.
        </div>
      </>
    );
  }

  const summaries = await Promise.all(ACTIVE.map((k) => streamSummary(k)));
  const rows = ACTIVE.map((k, i) => {
    const s = summaries[i];
    return {
      key: k, name: COURIERS[k].name,
      collected: s.linesCod, fee: s.linesFee,
      net: Math.round((s.linesCod - s.linesFee) * 100) / 100,
      parcels: s.linesN, exc: s.integN,
      hasBills: s.bills.length > 0,
    };
  });

  const totNet = rows.reduce((a, r) => a + r.net, 0);
  const totParcels = rows.reduce((a, r) => a + r.parcels, 0);
  const totExc = rows.reduce((a, r) => a + r.exc, 0);
  const totCollected = rows.reduce((a, r) => a + r.collected, 0);
  const totFee = rows.reduce((a, r) => a + r.fee, 0);
  const withMoney = rows.filter((r) => r.parcels > 0).length;

  const totBottles = summaries.reduce(
    (a, s) => a + s.daily.reduce((x, d) => x + d.botol, 0), 0);

  const weekly = groupByGrain(summaries.flatMap((s) => s.daily), grain);

  const [rm, cents] = fmtRM(totNet).split(".");

  return (
    <>
      <Header asOf={asOf} />
      <div className="hero">
        <div className="heroTop">
          <div className="heroLabel">Net remit · All streams
            <InfoTip text="The money we expect to land in the bank after the courier takes its delivery fee out of what the customer paid (COD collected minus courier fee)." />
          </div>
          {totExc === 0 ? (
            <div className="heroChip"><span className="dot" /> Clean books</div>
          ) : (
            <div className="heroChip warn"><span className="dot" /> {totExc} exceptions to investigate</div>
          )}
        </div>
        <div className="heroFigure">
          <small>RM</small>{rm.replace("RM ", "")}<span className="cents">.{cents}</span>
        </div>
        <div className="heroSub">
          <b>{fmtInt(totParcels)} parcels</b> across <b>{withMoney} courier{withMoney === 1 ? "" : "s"}</b> · expected to land in bank after courier fees
          {gift.confirmedCost > 0 && (
            <> · giveaway cost <b>{fmtRM(gift.confirmedCost)}</b>
              {gift.atRiskCost > 0 && (
                <span style={{ color: "#EFB8B0" }}> (+{fmtRM(gift.atRiskCost)} at risk)</span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="kpiLabel">COD collected
            <InfoTip text="COD means Cash On Delivery: the customer pays the courier when the parcel arrives. This is the total cash the courier collected on our behalf." />
          </div>
          <div className="kpiValue"><small>RM</small> {fmtRM(totCollected).replace("RM ", "")}</div>
          <div className="kpiNote">across all settled bills</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Courier fees
            <InfoTip text="What the courier charges to deliver and to collect the cash. It is taken out of the COD before the rest is sent to us." />
          </div>
          <div className="kpiValue"><small>RM</small> {fmtRM(totFee).replace("RM ", "")}</div>
          <div className="kpiNote">{totCollected > 0 ? ((totFee / totCollected) * 100).toFixed(2) + "% of COD collected" : "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Parcels settled
            <InfoTip text="Parcels that now appear on a courier bill, so we know the money for them has been accounted for. One parcel is one delivery." />
          </div>
          <div className="kpiValue">{fmtInt(totParcels)}</div>
          <div className="kpiNote">{fmtInt(counts.orders)} orders in store</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Bottles confirmed
            <InfoTip text="How many bottles we can count as truly sold, because the money for their order has been confirmed. Orders still waiting for payment are not counted here." />
          </div>
          <div className="kpiValue">{fmtInt(totBottles)}</div>
          <div className="kpiNote">counted once money is confirmed</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="cardHead">
            <div className="cardTitle">Net remit by {GRAIN_LABEL[grain]}</div>
            <div className="cardHint">delivery-signature date · all streams</div>
            <GrainSwitcher grain={grain} basePath="/impact" />
          </div>
          {weekly.length ? (
            <>
              <WeeklyChart bars={weekly} />
              <div className="cardHint" style={{ marginTop: 10 }}>
                {weekly.length} settled {GRAIN_LABEL[grain]}{weekly.length === 1 ? "" : "s"} · {fmtRM(totNet)} total net remit · hover a bar for detail
              </div>
            </>
          ) : (
            <div className="cardHint" style={{ padding: "30px 0" }}>
              No settled bills yet. The trend appears once courier bills are uploaded.
            </div>
          )}
        </div>

        <div className="card">
          <div className="cardHead">
            <div className="cardTitle">Income streams</div>
            <div className="cardHint">money in, by source</div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>Stream</th><th className="num">Net remit</th><th>Status
                  <InfoTip text="Clean means every settled parcel matches a Fighter order at the exact amount. Exceptions are rows that do not match and need a person to check them." />
                </th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <Link href={`/impact/streams/${r.key}`}>
                        <div className="cellMain">{r.name}</div>
                        <div className="cellSub">
                          {r.parcels > 0
                            ? `${fmtInt(r.parcels)} parcels · fee ${fmtRM(r.fee)}`
                            : "connected · no bill this period"}
                        </div>
                      </Link>
                    </td>
                    <td className="num">{r.net > 0 ? <b>{fmtRM(r.net)}</b> : fmtRM(0)}</td>
                    <td>
                      {r.exc > 0 ? <Chip tone="dan">{r.exc} exceptions</Chip>
                        : r.parcels > 0 ? <Chip tone="pos">Clean</Chip>
                        : <Chip tone="cau">Awaiting bill</Chip>}
                    </td>
                  </tr>
                ))}
                <tr className="rowMuted">
                  <td><div className="cellMain">CHIP · Transfer · TikTok</div><div className="cellSub">next phase</div></td>
                  <td className="num">—</td>
                  <td><Chip tone="mut">Not connected</Chip></td>
                </tr>
                <tr className="totalRow">
                  <td>Total expected in bank</td>
                  <td className="num">{fmtRM(totNet)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          {totExc === 0 ? (
            <div className="posPanel">
              <CheckIcon />
              <div><b>No integrity exceptions.</b>
                <p>Every settled parcel matches a Fighter order at the exact amount.</p></div>
            </div>
          ) : (
            <div className="danPanel">
              <WarnIcon />
              <div><b>{totExc} integrity exceptions.</b>
                <p>Open the affected stream to investigate ghost money or amount mismatches.</p></div>
            </div>
          )}
        </div>
      </div>

      <PaymentBuckets buckets={buckets} title="Payment confirmation · all Completed orders" showBottles />

      <div className="footNote">
        Data: Neon Postgres <span className="sep">·</span> reconciliation runs in SQL
        <span className="sep">·</span> aging reference 18 Jun 2026
      </div>
    </>
  );
}

function Header({ asOf }: { asOf?: string | null }) {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Dicci Impact · Income reconciliation</div>
        <h1>Income overview</h1>
        <div className="pageSub">Every ringgit in, matched against Fighter orders.</div>
      </div>
      <div className="headActions">
        <div className="periodPill" title={asOf ? `Last upload ${asOf}` : undefined}>
          <span className="cal">◷</span>
          {asOf ? `Data as of ${fmtDate(asOf)}` : "All uploaded data"}
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="10" cy="10" r="8" /><path d="m6.5 10.5 2.3 2.3L13.5 8" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 3.5 18 16.5H2z" /><path d="M10 8.8v3.4M10 14.6v.2" />
    </svg>
  );
}
