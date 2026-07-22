import { stockistBottles, stockistGifts, storeCounts, paymentBuckets } from "@/lib/recon";
import { fmtInt, fmtRM } from "@/lib/format";
import ExportCsv from "@/components/ExportCsv";
import StockistModal from "@/components/StockistModal";
import StockistTable, { StockistTableRow } from "@/components/StockistTable";
import PaymentBuckets from "@/components/PaymentBuckets";

const BOTTLE_COLS = [
  { key: "stockist", header: "Stockist" },
  { key: "confirmed_orders", header: "Confirmed orders" },
  { key: "paid_bottles", header: "Paid bottles" },
  { key: "free_bottles", header: "Free bottles" },
  { key: "total_bottles", header: "Total bottles" },
  { key: "unconfirmed_bottles", header: "Unconfirmed bottles" },
  { key: "giveaway_cost", header: "Giveaway cost (RM)" },
];
export const dynamic = "force-dynamic";

export default async function StockistsPage(
  { searchParams }: { searchParams: Promise<{ s?: string }> },
) {
  const { s } = await searchParams;
  const counts = await storeCounts();

  if (counts.orders === 0) {
    return (
      <>
        <Header />
        <div className="emptyCard">
          <div className="big">No data yet</div>
          Upload a Fighter export to see bottles per stockist.
        </div>
      </>
    );
  }

  const [rows, giftsRaw, buckets] = await Promise.all([
    stockistBottles(), stockistGifts(), paymentBuckets(),
  ]);
  // Kumpul gift ikut stokis: chip (nama x qty) + total kos. Query berasingan
  // (tak fan-out kiraan botol), digabung di sini ikut nama stokis.
  const giftMap = new Map<string, { gifts: { name: string; qty: number }[]; cost: number }>();
  for (const g of giftsRaw) {
    let e = giftMap.get(g.stockist);
    if (!e) { e = { gifts: [], cost: 0 }; giftMap.set(g.stockist, e); }
    e.gifts.push({ name: g.gift_name, qty: g.qty });
    e.cost += g.cost;
  }
  const rowsExport = rows.map((r) => ({
    ...r, giveaway_cost: Math.round((giftMap.get(r.stockist)?.cost ?? 0) * 100) / 100,
  }));
  const totBottles = rows.reduce((a, r) => a + r.total_bottles, 0);
  const totFree = rows.reduce((a, r) => a + r.free_bottles, 0);
  const totUnconfirmed = rows.reduce((a, r) => a + r.unconfirmed_bottles, 0);
  const totGiftCost = giftsRaw.reduce((a, g) => a + g.cost, 0);

  const picked = s && rows.some((r) => r.stockist === s) ? s : null;

  // Baris berbentuk serializable untuk komponen client (gift digabung di sini).
  const tableRows: StockistTableRow[] = rows.map((r) => {
    const g = giftMap.get(r.stockist);
    return {
      stockist: r.stockist,
      confirmed_orders: r.confirmed_orders,
      paid_bottles: r.paid_bottles,
      free_bottles: r.free_bottles,
      total_bottles: r.total_bottles,
      unconfirmed_bottles: r.unconfirmed_bottles,
      gifts: g?.gifts ?? [],
      giftCost: g?.cost ?? 0,
    };
  });

  return (
    <>
      <Header />

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Bottles per stockist</div>
          <div className="cardHint">
            paid (sales) + free (cost), counted once payment is confirmed
          </div>
          <ExportCsv rows={rowsExport} columns={BOTTLE_COLS}
            filename="impact-stockist-bottles.csv" />
        </div>
        <p className="pageSub" style={{ marginTop: 2 }}>
          Confirmed: <b>{fmtInt(totBottles)}</b> bottles ({fmtInt(totFree)} free) across{" "}
          {rows.length} stockists. Not yet confirmed: {fmtInt(totUnconfirmed)} bottles , see the
          honest breakdown below (awaiting COD remittance, awaiting CHIP statement, no feed).
          Giveaway cost (confirmed): <b>{fmtRM(totGiftCost)}</b>. Bottles &amp; gift cost count
          across all couriers, only for Completed orders whose money is confirmed.
        </p>
        <StockistTable rows={tableRows} picked={picked} />
      </div>

      <PaymentBuckets buckets={buckets}
        title="Where the not-yet-confirmed bottles sit" showBottles />

      {picked && <StockistModal stockist={picked} />}

      <div className="footNote">
        &quot;Unconfirmed&quot; flips automatically once the matching money feed
        (courier bill, CHIP statement) is uploaded, no rework needed.
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="pageHead">
      <div>
        <div className="eyebrow">Dicci Impact · People</div>
        <h1>Stockists</h1>
        <div className="pageSub">Bottles moved per stockist, across every courier and payment method.</div>
      </div>
    </div>
  );
}
