// ====================================================================
// Page "Review" , satu tempat kerja untuk lapisan Resolution.
//
// TIGA tab (corak segRow sama dengan page Not collected):
//   Open               , semua baris boleh-settle merentas SEMUA stream
//   Awaiting approval  , maker checker
//   Settled & snoozed  , sejarah + rollup ikut sebab
//
// PRINSIP PAPARAN YANG PAGE NI PEGANG:
//   1. Angka MENTAH kekal tajuk. Kad atas papar kiraan exception sebenar enjin,
//      dan barulah di bawahnya baris kecil settled/snoozed/open.
//   2. Baris settled tak hilang, ia kelabu (lihat ReviewOpen).
//   3. Snoozed BUKAN settled: label + warna berbeza, sentiasa dengan tarikh.
//   4. Kiraan resolution ikut STREAM PENUH (scope 'streamAllTime'), bukan
//      tetingkap penapis tarikh. Itu dicetak terus pada skrin.
//
// Enjin recon TIDAK disentuh. Semua yang page ni buat ialah membaca output recon
// sedia ada dan melapisi keadaan keputusan manusia di atasnya.
// ====================================================================
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import {
  COURIERS, KAT_LABEL, PREPAID, REMIT_PENDING_DAYS, PrepaidKey, StreamKey,
  reconTodayYmd, storeCounts, streamPrepaidSummary, streamSummary,
  uncollectedCourier,
} from "@/lib/recon";
import { isAdmin } from "@/lib/mutations";
import {
  decorate, getResolutions, reasonMeta, resolutionContext,
  type ReasonCode, type ResolutionAggregate,
} from "@/lib/resolutions";
import { fmtInt, fmtRM } from "@/lib/format";
import InfoTip from "@/components/InfoTip";
import ReviewOpen from "@/components/ReviewOpen";
import ReviewApprovals from "@/components/ReviewApprovals";
import ReviewSettled from "@/components/ReviewSettled";
import {
  casesUI, excFromNotCollected, reasonOptionsUI, resolveLimits,
  sumAggregates, targetsFrom, withBadges,
} from "@/components/resolveServer";
import type { ResolveTarget } from "@/components/resolveTypes";

export const dynamic = "force-dynamic";

type Tab = "open" | "approvals" | "settled";

function parseTab(v: string | undefined): Tab {
  return v === "approvals" || v === "settled" ? v : "open";
}

const katLabel = (k: string) => KAT_LABEL[k] ?? k;

export default async function ReviewPage(
  { searchParams }: { searchParams: Promise<{ tab?: string }> },
) {
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const todayYmd = reconTodayYmd();

  const [user, counts] = await Promise.all([currentUser(), storeCounts()]);
  const actor = user?.primaryEmailAddress?.emailAddress ?? "unknown";
  const limits = resolveLimits(isAdmin(actor), todayYmd, actor);
  const reasons = reasonOptionsUI();

  if (counts.orders === 0) {
    return (
      <>
        <Header />
        <div className="emptyCard">
          <div className="big">No data uploaded yet</div>
          Upload a Fighter export and courier bills first. Rows to review appear the
          moment the reconciliation engine flags something.
        </div>
      </>
    );
  }

  const courierKeys = Object.keys(COURIERS) as StreamKey[];
  const prepaidKeys = Object.keys(PREPAID) as PrepaidKey[];
  const streamKeys: string[] = [...courierKeys, ...prepaidKeys];

  // Satu konteks resolution per stream. Ia MURAH selagi tiada kes hidup
  // (backbone hanya menyentuh enjin bila memang ada kes).
  const ctxs = await Promise.all(
    streamKeys.map((k) => resolutionContext(k, todayYmd, REMIT_PENDING_DAYS)));
  const ctxOf = new Map(streamKeys.map((k, i) => [k, ctxs[i]]));

  // Baris "perlu manusia": integrity + overdue, terus dari output enjin.
  const courierSummaries = await Promise.all(
    courierKeys.map((k) => streamSummary(k, REMIT_PENDING_DAYS)));
  const prepaidSummaries = await Promise.all(
    prepaidKeys.map((k) => streamPrepaidSummary(k)));

  // Baris "awaiting" (belum_remit): normal, tapi backbone membenarkan ia
  // di-snooze, jadi ia ada di sini di belakang penapis baldi.
  const awaiting = await Promise.all(
    courierKeys.map((k) => uncollectedCourier(k, REMIT_PENDING_DAYS)));

  const rows: ResolveTarget[] = [];
  const aggs: ResolutionAggregate[] = [];

  courierKeys.forEach((k, i) => {
    const ctx = ctxOf.get(k)!;
    const d = decorate(courierSummaries[i], ctx);
    aggs.push(d.resolutionSummary);
    rows.push(...targetsFrom([...d.integ, ...d.aged], k, COURIERS[k].name, katLabel));

    // Awaiting: bentuknya bukan ExcRow, jadi ia dilalukan laluan lencana yang
    // SAMA lewat excFromNotCollected + withBadges (tiada logik kedua).
    const exc = withBadges(excFromNotCollected(awaiting[i].awaitingRows), ctx);
    rows.push(...targetsFrom(exc, k, COURIERS[k].name, katLabel));
  });

  prepaidKeys.forEach((k, i) => {
    const ctx = ctxOf.get(k)!;
    const d = decorate(prepaidSummaries[i], ctx);
    aggs.push(d.resolutionSummary);
    rows.push(...targetsFrom([...d.integ, ...d.aged], k, PREPAID[k].name, katLabel));
  });

  const agg = sumAggregates(aggs);
  const listedValue = rows.reduce((a, r) => a + r.value, 0);

  // Kes hidup (proposed + approved) untuk tab 2 dan 3.
  const live = await getResolutions();
  const cases = casesUI(live, actor,
    (code) => reasonMeta(code as ReasonCode)?.label ?? code,
    (code) => reasonMeta(code as ReasonCode)?.snooze ?? false);
  const waiting = cases.filter((c) => c.state === "proposed");
  const decided = cases.filter((c) => c.state === "approved");

  const streams = [
    ...courierKeys.map((k) => ({ key: k as string, name: COURIERS[k].name })),
    ...prepaidKeys.map((k) => ({ key: k as string, name: PREPAID[k].name })),
  ];

  const tabHref = (t: Tab) => `/impact/review?tab=${t}`;

  return (
    <>
      <Header />

      {/* Kad ringkasan: angka MENTAH di atas, keadaan resolution kecil di bawah.
          Bila belum ada satu kes pun, backbone SENGAJA tak menyentuh enjin, jadi
          agg.exceptionN belum bermakna , kita papar apa yang betul betul kita
          tahu (baris yang disenaraikan) dan bukan sifar yang mengelirukan. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="cardHead">
          <div className="cardTitle">
            {agg.loaded
              ? `${fmtInt(agg.exceptionN)} row${agg.exceptionN === 1 ? "" : "s"} the `
                + `engine can settle, worth ${fmtRM(agg.exceptionValue)}`
              : `${fmtInt(rows.length)} row${rows.length === 1 ? "" : "s"} to review, `
                + `worth ${fmtRM(listedValue)}`}
            <InfoTip text="The raw count straight from the reconciliation engine. Settling a row never changes this figure: it records why a row is closed, it does not move money." />
          </div>
        </div>
        {agg.loaded ? (
          <div className="resolveStrip">
            <span className="resolveStat pos">{fmtInt(agg.settledN)} settled</span>
            <span className="sep">·</span>
            <span className="resolveStat cau">{fmtInt(agg.snoozedN)} snoozed</span>
            <span className="sep">·</span>
            <span className="resolveStat">{fmtInt(agg.openN)} still open</span>
            {agg.proposedN > 0 && (
              <>
                <span className="sep">·</span>
                <span className="resolveStat">{fmtInt(agg.proposedN)} awaiting approval</span>
              </>
            )}
            {agg.staleN > 0 && (
              <>
                <span className="sep">·</span>
                <span className="resolveStat dan">{fmtInt(agg.staleN)} reopened, figures changed</span>
              </>
            )}
            {agg.expiredN > 0 && (
              <>
                <span className="sep">·</span>
                <span className="resolveStat dan">{fmtInt(agg.expiredN)} snooze expired</span>
              </>
            )}
          </div>
        ) : (
          <div className="resolveStrip">
            <span className="resolveStat">Nothing settled or snoozed yet</span>
          </div>
        )}
        <div className="cardHint" style={{ marginTop: 8 }}>
          Snoozed is not settled. A snooze parks a row until a date: the row stays in
          its bucket and the money figures do not move.
          {agg.loaded && (
            <> These resolution counts cover each stream in full, not a date range,
              and they include CHIP rows still awaiting payment, which the table
              below does not list yet ({fmtInt(rows.length)} rows listed).</>
          )}
        </div>
      </div>

      <div className="segRow" role="tablist" aria-label="View" style={{ marginBottom: 14 }}>
        <Link role="tab" aria-selected={tab === "open"}
          className={"segBtn" + (tab === "open" ? " active" : "")}
          href={tabHref("open")}>Open</Link>
        <Link role="tab" aria-selected={tab === "approvals"}
          className={"segBtn" + (tab === "approvals" ? " active" : "")}
          href={tabHref("approvals")}>
          Awaiting approval{waiting.length > 0 ? ` (${fmtInt(waiting.length)})` : ""}
        </Link>
        <Link role="tab" aria-selected={tab === "settled"}
          className={"segBtn" + (tab === "settled" ? " active" : "")}
          href={tabHref("settled")}>Settled &amp; snoozed</Link>
      </div>

      {tab === "open" && (
        <ReviewOpen rows={rows} reasons={reasons} limits={limits} streams={streams} />
      )}
      {tab === "approvals" && (
        <ReviewApprovals cases={waiting} limits={limits} />
      )}
      {tab === "settled" && (
        <ReviewSettled cases={decided} limits={limits} />
      )}

      <div className="footNote">
        Categories and figures come straight from the proven reconciliation engine
        <span className="sep">·</span>
        a resolution records a decision, it never moves money
        <span className="sep">·</span>
        CHIP rows still awaiting payment are not listed in Open yet
        <span className="sep">·</span>
        <Link href="/impact" style={{ color: "var(--goldDark)", fontWeight: 700 }}>← Back to overview</Link>
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Dicci Impact · Close the loop
          <InfoTip text="Review is where a person records WHY an exception can be closed: a fee was deducted, a bill has not been uploaded yet, the money belongs to another company. Every decision needs a second person to approve it, and none of it moves a single ringgit." />
        </div>
        <h1>Review</h1>
        <div className="pageSub">
          Record why a row can be closed, and approve what somebody else recorded.
          Settling changes status only: totals, buckets and variance stay untouched.
        </div>
      </div>
    </div>
  );
}
