// Baldi pengesahan bayaran JUJUR (paparan sahaja). Memecahkan satu baldi kabur
// "Awaiting payment confirmation" jadi baldi bermakna yang diturunkan dari
// payment_method + kehadiran feed. TIDAK mengubah tally COD atau keahlian
// confirmed_paid_order_ids , ini derivasi paparan sahaja.
// Baldi COD boleh dibuka (accordion inline) untuk pecahan per kurier.
"use client";
import { Fragment, useState } from "react";
import { fmtInt, fmtRM } from "@/lib/format";
import type { PayBucket } from "@/lib/recon";
import CourierBreakdown, { canBreakdown } from "@/components/CourierBreakdown";
import InfoTip from "@/components/InfoTip";

function Caret() {
  return (
    <svg className="bktCaret" width="12" height="12" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
  );
}

// Tag saluran bayaran per baris baldi (sentiasa on, behavior prod).
type PayTag = { text: string; cls: string };
const PAY_TAG: Record<string, PayTag> = {
  confirmed_cod: { text: "COD", cls: "paytagCod" },
  awaiting_cod: { text: "COD", cls: "paytagCod" },
  confirmed_prepaid: { text: "CHIP", cls: "paytagChip" },
  awaiting_prepaid: { text: "CHIP", cls: "paytagChip" },
  no_feed: { text: "Bank Transfer", cls: "paytagBank" },
};

type Meta = { label: string; chip: string; confirmed: boolean; hint: string };

const META: Record<string, Meta> = {
  confirmed_cod: {
    label: "Confirmed COD", chip: "chipPos", confirmed: true,
    hint: "Matched to a courier settlement bill.",
  },
  confirmed_prepaid: {
    label: "Confirmed prepaid (CHIP)", chip: "chipInfo", confirmed: true,
    hint: "Matched to a successful CHIP statement line.",
  },
  awaiting_cod: {
    label: "Awaiting COD remittance", chip: "chipCau", confirmed: false,
    hint: "COD order not yet on any courier bill , normal until the bill lands.",
  },
  awaiting_prepaid: {
    label: "Awaiting CHIP statement", chip: "chipInfo", confirmed: false,
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
  // Buka satu baldi pada satu masa (elak dinding panjang). Default tutup.
  const [open, setOpen] = useState<string | null>(null);
  if (!buckets.length) return null;
  const conf = buckets.filter((b) => META[b.bucket]?.confirmed);
  const awaiting = buckets.filter((b) => !META[b.bucket]?.confirmed);
  const confOrders = conf.reduce((a, b) => a + b.orders, 0);
  const totOrders = buckets.reduce((a, b) => a + b.orders, 0);
  const colSpan = showBottles ? 5 : 4;

  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">{title}
          <InfoTip text="Every order sorted into honest groups by how it was paid. Confirmed means the money was matched to a bill or statement. Awaiting means we are still waiting for that proof, it is not lost money." />
        </div>
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
              <th>Aging
                <InfoTip text="How old the oldest order still waiting in this group is, in days. The longer it sits, the more worth chasing. Counted from the aging reference date, 18 Jun 2026." />
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => {
              const m = META[b.bucket] ?? { label: b.bucket, chip: "chipMut", confirmed: false, hint: "" };
              const expandable = canBreakdown(b);
              const isOpen = open === b.bucket;
              return (
                <Fragment key={b.bucket}>
                  <tr
                    className={"bktRow" + (expandable ? " expandable" : "") + (isOpen ? " open" : "")}
                    onClick={expandable ? () => setOpen(isOpen ? null : b.bucket) : undefined}
                    aria-expanded={expandable ? isOpen : undefined}
                  >
                    <td>
                      <div className="bktLead">
                        {expandable && <Caret />}
                        <span className={"chip " + m.chip}><span className="cdot" /> {m.label}</span>
                        {PAY_TAG[b.bucket] && (
                          <span className={"paytag " + PAY_TAG[b.bucket].cls}>{PAY_TAG[b.bucket].text}</span>
                        )}
                      </div>
                      <div className="cellSub" style={{ marginTop: 4 }}>
                        {m.hint}
                        {expandable && (
                          <span className="bktBreakHint">
                            {" "}· {isOpen ? "hide" : "show"} breakdown by courier
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num">{fmtInt(b.orders)}</td>
                    <td className="num">{fmtRM(b.expected).replace("RM ", "")}</td>
                    {showBottles && <td className="num">{fmtInt(b.bottles)}</td>}
                    <td>{m.confirmed ? <span style={{ color: "var(--faint)" }}>—</span> : <Aging days={b.oldestDays} />}</td>
                  </tr>
                  {expandable && isOpen && (
                    <tr className="bktSubRow">
                      <td className="bktSubCell" colSpan={colSpan}>
                        <CourierBreakdown items={b.byCourier!} showAging={!m.confirmed} />
                      </td>
                    </tr>
                  )}
                </Fragment>
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
