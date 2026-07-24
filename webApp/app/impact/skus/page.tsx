import { currentUser } from "@clerk/nextjs/server";
import { skuMap, storeCounts, unmappedSkus, skuReview, LOW_PPB_THRESHOLD } from "@/lib/recon";
import { isAdmin } from "@/lib/mutations";
import { fmtInt } from "@/lib/format";
import SkuEditor from "@/components/SkuEditor";
import StoreDanger from "@/components/StoreDanger";
import InfoTip from "@/components/InfoTip";

export const dynamic = "force-dynamic";

export default async function SkusPage() {
  const [rows, user, unmapped, review] = await Promise.all([
    skuMap(), currentUser(), unmappedSkus(), skuReview(),
  ]);
  const autoAdded = review.filter((r) => r.autoAdded);
  const lowPrice = review.filter((r) => r.lowPrice);
  const admin = isAdmin(user?.primaryEmailAddress?.emailAddress);
  const counts = admin ? await storeCounts() : null;
  const resetEnabled = process.env.ALLOW_STORE_RESET === "1";

  return (
    <>
      <div className="pageHead">
        <div>
          <div className="eyebrow">Dicci Impact · Configuration</div>
          <h1>SKU / Bottles</h1>
          <div className="pageSub">
            How each SKU converts into bottles. paid = paid bottles, free = giveaway
            portion (e.g. +1 / +2 KORBAN), tracked separately for costing. Edits
            apply to every stream instantly.
          </div>
        </div>
      </div>

      {unmapped.length > 0 && (
        <div className="cauPanel" style={{ marginBottom: 16 }}>
          <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none"
               stroke="currentColor" strokeWidth="2">
            <path d="M10 7v4m0 3h.01M10 2.5 18 16H2z" />
          </svg>
          <div>
            <b>{fmtInt(unmapped.length)} SKU{unmapped.length === 1 ? "" : "s"} in orders are not mapped.</b>
            <p>These count as 0 bottles until added below:{" "}
              <span style={{ fontWeight: 700 }}>{unmapped.slice(0, 12).join(", ")}</span>
              {unmapped.length > 12 ? ` +${unmapped.length - 12} more` : ""}.</p>
          </div>
        </div>
      )}

      {autoAdded.length > 0 && (
        <div className="cauPanel" style={{ marginBottom: 16 }}>
          <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none"
               stroke="currentColor" strokeWidth="2">
            <path d="M10 7v4m0 3h.01M10 2.5 18 16H2z" />
          </svg>
          <div>
            <b>Review these auto-added SKU bottle counts ({fmtInt(autoAdded.length)}).
              <InfoTip text="When a new SKU first appears in an upload, the system guesses its paid and free bottle counts from the SKU name (the +1, +2, KORBAN part). These are guesses. Check the numbers, then give the SKU a real product name to clear it from this list." />
            </b>
            <p>These were auto-registered on upload with a guessed paid/free split , confirm the
              numbers are right:{" "}
              <span style={{ fontWeight: 700 }}>
                {autoAdded.slice(0, 12).map((r) => `${r.sku} (${r.paid}+${r.free})`).join(", ")}
              </span>
              {autoAdded.length > 12 ? ` +${autoAdded.length - 12} more` : ""}.</p>
          </div>
        </div>
      )}

      {lowPrice.length > 0 && (
        <div className="cauPanel" style={{ marginBottom: 16 }}>
          <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none"
               stroke="currentColor" strokeWidth="2">
            <path d="M10 7v4m0 3h.01M10 2.5 18 16H2z" />
          </svg>
          <div>
            <b>Price per bottle looks low for {fmtInt(lowPrice.length)} SKU{lowPrice.length === 1 ? "" : "s"}.
              <InfoTip text="We divide the order value by the number of bottles. If that comes out very low, the bottle count for this SKU may be set too high. Nothing was changed, this is just a heads-up to double check." />
            </b>
            <p>Order value ÷ bottles is under RM {LOW_PPB_THRESHOLD}/bottle , the bottle count may be
              too high. Please verify (nothing was changed):{" "}
              <span style={{ fontWeight: 700 }}>
                {lowPrice.slice(0, 12).map((r) => `${r.sku} (RM${r.pricePerBottle}/btl, ${r.paid + r.free} btl)`).join(", ")}
              </span>
              {lowPrice.length > 12 ? ` +${lowPrice.length - 12} more` : ""}.</p>
          </div>
        </div>
      )}

      <SkuEditor initial={rows} />

      {admin && counts && (
        <StoreDanger counts={{
          orders: counts.orders, billLines: counts.billLines, wallet: counts.wallet,
        }} resetEnabled={resetEnabled} />
      )}

      <div className="footNote">
        Orders with SKUs missing from this table count as 0 bottles until mapped.
      </div>
    </>
  );
}
