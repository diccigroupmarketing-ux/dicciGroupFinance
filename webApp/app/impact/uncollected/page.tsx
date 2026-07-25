import Link from "next/link";
import {
  COURIERS, PREPAID, REMIT_PENDING_DAYS, StreamKey, PrepaidKey,
  uncollectedCourier, ghostPrepaid, storeCounts, lastIngest, reconTodayYmd,
  type UncollectedStream,
} from "@/lib/recon";
import { fmtDate, fmtInt, fmtRM } from "@/lib/format";
import AgingControl from "@/components/AgingControl";
import InfoTip from "@/components/InfoTip";
import NotCollectedTable from "@/components/NotCollectedTable";
import GhostTable from "@/components/GhostTable";

export const dynamic = "force-dynamic";

// Ambang aging sama macam stream page (3..45, lalai REMIT_PENDING_DAYS=14) supaya
// SATU sumber kebenaran, angka overdue tak bercanggah dashboard.
function parsePending(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return REMIT_PENDING_DAYS;
  return Math.min(45, Math.max(3, Math.trunc(n)));
}

function parseTab(v: string | undefined): "chase" | "ghost" {
  return v === "ghost" ? "ghost" : "chase";
}

export default async function UncollectedPage(
  { searchParams }: { searchParams: Promise<{ tab?: string; pending?: string }> },
) {
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const pending = parsePending(sp.pending);

  const counts = await storeCounts();
  if (counts.orders === 0) {
    return (
      <>
        <Header />
        <div className="emptyCard">
          <div className="big">No data uploaded yet</div>
          Upload a Fighter export and courier bills first. This page then shows
          which orders are still waiting for money and which money has no order.
        </div>
      </>
    );
  }

  // Iterasi kurier + gateway secara DINAMIK dari config (tambah kurier = auto
  // masuk, sifar perubahan di sini). Kurier menyumbang overdue/awaiting + ghost;
  // gateway prepaid menyumbang ghost sahaja (tiada aging).
  const courierKeys = Object.keys(COURIERS) as StreamKey[];
  const prepaidKeys = Object.keys(PREPAID) as PrepaidKey[];
  const [asOf, courierStreams, prepaidStreams] = await Promise.all([
    lastIngest(),
    Promise.all(courierKeys.map((k) => uncollectedCourier(k, pending))),
    Promise.all(prepaidKeys.map((k) => ghostPrepaid(k))),
  ]);
  const allGhostStreams: UncollectedStream[] = [...courierStreams, ...prepaidStreams];

  const asOfDate = reconTodayYmd();

  // Tab 1: overdue + awaiting (kurier sahaja).
  const overdueRows = courierStreams.flatMap((s) => s.overdueRows);
  const awaitingRows = courierStreams.flatMap((s) => s.awaitingRows);
  const overdueTotalN = courierStreams.reduce((a, s) => a + s.overdueN, 0);
  const awaitingTotalN = courierStreams.reduce((a, s) => a + s.awaitingN, 0);
  const awaitingValue = courierStreams.reduce((a, s) => a + s.awaitingValue, 0);
  const courierLabels = courierStreams.map((s) => s.courier);

  // Tab 2: ghost (kurier + gateway).
  const ghostRows = allGhostStreams.flatMap((s) => s.ghostRows);
  const ghostTotalN = allGhostStreams.reduce((a, s) => a + s.ghostN, 0);
  const ghostValue = allGhostStreams.reduce((a, s) => a + s.ghostValue, 0);
  const ghostLabels = allGhostStreams.filter((s) => s.ghostN > 0).map((s) => s.courier);

  return (
    <>
      <Header asOf={asOf} asOfDate={asOfDate} />

      <div className="cauPanel" style={{ marginBottom: 14 }}>
        <div>
          <b>Aging is relative to the bills uploaded so far.</b>
          <p>An overdue order may just mean its courier bill has not been uploaded yet,
            not that money is missing. This page is read-only: use it to see what to
            chase, no editing.</p>
        </div>
      </div>

      <div className="segRow" role="tablist" aria-label="View" style={{ marginBottom: 14 }}>
        <Link role="tab" aria-selected={tab === "chase"}
          className={"segBtn" + (tab === "chase" ? " active" : "")}
          href={`/impact/uncollected?tab=chase&pending=${pending}`}>
          Not collected
        </Link>
        <Link role="tab" aria-selected={tab === "ghost"}
          className={"segBtn" + (tab === "ghost" ? " active" : "")}
          href={`/impact/uncollected?tab=ghost&pending=${pending}`}>
          Ghost money
        </Link>
      </div>

      {tab === "chase" ? (
        <>
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Overdue by courier
                <InfoTip text="Completed orders past the aging threshold with no matching bill, counted per courier. Each courier is shown on its own, not blended into one figure." />
              </div>
              <div className="cardHint">expected from orders · past {pending} days, no bill</div>
              <AgingControl pending={pending} basePath="/impact/uncollected" extraQuery="tab=chase" />
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Courier</th>
                    <th className="num">Overdue orders</th>
                    <th className="num">Expected from orders</th>
                  </tr>
                </thead>
                <tbody>
                  {courierStreams.map((s) => (
                    <tr key={s.streamKey}>
                      <td className="cellMain">{s.courier}</td>
                      <td className="num">{s.overdueN > 0 ? fmtInt(s.overdueN) : "—"}</td>
                      <td className="num">{s.overdueValue > 0 ? fmtRM(s.overdueValue) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="rowMuted">
                    <td className="cellMain">Awaiting remit (normal)</td>
                    <td className="num">{fmtInt(awaitingTotalN)}</td>
                    <td className="num">{awaitingValue > 0 ? fmtRM(awaitingValue) : "—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="cardHint" style={{ marginTop: 8 }}>
              Overdue and awaiting remit are kept separate on purpose. Awaiting remit is
              normal until the bill lands, so it is not added into an outstanding total.
            </div>
          </div>

          <div className="sectionGap" />

          {overdueTotalN === 0 && awaitingTotalN === 0 ? (
            <div className="posPanel">
              <div><b>Nothing outstanding.</b>
                <p>Every completed order on an active courier is matched to a bill.</p></div>
            </div>
          ) : (
            <NotCollectedTable
              overdue={overdueRows} awaiting={awaitingRows}
              couriers={courierLabels}
              overdueTotalN={overdueTotalN} awaitingTotalN={awaitingTotalN} />
          )}
        </>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="cardHead">
              <div className="cardTitle">Ghost money total</div>
              <div className="cardHint">received from bills with no matching order</div>
            </div>
            <div className="kpiValue" style={{ marginTop: 6 }}>
              <small>RM</small> {fmtRM(ghostValue).replace("RM ", "")}
            </div>
            <div className="kpiNote">
              {fmtInt(ghostTotalN)} line{ghostTotalN === 1 ? "" : "s"} across active streams
            </div>
          </div>

          <GhostTable rows={ghostRows} totalN={ghostTotalN} couriers={ghostLabels} />
        </>
      )}

      <div className="footNote">
        Categories come straight from the proven reconciliation engine
        <span className="sep">·</span> aging as of {fmtDate(asOfDate)} (KL time)
        <span className="sep">·</span>
        <Link href="/impact" style={{ color: "var(--goldDark)", fontWeight: 700 }}>← Back to overview</Link>
      </div>
    </>
  );
}

function Header({
  asOf, asOfDate,
}: {
  asOf?: string | null; asOfDate?: string;
}) {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Dicci Impact · Chase the money
          <InfoTip text="One place, across every courier, to see orders whose money has not arrived, and money that arrived with no order. Read-only: it shows what to chase, it does not change anything." />
        </div>
        <h1>Not collected</h1>
        <div className="pageSub">
          See what to chase, no editing. Orders still waiting for money, and money
          received with no matching order.
        </div>
      </div>
      <div className="headActions">
        <div className="periodPill" title={asOf ? `Last upload ${asOf}` : undefined}>
          <span className="cal">◷</span>
          {asOfDate ? `As of ${fmtDate(asOfDate)} (KL)` : "All uploaded data"}
        </div>
      </div>
    </div>
  );
}
