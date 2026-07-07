import { closePack } from "@/lib/closePack";
import { storeCounts, lastIngest } from "@/lib/recon";
import { fmtDate, fmtInt, fmtRM } from "@/lib/format";
import ExportCsv from "@/components/ExportCsv";

export const dynamic = "force-dynamic";

const r2 = (x: number) => Math.round(x * 100) / 100;

// Kolum CSV Close Pack. subsidiary first-class (multi-subsidiary nanti sifar rework).
const COLS = [
  { key: "subsidiary", header: "Subsidiary" },
  { key: "stream", header: "Stream" },
  { key: "period", header: "Period" },
  { key: "parcels", header: "Parcels" },
  { key: "cod", header: "COD collected" },
  { key: "fee", header: "Fee" },
  { key: "net", header: "Net remit (expected)" },
  { key: "banked", header: "Banked (actual)" },
  { key: "bills", header: "Bills confirmed" },
  { key: "variance", header: "Variance" },
  { key: "exceptions", header: "Exceptions" },
];

export default async function ExportPage() {
  const counts = await storeCounts();
  if (counts.orders === 0) {
    return (
      <>
        <Header />
        <div className="emptyCard">
          <div className="big">No data yet</div>
          Upload Fighter orders and courier bills to build the reconciliation close pack.
        </div>
      </>
    );
  }

  const [rows, asOf] = await Promise.all([closePack(), lastIngest()]);

  const t = rows.reduce(
    (a, r) => ({
      parcels: a.parcels + r.parcels, cod: a.cod + r.cod, fee: a.fee + r.fee,
      net: a.net + r.net, banked: a.banked + r.banked, variance: a.variance + r.variance,
      exceptions: a.exceptions + r.exceptions,
      bankedBills: a.bankedBills + r.bankedBills, totalBills: a.totalBills + r.totalBills,
    }),
    { parcels: 0, cod: 0, fee: 0, net: 0, banked: 0, variance: 0, exceptions: 0, bankedBills: 0, totalBills: 0 },
  );

  // Baris CSV: data + baris TOTAL. "X of Y" (bukan "X/Y") supaya Excel tak baca jadi tarikh.
  const csvRows = [
    ...rows.map((r) => ({
      subsidiary: "Dicci Impact", stream: r.stream, period: r.period,
      parcels: r.parcels, cod: r.cod, fee: r.fee, net: r.net, banked: r.banked,
      bills: `${r.bankedBills} of ${r.totalBills}`, variance: r.variance, exceptions: r.exceptions,
    })),
    {
      subsidiary: "Dicci Impact", stream: "ALL", period: "TOTAL",
      parcels: t.parcels, cod: r2(t.cod), fee: r2(t.fee), net: r2(t.net),
      banked: r2(t.banked), bills: `${t.bankedBills} of ${t.totalBills}`,
      variance: r2(t.variance), exceptions: t.exceptions,
    },
  ];
  const asOfName = asOf ? asOf.slice(0, 10) : "all";

  return (
    <>
      <Header asOf={asOf} />

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Reconciliation close pack</div>
          <div className="cardHint">expected remit vs actual banked, per stream and period</div>
          <ExportCsv rows={csvRows} columns={COLS}
            filename={`impact-close-pack-asof-${asOfName}.csv`} />
        </div>
        <p className="pageSub" style={{ marginTop: 2 }}>
          Snapshot for <b>Dicci Impact</b>, numbers move as more bills arrive. Variance =
          expected net remit minus actual banked; a non-zero variance is a leak signal.
          Bills not yet confirmed in the bank leave banked and variance blank.
        </p>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Stream</th><th>Period</th><th className="num">Parcels</th>
                <th className="num">COD collected</th><th className="num">Fee</th>
                <th className="num">Net remit</th><th className="num">Banked</th>
                <th className="num">Bills</th><th className="num">Variance</th>
                <th className="num">Exc</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const matched = Math.abs(r.variance) < 0.005 && r.bankedBills === r.totalBills;
                return (
                  <tr key={`${r.streamKey}-${r.period}`}>
                    <td className="cellMain">{r.stream}</td>
                    <td>{r.period}</td>
                    <td className="num">{fmtInt(r.parcels)}</td>
                    <td className="num">{fmtRM(r.cod)}</td>
                    <td className="num">{fmtRM(r.fee)}</td>
                    <td className="num"><b>{fmtRM(r.net)}</b></td>
                    <td className="num">
                      {r.bankedBills > 0 ? fmtRM(r.banked) : <span className="faintCell">—</span>}
                    </td>
                    <td className="num">{r.bankedBills} of {r.totalBills}</td>
                    <td className="num">
                      {r.bankedBills === 0 ? <span className="faintCell">—</span>
                        : <span style={{ color: matched ? "var(--pos)" : "var(--dan)" }}>{fmtRM(r.variance)}</span>}
                    </td>
                    <td className="num">
                      {r.exceptions > 0 ? <span style={{ color: "var(--dan)" }}>{fmtInt(r.exceptions)}</span> : "0"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="cellMain"><b>Total</b></td><td />
                <td className="num"><b>{fmtInt(t.parcels)}</b></td>
                <td className="num"><b>{fmtRM(r2(t.cod))}</b></td>
                <td className="num"><b>{fmtRM(r2(t.fee))}</b></td>
                <td className="num"><b>{fmtRM(r2(t.net))}</b></td>
                <td className="num"><b>{fmtRM(r2(t.banked))}</b></td>
                <td className="num"><b>{t.bankedBills} of {t.totalBills}</b></td>
                <td className="num"><b>{fmtRM(r2(t.variance))}</b></td>
                <td className="num"><b>{fmtInt(t.exceptions)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="footNote">
        Composed from the same recon engine as the dashboard, no separate calculation.
        Period = settlement month of each bill. Free / commission figures are not in this
        pack.
      </div>
    </>
  );
}

function Header({ asOf }: { asOf?: string | null }) {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Dicci Impact · Reports</div>
        <h1>Export</h1>
        <div className="pageSub">
          Reconciliation close pack, expected money-in versus what landed in the bank,
          ready for Excel.
        </div>
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
