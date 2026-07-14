import { currentUser } from "@clerk/nextjs/server";
import { skuMap, storeCounts, unmappedSkus } from "@/lib/recon";
import { isAdmin } from "@/lib/mutations";
import { fmtInt } from "@/lib/format";
import SkuEditor from "@/components/SkuEditor";
import StoreDanger from "@/components/StoreDanger";

export const dynamic = "force-dynamic";

export default async function SkusPage() {
  const [rows, user, unmapped] = await Promise.all([
    skuMap(), currentUser(), unmappedSkus(),
  ]);
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
