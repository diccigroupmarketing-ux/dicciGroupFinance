// Pecahan per kurier untuk baldi COD (accordion body dikongsi antara dashboard
// PaymentBuckets & StockistModal supaya paparan seragam). Presentational sahaja:
// terima senarai byCourier (sudah dikira server-side) + render satu baris padat
// per kurier (nama, order, RM, aging). TIDAK ubah data atau kira apa apa.
import { fmtInt, fmtRM } from "@/lib/format";
import type { PayBucket, PayBucketCourier } from "@/lib/recon";

const PROVIDER_LABEL: Record<string, string> = {
  "J&T Express": "J&T",
  "DHL eCommerce": "DHL",
  "Ninja Van": "Ninja Van",
};
export const provLabel = (p: string) => PROVIDER_LABEL[p] ?? p;

// Boleh dibuka bila baldi COD dan ada >1 kurier (elak chevron kosmetik untuk
// satu kurier). byCourier hanya wujud untuk baldi COD (diisi server-side).
export function canBreakdown(b: Pick<PayBucket, "byCourier">): boolean {
  return (b.byCourier?.length ?? 0) > 1;
}

export default function CourierBreakdown({
  items, showAging = true,
}: {
  items: PayBucketCourier[]; showAging?: boolean;
}) {
  return (
    <div className="courierBreak" role="list">
      {items.map((c) => (
        <div className="courierBreakRow" role="listitem" key={c.provider}>
          <span className="courierBreakName">{provLabel(c.provider)}</span>
          <span className="courierBreakMeta">
            {fmtInt(c.orders)} order{c.orders === 1 ? "" : "s"} · RM {fmtRM(c.expected).replace("RM ", "")}
            {showAging && c.oldestDays != null && (
              <span className="courierBreakAge"> · {fmtInt(c.oldestDays)}d oldest</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
