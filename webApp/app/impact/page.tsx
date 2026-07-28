import {
  COURIERS, REMIT_PENDING_DAYS, StreamKey, streamSummary, storeCounts, lastIngest,
  giftCostSummary, paymentBuckets, reconTodayYmd,
  type GiftCostSummary, type StreamSummary,
} from "@/lib/recon";
import { streamSummaryRanged } from "@/lib/streamRange";
import {
  giftCostRanged, paymentBucketsRanged, rollupStreams, type RangedPayBuckets,
} from "@/lib/dashboardRange";
import { isAllTime, parseDateRange, presetRanges } from "@/lib/dateRange";
import { fmtDate, fmtInt, fmtRM, GRAIN_LABEL, groupByGrain, parseGrain } from "@/lib/format";
import { Chip } from "@/components/Chip";
import GrainSwitcher from "@/components/GrainSwitcher";
import WeeklyChart from "@/components/WeeklyChart";
import PaymentBuckets from "@/components/PaymentBuckets";
import DateRangeFilter from "@/components/DateRangeFilter";
import InfoTip from "@/components/InfoTip";
import { decorate } from "@/lib/resolutions";
import { contextsFor, pendingApprovals, sumAggregates } from "@/components/resolveServer";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ACTIVE: StreamKey[] = ["jnt", "dhl", "ninja"];

export default async function Dashboard(
  { searchParams }: {
    searchParams: Promise<{ grain?: string; from?: string; to?: string }>;
  },
) {
  const sp = await searchParams;
  const grain = parseGrain(sp.grain);
  // Julat tarikh ORDER, peraturan sama macam page stream. Tiada param = All time
  // = laluan enjin lama yang di-cache, angka identik macam sebelum ciri ni wujud.
  const range = parseDateRange(sp);
  const scoped = !isAllTime(range);
  const presets = presetRanges(reconTodayYmd());
  // Param lain yang WAJIB dikekalkan bila julat ditukar (dan sebaliknya).
  const keep = { grain: grain === "weekly" ? undefined : grain };

  const [counts, asOf] = await Promise.all([storeCounts(), lastIngest()]);

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

  // Bertapis = lapisan read-only atas tmp_m yang SAMA (lib/streamRange +
  // lib/dashboardRange). Tiada julat = fungsi enjin lama, sifar perubahan.
  const summaryOf = (k: StreamKey): Promise<StreamSummary & { undatedRows: number }> =>
    scoped
      ? streamSummaryRanged(k, REMIT_PENDING_DAYS, range)
      : streamSummary(k).then((x) => ({ ...x, undatedRows: 0 }));
  const giftP: Promise<GiftCostSummary> = scoped ? giftCostRanged(range) : giftCostSummary();
  const bucketsP: Promise<RangedPayBuckets> = scoped
    ? paymentBucketsRanged(range)
    : paymentBuckets().then((b) => ({
        buckets: b, totalOrders: 0, filteredOrders: 0, undatedOrders: 0,
      }));

  const [rawSummaries, gift, pay, ctxs, waiting] = await Promise.all([
    Promise.all(ACTIVE.map(summaryOf)), giftP, bucketsP,
    contextsFor(ACTIVE, reconTodayYmd(), REMIT_PENDING_DAYS),
    pendingApprovals(),
  ]);

  // TITIK CANTUM lapisan Resolution untuk dashboard. decorate() hanya MENAMBAH
  // medan, jadi rollupStreams di bawah membaca angka duit yang sama persis.
  const summaries = rawSummaries.map((s, i) => decorate(s, ctxs[i]));
  const res = sumAggregates(summaries.map((s) => s.resolutionSummary));

  // Roll-up = fungsi TULEN yang dipakai oleh KEDUA dua mod, jadi All time memang
  // matematik yang sama macam dulu (lihat scripts/testDateRange.ts bahagian C).
  const roll = rollupStreams(ACTIVE.map((k, i) => ({
    key: k, name: COURIERS[k].name, summary: summaries[i],
  })));
  const { rows, totNet, totParcels, totExc, totCollected, totFee, withMoney, totBottles } = roll;
  const buckets = pay.buckets;
  // Item tanpa tarikh order (baris bil tanpa order + order tanpa tarikh dalam
  // feed): tak pernah disorok, dikira supaya nota jujur boleh sebut jumlahnya.
  const undated = roll.undatedRows + pay.undatedOrders;

  const weekly = groupByGrain(roll.daily, grain);

  const [rm, cents] = fmtRM(totNet).split(".");

  return (
    <>
      <Header asOf={asOf} />

      <DateRangeFilter basePath="/impact" range={range} presets={presets}
        keep={keep} undatedRows={undated} />

      {scoped && (
        <div className="cauPanel" style={{ marginBottom: 14 }}>
          <WarnIcon />
          <div><b>Every figure on this page covers only the orders placed inside
            the selected range.</b>
            <p>A courier bill can carry parcels from several months, so these
              amounts can be smaller than the full bills, and smaller than what
              landed in the bank. Switch to All time to reconcile against the bank.</p>
          </div>
        </div>
      )}

      <div className="hero">
        <div className="heroTop">
          <div className="heroLabel">Net remit · All streams{scoped ? " · selected range" : ""}
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
          <div className="kpiNote">
            {scoped ? "settled bills, orders in range only" : "across all settled bills"}
          </div>
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
          <div className="kpiNote">
            {fmtInt(counts.orders)} orders in store{scoped ? ", all time" : ""}
          </div>
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
            <GrainSwitcher grain={grain} basePath="/impact"
              extra={{ from: range.from, to: range.to }} />
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
              {scoped
                ? "No settled parcel belongs to an order placed in this range. Widen the range to see the trend."
                : "No settled bills yet. The trend appears once courier bills are uploaded."}
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

          {/* Baris KECIL di bawah angka mentah. Angka besar di atas tak pernah
              ditukar jadi versi "adjusted". */}
          {(res.loaded && (res.settledN > 0 || res.snoozedN > 0)) && (
            <div className="resolveStrip">
              <span className="resolveStat pos">{fmtInt(res.settledN)} settled</span>
              <span className="sep">·</span>
              <span className="resolveStat cau">{fmtInt(res.snoozedN)} snoozed</span>
              <span className="sep">·</span>
              <span className="resolveStat">{fmtInt(res.openN)} still open</span>
              <div className="resolveStripNote">
                Across the full streams, not the selected date range. Settling records
                a decision, it never moves money.
              </div>
            </div>
          )}
          {waiting.n > 0 && (
            <div className="resolveStrip">
              <span className="resolveStat">
                Awaiting approval: <b>{fmtInt(waiting.n)}</b> · <b>{fmtRM(waiting.value)}</b>
              </span>
              <Link href="/impact/review?tab=approvals" className="cardLink">
                Open Review
              </Link>
            </div>
          )}
        </div>
      </div>

      <PaymentBuckets buckets={buckets} showBottles
        title={scoped
          ? "Payment confirmation · Completed orders in range"
          : "Payment confirmation · all Completed orders"} />

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
