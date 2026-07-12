import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AGED, COURIERS, INTEGRITY_EXC, KAT_LABEL, REMIT_PENDING_DAYS,
  StreamKey, streamSummary, storeCounts, lastIngest, type ExcRow,
} from "@/lib/recon";
import {
  fmtDate, fmtInt, fmtRM, GRAIN_LABEL, groupByGrain, parseGrain, trackingOrDash,
} from "@/lib/format";
import { KatChip, katTone } from "@/components/Chip";
import GrainSwitcher from "@/components/GrainSwitcher";
import WeeklyChart from "@/components/WeeklyChart";
import BillsTable, { type BillRow } from "@/components/BillsTable";
import ExportCsv from "@/components/ExportCsv";
import AgingControl from "@/components/AgingControl";
import { getBankDeposits } from "@/lib/bank";

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
    searchParams: Promise<{ grain?: string; pending?: string }>;
  },
) {
  const { stream } = await params;
  const sp = await searchParams;
  const grain = parseGrain(sp.grain);
  const pending = parsePending(sp.pending);
  if (!(stream in COURIERS)) notFound();
  const key = stream as StreamKey;
  const cfg = COURIERS[key];

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

  const [s, deposits, asOf] = await Promise.all([
    streamSummary(key, pending), getBankDeposits(), lastIngest(),
  ]);
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
    };
  });

  const katRows = KAT_ORDER.filter((k) => (s.katN[k] ?? 0) > 0)
    .map((k) => ({ kat: k, n: s.katN[k] }));
  const maxKat = Math.max(...katRows.map((r) => r.n), 1);

  return (
    <>
      <Header name={cfg.name} asOf={asOf} />

      <div className="kpis">
        <div className="kpi">
          <div className="kpiLabel">COD collected</div>
          <div className="kpiValue"><small>RM</small> {fmtRM(s.linesCod).replace("RM ", "")}</div>
          <div className="kpiNote">{fmtInt(s.linesN)} parcels in {s.bills.length} bill{s.bills.length === 1 ? "" : "s"}</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">{cfg.name.split(" ")[0]} fee</div>
          <div className="kpiValue"><small>RM</small> {fmtRM(s.linesFee).replace("RM ", "")}</div>
          <div className="kpiNote">{s.linesN > 0 ? `avg ${fmtRM(s.linesFee / s.linesN)} per parcel` : "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Net remit</div>
          <div className="kpiValue"><small>RM</small> {fmtRM(net).replace("RM ", "")}</div>
          <div className="kpiNote">expected in bank</div>
        </div>
        <div className="kpi">
          <div className="kpiLabel">Tally (exact match)</div>
          <div className="kpiValue">{fmtInt(s.tallyN)} <small>/ {fmtInt(s.linesN)}</small></div>
          <div className="kpiNote">
            {s.linesN > 0
              ? <span className={s.tallyN === s.linesN ? "up" : ""}>{((s.tallyN / s.linesN) * 100).toFixed(0)}% of settled parcels</span>
              : "no bill loaded yet"}
          </div>
        </div>
      </div>

      {s.bills.length > 0 ? (
        <BillsTable rows={billRows} courierName={cfg.name} streamKey={key} />
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
            <div className="cardTitle">Order status</div>
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
            <div className="cardTitle">Exceptions</div>
            <div className="cardHint">what needs a human · aging</div>
            <AgingControl pending={pending} grain={grain} streamKey={key} />
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
            <AuditTable rows={s.integ.slice(0, 15)} />
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
              <GrainSwitcher grain={grain} basePath={`/impact/streams/${key}`} pending={pending} />
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
              <td className="num">{r.cod_amount != null ? fmtRM(r.cod_amount) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <div className="eyebrow">Income stream · COD courier</div>
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
