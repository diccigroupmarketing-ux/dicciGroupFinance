// Guardrail: pecahan per kurier baldi COD mesti berjumlah TEPAT dengan jumlah
// baldi, dan jumlah baldi global mesti kekal identik dengan set order Completed.
//   DATABASE_URL="postgresql://dev:dev@localhost:5433/dicci" npx tsx scripts/checkBuckets.ts
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://dev:dev@localhost:5433/dicci";
if (!process.env.DATABASE_URL.includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost).");
  process.exit(1);
}

import { paymentBucketsImpl, stockistDetail } from "../lib/recon";
import { getPool } from "../lib/db";

const COD = new Set(["confirmed_cod", "awaiting_cod"]);
const r2 = (x: number) => Math.round(x * 100) / 100;
let fail = 0;
function ok(c: boolean, label: string) {
  console.log((c ? "  PASS " : "  FAIL ") + label);
  if (!c) fail++;
}

function assertBuckets(tag: string, buckets: Awaited<ReturnType<typeof paymentBucketsImpl>>) {
  for (const b of buckets) {
    if (COD.has(b.bucket)) {
      ok(Array.isArray(b.byCourier), `${tag} ${b.bucket}: ada byCourier`);
      const bc = b.byCourier ?? [];
      const so = bc.reduce((a, c) => a + c.orders, 0);
      const se = r2(bc.reduce((a, c) => a + c.expected, 0));
      const sb = bc.reduce((a, c) => a + c.bottles, 0);
      ok(so === b.orders, `${tag} ${b.bucket}: sum(byCourier.orders)=${so} === ${b.orders}`);
      ok(se === r2(b.expected), `${tag} ${b.bucket}: sum(byCourier.expected)=${se} === ${r2(b.expected)}`);
      ok(sb === b.bottles, `${tag} ${b.bucket}: sum(byCourier.bottles)=${sb} === ${b.bottles}`);
    } else {
      ok(b.byCourier === undefined, `${tag} ${b.bucket}: TIADA byCourier (bukan COD)`);
    }
  }
}

async function main() {
  const p = getPool();

  // 1) Baldi global (dashboard + page stokis).
  const global = await paymentBucketsImpl();
  console.log("Global buckets:", global.map((b) => `${b.bucket}=${b.orders}`).join(", "));
  assertBuckets("global", global);

  // Jumlah baldi global mesti = set order Completed (tiada order jatuh / berganda).
  const comp = await p.query("SELECT COUNT(*) n, COALESCE(SUM(selling_price),0) e FROM orders WHERE status='Completed'");
  const totalOrders = global.reduce((a, b) => a + b.orders, 0);
  const totalExpected = r2(global.reduce((a, b) => a + b.expected, 0));
  ok(totalOrders === Number(comp.rows[0].n),
    `total orders semua baldi=${totalOrders} === Completed=${comp.rows[0].n}`);
  ok(totalExpected === r2(Number(comp.rows[0].e)),
    `total expected semua baldi=${totalExpected} === SUM(selling_price)=${r2(Number(comp.rows[0].e))}`);

  // 2) Baldi scoped stokis (modal). Pilih stokis dengan order COD paling banyak.
  const seller = (await p.query(`
    SELECT COALESCE(seller_name,'(no stockist)') s, COUNT(*) n
    FROM orders WHERE payment_method='COD' AND status='Completed'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1`)).rows[0]?.s;
  if (seller) {
    const det = await stockistDetail(seller, "0001-01-01", "9999-12-31");
    console.log(`Stockist "${seller}" buckets:`, det.money.buckets.map((b) => `${b.bucket}=${b.orders}`).join(", "));
    assertBuckets(`stkModal(${seller})`, det.money.buckets);
  } else {
    ok(false, "ada stokis COD untuk uji modal");
  }

  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await p.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
