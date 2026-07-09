// Test uploadedFiles + deleteUpload atas dev PG (port 5433). MEMADAM data,
// restore selepas via loadDevDb.py + backfillAutoSkus.py.
//   DATABASE_URL=postgresql://dev:dev@localhost:5433/dicci npx tsx scripts/testUploads.ts
import { deleteUpload } from "../lib/mutations";
import { uploadedFiles, stockistDetail } from "../lib/recon";
import { getPool } from "../lib/db";

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost). Skrip ni memadam data.");
  process.exit(1);
}

let fail = 0;
function ok(cond: boolean, label: string) {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) fail++;
}

async function main() {
  const pool = getPool();

  // 1) Senarai fail
  const files = await uploadedFiles();
  console.log("uploadedFiles:", files.map((f) => `${f.kind}:${f.file} (${f.rows})`));
  const ordersFile = files.find((f) => f.kind === "orders");
  const codFile = files.find((f) => f.kind === "cod");
  ok(!!ordersFile, "ada fail orders");
  ok(!!codFile, "ada fail cod");
  if (!ordersFile || !codFile) process.exit(1);

  // 2) Popup stokis: unmappedSkus keluar bila mapping hilang
  const sb = await pool.query("SELECT sku, product_name, paid, free FROM sku_bottles LIMIT 1");
  const victim = sb.rows[0];
  await pool.query("DELETE FROM sku_bottles WHERE sku = $1", [victim.sku]);
  const who = await pool.query(
    `SELECT COALESCE(o.seller_name, '(no stockist)') AS s FROM orders o
     JOIN order_skus os ON os.order_id = o.order_id
     WHERE os.sku = UPPER(TRIM($1)) LIMIT 1`, [victim.sku]);
  if (who.rows.length) {
    const d = await stockistDetail(who.rows[0].s, "0001-01-01", "9999-12-31");
    ok(d.unmappedSkus.includes(victim.sku.toUpperCase().trim()),
      `stockistDetail laporkan '${victim.sku}' unmapped untuk ${who.rows[0].s}`);
  } else {
    console.log("  SKIP: tiada order guna SKU mangsa");
  }
  await pool.query(
    `INSERT INTO sku_bottles (sku, product_name, paid, free) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sku) DO NOTHING`,
    [victim.sku, victim.product_name, victim.paid, victim.free]);

  // 3) Padam fail cod: baris bil hilang, orders tak disentuh
  const before = {
    lines: Number((await pool.query("SELECT COUNT(*) n FROM cod_bill_lines")).rows[0].n),
    orders: Number((await pool.query("SELECT COUNT(*) n FROM orders")).rows[0].n),
  };
  const r1 = await deleteUpload(codFile.file);
  ok(r1.billLines === codFile.rows, `padam cod: ${r1.billLines} baris = ${codFile.rows} dijangka`);
  ok(r1.orders === 0, "padam cod: orders tak disentuh");
  const afterLines = Number((await pool.query("SELECT COUNT(*) n FROM cod_bill_lines")).rows[0].n);
  ok(afterLines === before.lines - codFile.rows, "kiraan cod_bill_lines betul");
  const list2 = await uploadedFiles();
  ok(!list2.some((f) => f.file === codFile.file && f.kind === "cod"), "fail cod hilang dari senarai");

  // 4) Padam fail orders: orders + order_skus ikut sekali
  const r2 = await deleteUpload(ordersFile.file);
  ok(r2.orders === ordersFile.rows, `padam orders: ${r2.orders} = ${ordersFile.rows} dijangka`);
  ok(r2.orderSkus > 0, `order_skus ikut terpadam (${r2.orderSkus})`);
  const leftSkus = Number((await pool.query("SELECT COUNT(*) n FROM order_skus")).rows[0].n);
  const leftOrders = Number((await pool.query("SELECT COUNT(*) n FROM orders")).rows[0].n);
  ok(leftOrders === before.orders - ordersFile.rows, "kiraan orders betul");
  ok(leftSkus === 0 || leftOrders > 0, "tiada order_skus yatim");

  // 5) Fail tak wujud: 0 baris, tak throw
  const r3 = await deleteUpload("failTakWujud.xlsx");
  ok(r3.total === 0, "fail tak wujud = 0 baris");

  console.log(fail ? `\n${fail} GAGAL` : "\nSEMUA PASS");
  console.log("NOTA: dev DB dah diubah. Restore: python3 scripts/loadDevDb.py + backfillAutoSkus.py");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
