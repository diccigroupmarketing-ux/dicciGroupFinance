// Baldi pengesahan bayaran JUJUR (paparan sahaja). Memecahkan satu baldi kabur
// "Awaiting payment confirmation" jadi baldi bermakna yang diturunkan dari
// payment_method + kehadiran feed. TIDAK mengubah tally COD atau keahlian
// confirmed_paid_order_ids , ini derivasi paparan sahaja.
import { fmtInt, fmtRM } from "@/lib/format";
import type { PayBucket } from "@/lib/recon";

type Meta = { label: string; chip: string; confirmed: boolean; hint: string };

const META: Record<string, Meta> = {
  confirmed_cod: {
    label: "Confirmed COD", chip: "chipPos", confirmed: true,
    hint: "Matched to a courier settlement bill.",
  },
  confirmed_prepaid: {
    label: "Confirmed prepaid (CHIP)", chip: "chipPos", confirmed: true,
    hint: "Matched to a successful CHIP statement line.",
  },
  awaiting_cod: {
    label: "Awaiting COD remittance", chip: "chipCau", confirmed: false,
    hint: "COD order not yet on any courier bill , normal until the bill lands.",
  },
  awaiting_prepaid: {
    label: "Awaiting prepaid statement", chip: "chipCau", confirmed: false,
    hint: "Prepaid orders are paid at checkout; this auto-confirms when the CHIP statement is uploaded. NOT leaked money.",
  },
  no_feed: {
    label: "No payment feed · cannot verify", chip: "chipDan", confirmed: false,
    hint: "Payment method has no feed wired yet (e.g. Bank Transfer). Cannot verify money in.",
  },
};

function Aging({ days }: { days: number | null }) {
  if (days == null) return <span style={{ color: "var(--faint)" }}>—</span>;
  const tone = days >= 30 ? "chipDan" : days >= 14 ? "chipCau" : "chipMut";
  return (
    <span className={"chip " + tone} title="Age of the oldest order still in this bucket (aging reference 18 Jun 2026)">
      <span className="cdot" /> {fmtInt(days)}d oldest
    </span>
  );
}

export default function PaymentBuckets({
  buckets, title = "Payment confirmation", showBottles = false,
}: {
  buckets: PayBucket[]; title?: string; showBottles?: boolean;
}) {
  if (!buckets.length) return null;
  const conf = buckets.filter((b) => META[b.bucket]?.confirmed);
  const awaiting = buckets.filter((b) => !META[b.bucket]?.confirmed);
  const confOrders = conf.reduce((a, b) => a + b.orders, 0);
  const totOrders = buckets.reduce((a, b) => a + b.orders, 0);

  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">{title}</div>
        <div className="cardHint">
          honest breakdown by payment method · {fmtInt(confOrders)} of {fmtInt(totOrders)} orders confirmed
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th className="num">Orders</th>
              <th className="num">Expected (RM)</th>
              {showBottles && <th className="num">Bottles</th>}
              <th>Aging</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              const m = META[b.bucket] ?? { label: b.bucket, chip: "chipMut", confirmed: false, hint: "" };
              return (
                <tr key={b.bucket}>
                  <td>
                    <span className={"chip " + m.chip}><span className="cdot" /> {m.label}</span>
                    <div className="cellSub" style={{ marginTop: 4 }}>{m.hint}</div>
                  </td>
                  <td className="num">{fmtInt(b.orders)}</td>
                  <td className="num">{fmtRM(b.expected).replace("RM ", "")}</td>
                  {showBottles && <td className="num">{fmtInt(b.bottles)}</td>}
                  <td>{m.confirmed ? <span style={{ color: "var(--faint)" }}>—</span> : <Aging days={b.oldestDays} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {awaiting.length > 0 && (
        <div className="cardHint" style={{ marginTop: 10 }}>
          Awaiting buckets are not leaks , prepaid confirms when the CHIP statement is
          uploaded, COD confirms when the courier bill lands. Aging shows the oldest order
          still waiting, so anything stuck stays visible.
        </div>
      )}
    </div>
  );
}
