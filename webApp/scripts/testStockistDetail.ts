// Smoke + cross-check stockistDetail atas dev PG. Guna versi *Impl (unstable_cache
// perlu konteks request).  npx tsx scripts/testStockistDetail.ts
import { stockistDetail, stockistBottlesImpl } from "../lib/recon";
import { getPool } from "../lib/db";

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost).");
  process.exit(1);
}

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };

async function main() {
  const rows = await stockistBottlesImpl();
  const top = rows[0];
  console.log(`stokis teratas: ${top.stockist} | jumlah stokis: ${rows.length}`);

  const d = await stockistDetail(top.stockist, "0001-01-01", "9999-12-31");

  console.log(JSON.stringify({
    money: d.money, bottles: d.bottles, status: d.status,
    commission: d.commission, products: d.products.slice(0, 4),
    gifts: { conf: d.gifts.confirmed.slice(0, 3), confirmedCost: d.gifts.confirmedCost, atRiskCost: d.gifts.atRiskCost },
    ordersTotal: d.orders.total, sample: d.orders.rows[0],
  }, null, 2));

  console.log("== cross-check (all-time) vs stockistBottles ==");
  ok(d.bottles.confirmed === top.total_bottles,
    `bottles.confirmed ${d.bottles.confirmed} == stockistBottles.total_bottles ${top.total_bottles}`);
  ok(d.bottles.unconfirmed === top.unconfirmed_bottles,
    `bottles.unconfirmed ${d.bottles.unconfirmed} == stockistBottles.unconfirmed ${top.unconfirmed_bottles}`);
  ok(d.bottles.total === d.bottles.paid + d.bottles.free,
    `bottles.total == paid+free (${d.bottles.total} == ${d.bottles.paid}+${d.bottles.free})`);
  ok(d.money.ordersTotal === d.status.total,
    `money.ordersTotal ${d.money.ordersTotal} == status.total ${d.status.total}`);
  ok(d.status.completed >= 0 && d.status.returnRate >= 0 && d.status.returnRate <= 1,
    `returnRate waras (${(d.status.returnRate * 100).toFixed(1)}%)`);
  ok(d.orders.rows.length <= d.orders.total, "orders.rows <= total");

  // penapis tarikh sempit patut <= all-time
  const narrow = await stockistDetail(top.stockist, "2026-06-01", "2026-06-30");
  ok(narrow.orders.total <= d.orders.total,
    `tarikh sempit (Jun): ${narrow.orders.total} order <= all-time ${d.orders.total}`);
  ok(narrow.bottles.total <= d.bottles.total,
    `tarikh sempit botol ${narrow.bottles.total} <= all-time ${d.bottles.total}`);

  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
