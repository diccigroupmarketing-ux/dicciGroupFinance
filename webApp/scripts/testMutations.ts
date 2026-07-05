// Test helper mutasi atas dev PG (port 5433). Self-restoring untuk saveSkuMap;
// resetStore diuji betul, restore selepas via loadDevDb.py (backup = data sama).
//   npx tsx scripts/testMutations.ts
import { saveSkuMap, resetStore, isAdmin } from "../lib/mutations";
// Versi *Impl (tanpa cache) , unstable_cache perlukan konteks request Next.
import { skuMapImpl as skuMap, storeCountsImpl as storeCounts, type SkuRow } from "../lib/recon";
import { getPool } from "../lib/db";

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

  console.log("== resetStore (restore selepas via loadDevDb.py) ==");
  const before = await storeCounts();
  const skuBefore = (await skuMap()).length;
  ok(before.orders > 0, `sebelum reset: ${before.orders} orders`);
  await resetStore();
  const zero = await storeCounts();
  const skuAfter = (await skuMap()).length;
  ok(zero.orders === 0 && zero.billLines === 0 && zero.wallet === 0,
    `selepas reset semua transaksi 0 (orders=${zero.orders} lines=${zero.billLines} wallet=${zero.wallet})`);
  ok(skuAfter === skuBefore, `sku_bottles KEKAL (${skuAfter}, jangka ${skuBefore})`);

  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
