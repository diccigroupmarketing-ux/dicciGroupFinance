import { currentUser } from "@clerk/nextjs/server";
import { skuMap, storeCounts } from "@/lib/recon";
import { isAdmin } from "@/lib/mutations";
import SkuEditor from "@/components/SkuEditor";
import StoreDanger from "@/components/StoreDanger";

export const dynamic = "force-dynamic";

export default async function SkusPage() {
  const [rows, user] = await Promise.all([skuMap(), currentUser()]);
  const admin = isAdmin(user?.primaryEmailAddress?.emailAddress);
  const counts = admin ? await storeCounts() : null;

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

      <SkuEditor initial={rows} />

      {admin && counts && (
        <StoreDanger counts={{
          orders: counts.orders, billLines: counts.billLines, wallet: counts.wallet,
        }} />
      )}

      <div className="footNote">
        Orders with SKUs missing from this table count as 0 bottles until mapped.
      </div>
    </>
  );
}
