import { notFound } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import {
  AGED, COURIERS, INTEGRITY_EXC, KAT_LABEL, PREPAID, REMIT_PENDING_DAYS,
  PrepaidKey, StreamKey, streamSummary, streamPrepaidSummary,
  storeCounts, lastIngest, reconTodayYmd, type ExcRow, type StreamSummary,
} from "@/lib/recon";
import { streamSummaryRanged, streamPrepaidSummaryRanged } from "@/lib/streamRange";
import {
  isAllTime, parseDateRange, presetRanges, streamQuery,
  type DateRange, type RangePresets,
} from "@/lib/dateRange";
import {
  fmtDate, fmtInt, fmtRM, type Grain, GRAIN_LABEL, groupByGrain, parseGrain,
  trackingOrDash,
} from "@/lib/format";
import AmountCell from "@/components/AmountCell";
import { KatChip, katTone } from "@/components/Chip";
import GrainSwitcher from "@/components/GrainSwitcher";
import WeeklyChart from "@/components/WeeklyChart";
import BillsTable, { type BillRow } from "@/components/BillsTable";
import ExportCsv from "@/components/ExportCsv";
import AgingControl from "@/components/AgingControl";
import DateRangeFilter from "@/components/DateRangeFilter";
import InfoTip from "@/components/InfoTip";
import ExceptionsTable from "@/components/ExceptionsTable";
import { getBankDeposits } from "@/lib/bank";
import { isAdmin } from "@/lib/mutations";
import {
  decorate, resolutionContext, type ResolutionAggregate,
} from "@/lib/resolutions";
import { reasonOptionsUI, resolveLimits, targetsFrom } from "@/components/resolveServer";

// Ambang aging: 3..45 (padan slider Streamlit), default REMIT_PENDING_DAYS (14).
function parsePending(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return REMIT_PENDING_DAYS;
  return Math.min(45, Math.max(3, Math.trunc(n)));
}

// Baris exception -> baris rata untuk CSV (finance kerja dalam Excel).
function excToCsv(rows: ExcRow[]) {
  return rows.map((r) => ({
    order_id: r.order_id, stockist: r.seller_name,
    tracking: r.tracking ?? r.awb, status: r.kategori,
    selling_price: r.selling_price, cod_amount: r.cod_amount,
    age_days: r.umur_hari,
  }));
}
const EXC_COLS = [
  { key: "order_id", header: "Order" }, { key: "stockist", header: "Stockist" },
  { key: "tracking", header: "Tracking" }, { key: "status", header: "Status" },
  { key: "selling_price", header: "Selling price" }, { key: "cod_amount", header: "COD amount" },
  { key: "age_days", header: "Age (days)" },
];

export const dynamic = "force-dynamic";

// Susunan paparan pecahan status: yang bermakna dulu, ikut nada.
const KAT_ORDER = [
  "tally", ...INTEGRITY_EXC, ...AGED,
  "belum_remit", "returned", "pending", "rejected", "belum_bayar",
];

export default async function StreamPage(
  { params, searchParams }: {
    params: Promise<{ stream: string }>;
    searchParams: Promise<{ grain?: string; pending?: string; from?: string; to?: string }>;
  },
) {
  const { stream } = await params;
  const sp = await searchParams;
  const grain = parseGrain(sp.grain);
  const pending = parsePending(sp.pending);
  // Julat tarikh ORDER. Tiada param = All time = laluan lama, angka identik.
  const range = parseDateRange(sp);
  const scoped = !isAllTime(range);
  const presets = presetRanges(reconTodayYmd());
  // Prepaid gateway (CHIP) = laluan berasingan: padan ikut order_id, tiada fi
  // courier, duit masuk bank Dicci Group (bukan Dicci Impact).
  if (stream in PREPAID) {
    return (
      <PrepaidStreamPage streamKey={stream as PrepaidKey} grain={grain}
        range={range} presets={presets} />
    );
  }
  if (!(stream in COURIERS)) notFound();
  const key = stream as StreamKey;
  const cfg = COURIERS[key];
  const basePath = `/impact/streams/${key}`;
  // Param yang WAJIB dikekalkan bila julat ditukar (dan sebaliknya). Nilai lalai
  // sengaja ditinggalkan supaya URL kekal bersih.
  const keep = {
    grain: grain === "weekly" ? undefined : grain,
    pending: pending === REMIT_PENDING_DAYS ? undefined : pending,
  };

  const counts = await storeCounts();
  if (counts.orders === 0) {
    return (
      <>
        <Header name={cfg.name} />
        <div className="emptyCard">
          <div className="big">No data yet</div>
          Upload a Fighter export and a {cfg.name} bill to reconcile this stream.
        </div>
      </>
    );
  }

  // Julat aktif = lapisan tapis read-only atas tmp_m yang SAMA (lib/streamRange).
  // Tiada julat = fungsi enjin lama yang di-cache, sifar perubahan (undatedRows 0
  // sebab nota "tiada tarikh" cuma bermakna bila ada tapisan).
  const summaryP: Promise<StreamSummary & { undatedRows: number }> = scoped
    ? streamSummaryRanged(key, pending, range)
    : streamSummary(key, pending).then((x) => ({ ...x, undatedRows: 0 }));
  const [raw, deposits, asOf, user, ctx] = await Promise.all([
    summaryP, getBankDeposits(), lastIngest(), currentUser(),
    resolutionContext(key, reconTodayYmd(), pending),
  ]);
  // TITIK CANTUM lapisan Resolution: decorate() HANYA MENAMBAH medan (lencana
  // per baris + blok resolutionSummary). Tiada satu pun angka duit di bawah ni
  // berubah, jadi paparan lama kekal identik bila tiada kes.
  const s = decorate(raw, ctx);
  const rs = s.resolutionSummary;
  const actor = user?.primaryEmailAddress?.emailAddress ?? "unknown";
  const limits = resolveLimits(isAdmin(actor), reconTodayYmd(), actor);
  const reasons = reasonOptionsUI();
  const net = Math.round((s.linesCod - s.linesFee) * 100) / 100;
  const weekly = groupByGrain(s.daily, grain);

  // Gabung bil + pecahan recon + deposit bank untuk jadual pengesahan.
  const billRows: BillRow[] = s.bills.map((b) => {
    const pb = s.perBill.find((x) => x.bill_id === b.bill_id);
    const d = deposits[b.bill_id];
    const cod = pb?.cod ?? 0, fee = pb?.fee ?? 0;
    return {
      bill_id: b.bill_id, settlement_date: b.settlement_date,
      parcel: pb?.parcel ?? 0, cod, fee,
      net: Math.round((cod - fee) * 100) / 100, exc: pb?.exc ?? 0,
      actual: d ? d.actual_amount : null, note: d?.note ?? null,
      entered_by: d?.entered_by ?? null,
      deposited_on: d?.deposited_on ?? null,
    };
  });

  const katRows = KAT_ORDER.filter((k) => (s.katN[k] ?? 0) > 0)
    .map((k) => ({ kat: k, n: s.katN[k] }));
  const maxKat = Math.max(...katRows.map((r) => r.n), 1);

  return (
    <>
      <Header name={cfg.name} asOf={asOf} />

      <DateRangeFilter basePath={basePath} range={range} presets={presets}
        keep={keep} undatedRows={s.undatedRows} />

      <div className="kpis">
        <div className="kpi">
          <div className="kpiLabel">COD collected
            <InfoTip text="COD means Cash On Delivery: the customer pays the courier when the parcel arrives. This is the cash this courier collected for us." />
          </div>
          <div className="kpiValue"><small>RM</small> {fmtRM(s.linesCod).replace("RM ", "")}</div>
          <div className="kpiNote">{fmtInt(s.linesN)} parcels in {s.bills.length} bill{s.bills.length === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">{cfg.name.split(" ")[0]} fee
            <InfoTip text="The delivery and collection charge this courier keeps. It is taken out of the COD before the rest is sent to us." />
          </div>
          <div className="kpiValue"><small>RM</small> {fmtRM(s.linesFee).replace("RM ", "")}</div>
          <div className="kpiNote">{s.linesN > 0 ? `avg ${fmtRM(s.linesFee / s.linesN)} per parcel` : "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Net remit
            <InfoTip text="The money we expect this courier to send to the bank: COD collected minus the courier fee." />
          </div>
          <div className="kpiValue"><small>RM</small> {fmtRM(net).replace("RM ", "")}</div>
          <div className="kpiNote">expected in bank</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Tally (exact match)
            <InfoTip text="Parcels where the amount on the courier bill matches the Fighter order exactly, ringgit for ringgit. A high tally means the books line up cleanly." />
          </div>
          <div className="kpiValue">{fmtInt(s.tallyN)} <small>/ {fmtInt(s.linesN)}</small></div>
          <div className="kpiNote">
            {s.linesN > 0
              ? <span className={s.tallyN === s.linesN ? "up" : ""}>{((s.tallyN / s.linesN) * 100).toFixed(0)}% of settled parcels</span>
              : "no bill loaded yet"}
          </div>
        </div>
      </div>

      {scoped && s.bills.length > 0 && (
        <div className="cauPanel" style={{ marginBottom: 14 }}>
          <WarnIcon />
          <div><b>These bill figures cover only the parcels whose order falls in
            the selected range.</b>
            <p>A bill can carry parcels from several months, so the amounts here
              can be smaller than the full bill, and smaller than what landed in
              the bank. Switch to All time to reconcile a bill against the bank.</p>
          </div>
        </div>
      )}

      {s.bills.length > 0 ? (
        <BillsTable rows={billRows} courierName={cfg.name} streamKey={key}
          reasons={reasons} limits={limits} />
      ) : scoped ? (
        <div className="emptyCard">
          <div className="big">No {cfg.name} bill in this date range</div>
          No settled parcel on this courier belongs to an order placed in the
          selected range. Widen the range to see more bills.
        </div>
      ) : (
        <div className="emptyCard">
          <div className="big">No {cfg.name} bill loaded yet</div>
          {fmtInt(s.scopedOrders)} COD orders ride this courier. Upload a settlement
          bill to see the money story.
        </div>
      )}

      <div className="sectionGap" />

      <div className="grid2">
        <div className="card">
          <div className="cardHead">
            <div className="cardTitle">Order status
              <InfoTip text="Where each order sits right now: matched cleanly (Tally), still waiting for a bill, returned, and so on. It shows the journey of the money, not just the total." />
            </div>
            <div className="cardHint">{fmtInt(s.scopedOrders)} COD orders on {cfg.name}</div>
          </div>
          <div style={{ marginTop: 10 }}>
            {katRows.map(({ kat, n }) => {
              const tone = katTone(kat);
              const fill = tone === "pos" ? "pos" : tone === "dan" ? "dan" : tone === "cau" ? "cau" : "mut";
              return (
                <div className="breakRow" key={kat}>
                  <div className="breakName">
                    <span className="cdot" style={{
                      background: tone === "pos" ? "var(--pos)" : tone === "dan" ? "var(--dan)"
                        : tone === "cau" ? "var(--goldDark)" : "#C9C2B2",
                    }} />
                    {KAT_LABEL[kat] ?? kat}
                  </div>
                  <div className="breakTrack">
                    <div className={`breakFill ${fill}`} style={{ width: `${(n / maxKat) * 100}%` }} />
                  </div>
                  <div className="breakN">{fmtInt(n)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="cardHead">
            <div className="cardTitle">Exceptions
              <InfoTip text="Rows that do not add up and need a person to look. Tier 1 are integrity issues (real leaks until proven otherwise, like money paid on a returned order). Tier 2 are simply orders that have gone too long with no bill yet." />
            </div>
            <div className="cardHint">what needs a human · aging</div>
            <AgingControl pending={pending} basePath={basePath}
              extraQuery={streamQuery({ grain: keep.grain }, range)} />
          </div>
          {s.integN === 0 ? (
            <div className="posPanel">
              <CheckIcon />
              <div><b>Tier 1 · 0 integrity issues.</b>
                <p>No ghost money, no amount mismatches, no payouts on returned orders.</p></div>
            </div>
          ) : (
            <div className="danPanel">
              <WarnIcon />
              <div><b>Tier 1 · {fmtInt(s.integN)} integrity issues worth {fmtRM(s.integRisk)}.</b>
                <p>Investigate the rows flagged below; these are real leaks until proven otherwise.</p></div>
            </div>
          )}
          {s.agedN > 0 && (
            <div className="cauPanel">
              <WarnIcon />
              <div><b>Tier 2 · {fmtInt(s.agedN)} aged unmatched.</b>
                <p>Completed over {pending} days with no bill yet. Usually an artifact of
                  missing bills; it should shrink as more settlement bills are uploaded.</p></div>
            </div>
          )}
          <ResolutionStrip agg={rs} />
        </div>
      </div>

      <div className="sectionGap" />

      {s.otherCouriers.length > 0 && (
        <>
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Out of Phase 1 scope</div>
              <div className="cardHint">COD orders on other couriers</div>
            </div>
            <OtherCouriers rows={s.otherCouriers} />
          </div>
          <div className="sectionGap" />
        </>
      )}

      {s.integ.length > 0 && (
        <>
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Integrity exceptions</div>
              <div className="cardHint">Tier 1 · oldest first</div>
              <ExportCsv rows={excToCsv(s.integ)} columns={EXC_COLS}
                filename={`${key}-integrity-exceptions.csv`} label="Download CSV" />
            </div>
            <ExceptionsTable
              rows={targetsFrom(s.integ.slice(0, 15), key, cfg.name,
                (k) => KAT_LABEL[k] ?? k)}
              reasons={reasons} limits={limits} />
          </div>
          <div className="sectionGap" />
        </>
      )}

      {s.auditPreview.length > 0 && (
        <div className="card">
          <div className="cardHead">
            <div className="cardTitle">Audit trail</div>
            <div className="cardHint">latest orders on this stream</div>
          </div>
          <AuditTable rows={s.auditPreview} />
        </div>
      )}

      {s.stokisKat.length > 0 && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Breakdown by stockist</div>
              <div className="cardHint">order count by status</div>
              <ExportCsv
                rows={s.stokisKat.map((r) => ({
                  stockist: r.seller, status: KAT_LABEL[r.kategori] ?? r.kategori, orders: r.n,
                }))}
                columns={[
                  { key: "stockist", header: "Stockist" },
                  { key: "status", header: "Status" },
                  { key: "orders", header: "Orders" },
                ]}
                filename={`${key}-stockist-breakdown.csv`} />
            </div>
            <StockistCrossTab rows={s.stokisKat} />
          </div>
        </>
      )}

      {weekly.length > 0 && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Net remit by {GRAIN_LABEL[grain]}</div>
              <div className="cardHint">delivery-signature date</div>
              <GrainSwitcher grain={grain} basePath={basePath} pending={pending}
                extra={{ from: range.from, to: range.to }} />
            </div>
            <WeeklyChart bars={weekly} />
          </div>
        </>
      )}

      <div className="footNote">
        Category logic unchanged from the proven engine <span className="sep">·</span>
        aging reference 18 Jun 2026 <span className="sep">·</span>
        <Link href="/impact" style={{ color: "var(--goldDark)", fontWeight: 700 }}>← Back to overview</Link>
      </div>
    </>
  );
}

function AuditTable({ rows }: {
  rows: {
    order_id: string | null; seller_name: string | null; tracking: string | null;
    awb: string | null; kategori: string; selling_price: number | null;
    cod_amount: number | null;
  }[];
}) {
  // awb bukan NULL = baris bil (COD) atau baris statement (prepaid: order_ref)
  // memang padan, jadi cod_amount NULL di situ = nilai gagal dibaca masa ingest,
  // BUKAN RM 0.00 dan bukan "belum bayar". Lihat components/AmountCell.tsx.
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Order</th><th>Stockist</th><th>Tracking</th><th>Status</th>
            <th className="num">Selling price</th><th className="num">COD amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.order_id ?? r.awb}-${i}`}>
              <td className="cellMain">{r.order_id ?? "—"}</td>
              <td>{r.seller_name ?? "—"}</td>
              <td>{trackingOrDash(r.tracking ?? r.awb)}</td>
              <td><KatChip kat={r.kategori} /></td>
              <td className="num">{r.selling_price != null ? fmtRM(r.selling_price) : "—"}</td>
              <td className="num">
                <AmountCell value={r.cod_amount} hasPayment={r.awb != null} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Baris KECIL di bawah angka mentah. Angka besar di atas TIDAK PERNAH ditukar
// jadi versi "adjusted", dan tiada toggle untuk menyorok yang mentah , keadaan
// resolution cuma dilaporkan di sebelah.
function ResolutionStrip({ agg }: { agg: ResolutionAggregate }) {
  if (!agg.loaded) return null;
  if (agg.settledN === 0 && agg.snoozedN === 0 && agg.proposedN === 0
    && agg.staleN === 0 && agg.expiredN === 0) return null;
  return (
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
          <span className="resolveStat dan">{fmtInt(agg.staleN)} reopened</span>
        </>
      )}
      {agg.expiredN > 0 && (
        <>
          <span className="sep">·</span>
          <span className="resolveStat dan">{fmtInt(agg.expiredN)} snooze expired</span>
        </>
      )}
      <div className="resolveStripNote">
        Counted across this whole stream, not the date range above. Settling a row
        never changes the figures on this page.
        <Link href="/impact/review" className="cardLink" style={{ marginLeft: 6 }}>
          Open Review
        </Link>
      </div>
    </div>
  );
}

function OtherCouriers({ rows }: {
  rows: { courier: string; orders: number; value: number }[];
}) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr><th>Courier</th><th className="num">Orders</th><th className="num">Value</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.courier}>
              <td className="cellMain">{r.courier}</td>
              <td className="num">{fmtInt(r.orders)}</td>
              <td className="num">{fmtRM(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Cross-tab stokis (baris) x kategori (lajur). Lajur disusun ikut KAT_ORDER
// (bermakna dulu), extra kategori di hujung. Sel kosong = "—".
function StockistCrossTab({ rows }: {
  rows: { seller: string; kategori: string; n: number }[];
}) {
  const sellers = [...new Set(rows.map((r) => r.seller))].sort();
  const present = new Set(rows.map((r) => r.kategori));
  const kats = [
    ...KAT_ORDER.filter((k) => present.has(k)),
    ...[...present].filter((k) => !KAT_ORDER.includes(k)).sort(),
  ];
  const cell = new Map<string, number>();
  for (const r of rows) cell.set(`${r.seller} ${r.kategori}`, r.n);
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Stockist</th>
            {kats.map((k) => <th key={k} className="num">{KAT_LABEL[k] ?? k}</th>)}
          </tr>
        </thead>
        <tbody>
          {sellers.map((sr) => (
            <tr key={sr}>
              <td className="cellMain">{sr}</td>
              {kats.map((k) => {
                const v = cell.get(`${sr} ${k}`) ?? 0;
                return <td key={k} className="num">{v ? fmtInt(v) : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Header({ name, asOf }: { name: string; asOf?: string | null }) {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Income stream · COD courier
          <InfoTip text="COD (Cash On Delivery) means the customer pays the courier on arrival, and the courier later remits the cash to us. Prepaid streams are different: the customer paid online before delivery." />
        </div>
        <h1>{name}</h1>
        <div className="pageSub">Settlement bills matched against Fighter orders by tracking number.</div>
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

function BankIcon() {
  return (
    <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M3 16.5h14M4.5 8.5v5M8.2 8.5v5M11.8 8.5v5M15.5 8.5v5M2.5 8.5 10 3.5l7.5 5z" />
    </svg>
  );
}

// ====================================================================
// Prepaid gateway stream (CHIP). Padan ikut order_id (BUKAN tracking), tiada fi
// courier. Nota WAJIB: duit gateway ni masuk bank Dicci Group, bukan Dicci Impact.
// ====================================================================
function PrepaidHeader({ name, asOf }: { name: string; asOf?: string | null }) {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Income stream · Prepaid gateway
          <InfoTip text="Prepaid means the customer paid online at checkout, before the parcel ships (through a gateway like CHIP). There is no cash for the courier to collect, so these are matched by order ID, not tracking number." />
        </div>
        <h1>{name}</h1>
        <div className="pageSub">Online payments matched against Fighter orders by order ID.</div>
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

// Nota bank yang WAJIB nampak: CHIP settle ke bank Dicci Group, bukan Dicci Impact.
function GroupBankNote({ name }: { name: string }) {
  return (
    <div className="cauPanel" style={{ marginBottom: 16 }}>
      <BankIcon />
      <div>
        <b>{name} settles into the Dicci Group bank account, not Dicci Impact.</b>
        <p>
          These online payments are reconciled here for completeness, but the cash
          does not land in Dicci Impact&apos;s ledger. Treat this stream as
          informational, not part of Dicci Impact&apos;s cash position.
        </p>
      </div>
    </div>
  );
}

interface StatementRow {
  bill_id: string; settlement_date: string | null; parcel: number;
  cod: number; fee: number; net: number; tally: number; exc: number;
}

function StatementsTable({ rows }: { rows: StatementRow[] }) {
  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">CHIP statements
          <InfoTip text="A statement is the gateway's own list of the online payments it settled to us, with its fee shown. It is the prepaid version of a courier bill." />
        </div>
        <div className="cardHint">online settlements · matched by order ID</div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Statement</th><th>Date</th>
              <th className="num">Payments</th><th className="num">Amount</th>
              <th className="num">Gateway fee</th><th className="num">Net</th>
              <th className="num">Tally</th><th className="num">Exceptions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bill_id}>
                <td className="cellMain">{r.bill_id}</td>
                <td>{fmtDate(r.settlement_date)}</td>
                <td className="num">{fmtInt(r.parcel)}</td>
                <td className="num">{fmtRM(r.cod)}</td>
                <td className="num">{fmtRM(r.fee)}</td>
                <td className="num">{fmtRM(r.net)}</td>
                <td className="num">{fmtInt(r.tally)}</td>
                <td className="num">{r.exc ? fmtInt(r.exc) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function PrepaidStreamPage(
  { streamKey, grain, range, presets }: {
    streamKey: PrepaidKey; grain: Grain; range: DateRange; presets: RangePresets;
  },
) {
  const cfg = PREPAID[streamKey];
  const scoped = !isAllTime(range);
  const basePath = `/impact/streams/${streamKey}`;
  const keep = { grain: grain === "weekly" ? undefined : grain };

  const counts = await storeCounts();
  if (counts.orders === 0) {
    return (
      <>
        <PrepaidHeader name={cfg.name} />
        <GroupBankNote name={cfg.name} />
        <div className="emptyCard">
          <div className="big">No data yet</div>
          Upload a Fighter export and a {cfg.name} settlement statement to reconcile this stream.
        </div>
      </>
    );
  }

  const summaryP: Promise<StreamSummary & { undatedRows: number }> = scoped
    ? streamPrepaidSummaryRanged(streamKey, range)
    : streamPrepaidSummary(streamKey).then((x) => ({ ...x, undatedRows: 0 }));
  const [raw, asOf, user, ctx] = await Promise.all([
    summaryP, lastIngest(), currentUser(),
    resolutionContext(streamKey, reconTodayYmd()),
  ]);
  // TITIK CANTUM lapisan Resolution untuk stream prepaid. Sama seperti courier:
  // decorate() hanya menambah medan, sifar angka duit bergerak.
  const s = decorate(raw, ctx);
  const rs = s.resolutionSummary;
  const actor = user?.primaryEmailAddress?.emailAddress ?? "unknown";
  const limits = resolveLimits(isAdmin(actor), reconTodayYmd(), actor);
  const reasons = reasonOptionsUI();
  const net = Math.round((s.linesCod - s.linesFee) * 100) / 100;
  const weekly = groupByGrain(s.daily, grain);

  const stmtRows: StatementRow[] = s.bills.map((b) => {
    const pb = s.perBill.find((x) => x.bill_id === b.bill_id);
    const cod = pb?.cod ?? 0, fee = pb?.fee ?? 0;
    return {
      bill_id: b.bill_id, settlement_date: b.settlement_date,
      parcel: pb?.parcel ?? 0, cod, fee,
      net: Math.round((cod - fee) * 100) / 100,
      tally: pb?.tally ?? 0, exc: pb?.exc ?? 0,
    };
  });

  const katRows = KAT_ORDER.filter((k) => (s.katN[k] ?? 0) > 0)
    .map((k) => ({ kat: k, n: s.katN[k] }));
  const maxKat = Math.max(...katRows.map((r) => r.n), 1);

  return (
    <>
      <PrepaidHeader name={cfg.name} asOf={asOf} />
      <GroupBankNote name={cfg.name} />

      <DateRangeFilter basePath={basePath} range={range} presets={presets}
        keep={keep} undatedRows={s.undatedRows} />

      <div className="kpis">
        <div className="kpi">
          <div className="kpiLabel">Payments received</div>
          <div className="kpiValue"><small>RM</small> {fmtRM(s.linesCod).replace("RM ", "")}</div>
          <div className="kpiNote">{fmtInt(s.linesN)} payment{s.linesN === 1 ? "" : "s"} in {s.bills.length} statement{s.bills.length === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Gateway fee</div>
          <div className="kpiValue"><small>RM</small> {fmtRM(s.linesFee).replace("RM ", "")}</div>
          <div className="kpiNote">{s.linesN > 0 ? `avg ${fmtRM(s.linesFee / s.linesN)} per payment` : "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Net settled</div>
          <div className="kpiValue"><small>RM</small> {fmtRM(net).replace("RM ", "")}</div>
          <div className="kpiNote">into Dicci Group bank</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Tally (exact match)
            <InfoTip text="Payments where the amount on the CHIP statement matches the Fighter order exactly, ringgit for ringgit. A high tally means the books line up cleanly." />
          </div>
          <div className="kpiValue">{fmtInt(s.tallyN)} <small>/ {fmtInt(s.linesN)}</small></div>
          <div className="kpiNote">
            {s.linesN > 0
              ? <span className={s.tallyN === s.linesN ? "up" : ""}>{((s.tallyN / s.linesN) * 100).toFixed(0)}% of settled payments</span>
              : "no statement loaded yet"}
          </div>
        </div>
      </div>

      {scoped && stmtRows.length > 0 && (
        <div className="cauPanel" style={{ marginBottom: 14 }}>
          <WarnIcon />
          <div><b>These statement figures cover only the payments whose order
            falls in the selected range.</b>
            <p>One statement can settle payments from several months, so the
              amounts here can be smaller than the full statement.</p>
          </div>
        </div>
      )}

      {stmtRows.length > 0 ? (
        <StatementsTable rows={stmtRows} />
      ) : scoped ? (
        <div className="emptyCard">
          <div className="big">No {cfg.name} statement in this date range</div>
          No settled payment belongs to an order placed in the selected range.
          Widen the range to see more statements.
        </div>
      ) : (
        <div className="emptyCard">
          <div className="big">No {cfg.name} statement loaded yet</div>
          {fmtInt(s.scopedOrders)} CHIP orders are awaiting a gateway settlement statement.
          Upload a {cfg.name} statement to reconcile online payments by order ID.
        </div>
      )}

      <div className="sectionGap" />

      <div className="grid2">
        <div className="card">
          <div className="cardHead">
            <div className="cardTitle">Order status</div>
            <div className="cardHint">{fmtInt(s.scopedOrders)} CHIP orders</div>
          </div>
          <div style={{ marginTop: 10 }}>
            {katRows.map(({ kat, n }) => {
              const tone = katTone(kat);
              const fill = tone === "pos" ? "pos" : tone === "dan" ? "dan" : tone === "cau" ? "cau" : "mut";
              return (
                <div className="breakRow" key={kat}>
                  <div className="breakName">
                    <span className="cdot" style={{
                      background: tone === "pos" ? "var(--pos)" : tone === "dan" ? "var(--dan)"
                        : tone === "cau" ? "var(--goldDark)" : "#C9C2B2",
                    }} />
                    {KAT_LABEL[kat] ?? kat}
                  </div>
                  <div className="breakTrack">
                    <div className={`breakFill ${fill}`} style={{ width: `${(n / maxKat) * 100}%` }} />
                  </div>
                  <div className="breakN">{fmtInt(n)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="cardHead">
            <div className="cardTitle">Exceptions</div>
            <div className="cardHint">what needs a human</div>
          </div>
          {s.integN === 0 ? (
            <div className="posPanel">
              <CheckIcon />
              <div><b>Tier 1 · 0 integrity issues.</b>
                <p>No ghost payments and no amount mismatches on this gateway.</p></div>
            </div>
          ) : (
            <div className="danPanel">
              <WarnIcon />
              <div><b>Tier 1 · {fmtInt(s.integN)} integrity issues worth {fmtRM(s.integRisk)}.</b>
                <p>Investigate the rows flagged below; these are real leaks until proven otherwise.</p></div>
            </div>
          )}
          <ResolutionStrip agg={rs} />
        </div>
      </div>

      {s.integ.length > 0 && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Integrity exceptions</div>
              <div className="cardHint">Tier 1 · oldest first</div>
            </div>
            <ExceptionsTable
              rows={targetsFrom(s.integ.slice(0, 15), streamKey, cfg.name,
                (k) => KAT_LABEL[k] ?? k)}
              reasons={reasons} limits={limits} showTracking={false} />
          </div>
        </>
      )}

      {s.auditPreview.length > 0 && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Audit trail</div>
              <div className="cardHint">latest CHIP orders</div>
            </div>
            <AuditTable rows={s.auditPreview} />
          </div>
        </>
      )}

      {s.stokisKat.length > 0 && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Breakdown by stockist</div>
              <div className="cardHint">order count by status</div>
            </div>
            <StockistCrossTab rows={s.stokisKat} />
          </div>
        </>
      )}

      {weekly.length > 0 && (
        <>
          <div className="sectionGap" />
          <div className="card">
            <div className="cardHead">
              <div className="cardTitle">Net settled by {GRAIN_LABEL[grain]}</div>
              <div className="cardHint">payment date</div>
              <GrainSwitcher grain={grain} basePath={basePath}
                extra={{ from: range.from, to: range.to }} />
            </div>
            <WeeklyChart bars={weekly} />
          </div>
        </>
      )}

      <div className="footNote">
        Prepaid recon matched by order ID · category logic mirrors the proven engine
        <span className="sep">·</span>
        <Link href="/impact" style={{ color: "var(--goldDark)", fontWeight: 700 }}>← Back to overview</Link>
      </div>
    </>
  );
}
