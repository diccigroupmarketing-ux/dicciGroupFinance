// Test helper mutasi atas dev PG (port 5433). Self-restoring untuk saveSkuMap;
// resetStore diuji betul, restore selepas via loadDevDb.py (backup = data sama).
//   npx tsx scripts/testMutations.ts
import { saveSkuMap, addSku, resetStore, saveGifts, isAdmin } from "../lib/mutations";
// Versi *Impl (tanpa cache) , unstable_cache perlukan konteks request Next.
import { skuMapImpl as skuMap, storeCountsImpl as storeCounts, type SkuRow } from "../lib/recon";
import { getPool } from "../lib/db";
import { ensureAppEventsTable } from "../lib/audit";
import { ensureOrderUploadsTable } from "../lib/orderUploadsSchema";
import { ensureBankTable } from "../lib/bank";
import { ensureBillConflictsTable } from "../lib/billConflictsSchema";

// GUARD: resetStore padam semua data. Refuse selain dev PG lokal supaya skrip
// tak boleh terlanjur wipe Neon produksi.
if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost). Skrip ni memadam data.");
  process.exit(1);
}

let fail = 0;
function ok(cond: boolean, label: string) {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) fail++;
}

async function bottlesFor(sku: string): Promise<{ paid: number; free: number } | null> {
  const r = await getPool().query(
    "SELECT paid, free FROM sku_bottles WHERE UPPER(TRIM(sku)) = UPPER(TRIM($1))", [sku]);
  return r.rows[0] ? { paid: Number(r.rows[0].paid), free: Number(r.rows[0].free) } : null;
}

async function countRows(table: string): Promise<number> {
  const r = await getPool().query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return (r.rows[0]?.n as number) ?? 0;
}

// Semai satu baris probe ke tiap jadual era webApp supaya kita boleh sahkan
// resetStore benar benar padam ia (bukan lulus palsu sebab jadual asal kosong).
async function seedProbeRows(): Promise<void> {
  await ensureAppEventsTable();
  await ensureOrderUploadsTable();
  await ensureBankTable();
  await ensureBillConflictsTable();
  await getPool().query(
    `INSERT INTO app_events (event_id, ts, actor, action, detail)
     VALUES ('probe-reset', 'now', 'test', 'probe', 'x')
     ON CONFLICT (event_id) DO NOTHING`);
  await getPool().query(
    `INSERT INTO order_uploads (order_id, source_file, ingested_at)
     VALUES ('probe-reset', 'probe.xlsx', 'now')
     ON CONFLICT (order_id, source_file) DO NOTHING`);
  await getPool().query(
    `INSERT INTO bank_deposits (bill_id, actual_amount, entered_by, updated_at)
     VALUES ('probe-reset', 1, 'test', 'now')
     ON CONFLICT (bill_id) DO NOTHING`);
  await getPool().query(
    `INSERT INTO bill_line_conflicts (awb, bill_id_new, source_file, detected_at)
     VALUES ('probe-reset', 'probe-bill', 'probe.xlsx', 'now')
     ON CONFLICT (awb, bill_id_new) DO NOTHING`);
}

async function main() {
  console.log("== isAdmin ==");
  process.env.ADMIN_EMAILS = "impactdicci@gmail.com, boss@dicci.com";
  ok(isAdmin("impactdicci@gmail.com"), "allowlisted email = admin");
  ok(isAdmin("IMPACTDICCI@GMAIL.COM"), "case-insensitive match");
  ok(!isAdmin("random@x.com"), "outsider != admin");
  ok(!isAdmin(null), "null != admin");
  process.env.ADMIN_EMAILS = "";
  ok(!isAdmin("impactdicci@gmail.com"), "empty ADMIN_EMAILS = nobody admin");

  console.log("== saveSkuMap (self-restoring) ==");
  const original: SkuRow[] = await skuMap();
  ok(original.length === 9, `baseline ${original.length} SKUs (jangka 9)`);

  const edited = original.map((r) =>
    r.sku === "JAG-MY-1" ? { ...r, paid: 5 } : r);
  edited.push({ sku: "test-x", product_name: "Test SKU", paid: 2, free: 1 });
  await saveSkuMap(edited);

  const after = await skuMap();
  ok(after.length === 10, `selepas simpan ${after.length} SKUs (jangka 10)`);
  const jag = after.find((r) => r.sku === "JAG-MY-1");
  ok(jag?.paid === 5, `JAG-MY-1 paid = ${jag?.paid} (jangka 5)`);
  const b = await bottlesFor("TEST-X");
  ok(b?.paid === 2 && b?.free === 1, `join UPPER(TRIM) jumpa test-x paid=${b?.paid} free=${b?.free}`);

  // Tolak input kotor: sku kosong & 'nan' dibuang, negatif -> 0.
  await saveSkuMap([
    ...original,
    { sku: "  ", product_name: "kosong", paid: 3, free: 0 },
    { sku: "nan", product_name: "bkn sku", paid: 1, free: 0 },
    { sku: "NEG-1", product_name: "negatif", paid: -4, free: -2 },
  ]);
  const dirty = await skuMap();
  ok(!dirty.some((r) => r.sku.trim() === "" || r.sku.toLowerCase() === "nan"),
    "sku kosong & 'nan' ditolak");
  const neg = dirty.find((r) => r.sku === "NEG-1");
  ok(neg?.paid === 0 && neg?.free === 0, `negatif dipaksa 0 (paid=${neg?.paid} free=${neg?.free})`);

  await saveSkuMap(original);
  const restored = await skuMap();
  ok(restored.length === 9 && restored.find((r) => r.sku === "JAG-MY-1")?.paid === 1,
    "sku_bottles dipulihkan ke 9 asal");

  console.log("== addSku (tambah satu, additive) ==");
  await addSku({ sku: "gift-new-1", product_name: "Gift New", paid: 3, free: 1 });
  const addl = await skuMap();
  ok(addl.length === 10, `addSku tambah 1 SKU (${addl.length}, jangka 10)`);
  const nb = await bottlesFor("GIFT-NEW-1");
  ok(nb?.paid === 3 && nb?.free === 1, `addSku botol betul (paid=${nb?.paid} free=${nb?.free})`);
  let dupThrew = false;
  try { await addSku({ sku: "GIFT-NEW-1", product_name: "x", paid: 9, free: 9 }); }
  catch { dupThrew = true; }
  ok(dupThrew, "addSku tolak SKU sedia ada (case-insensitive)");
  const nb2 = await bottlesFor("GIFT-NEW-1");
  ok(nb2?.paid === 3, "SKU sedia ada TAK ditimpa bila dup ditolak");
  await saveSkuMap(original);
  ok((await skuMap()).length === 9, "restore ke 9 selepas addSku");

  console.log("== resetStore (restore selepas via loadDevDb.py) ==");
  const before = await storeCounts();
  const skuBefore = (await skuMap()).length;
  ok(before.orders > 0, `sebelum reset: ${before.orders} orders`);
  // Semai probe + config sku_gifts supaya kita sahkan reset padam jadual webApp
  // TAPI kekalkan sku_gifts (config finance, mesti kekal macam sku_bottles).
  await seedProbeRows();
  await saveGifts("JAG-MY-1", [{ gift_name: "probe-gift", unit_cost: 1, qty: 1 }]);
  const giftsBefore = await countRows("sku_gifts");
  ok(giftsBefore > 0, `sebelum reset: ${giftsBefore} sku_gifts (config)`);
  await resetStore();
  const zero = await storeCounts();
  const skuAfter = (await skuMap()).length;
  ok(zero.orders === 0 && zero.billLines === 0 && zero.wallet === 0,
    `selepas reset semua transaksi 0 (orders=${zero.orders} lines=${zero.billLines} wallet=${zero.wallet})`);
  ok(skuAfter === skuBefore, `sku_bottles KEKAL (${skuAfter}, jangka ${skuBefore})`);
  // Jadual era webApp turut dipadam bersih.
  const events = await countRows("app_events");
  const uploads = await countRows("order_uploads");
  const bank = await countRows("bank_deposits");
  const conflicts = await countRows("bill_line_conflicts");
  ok(events === 0 && uploads === 0 && bank === 0 && conflicts === 0,
    `jadual webApp dipadam (app_events=${events} order_uploads=${uploads} bank_deposits=${bank} bill_line_conflicts=${conflicts})`);
  // sku_gifts = config, mesti KEKAL (tak dipadam oleh reset).
  const giftsAfter = await countRows("sku_gifts");
  ok(giftsAfter === giftsBefore, `sku_gifts KEKAL (${giftsAfter}, jangka ${giftsBefore})`);

  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
