// Test invariant free gift atas dev PG (port 5433). Kunci dua janji reka bentuk:
//   (a) SIFAR FAN-OUT: query gift BERASINGAN dari query botol, jadi seed N gift
//       per SKU TAK boleh ubah kiraan botol (stockistBottles + daily botol stream).
//       Regresi klasik: seseorang "optimize" dengan join sku_gifts ke query botol.
//   (b) Kos derive betul: confirmedCost / atRiskCost / byGiftType dibanding dengan
//       oracle bebas (baris mentah orders + order_skus, kira semula dalam JS).
// Self-restoring: snapshot sku_gifts di awal, pulih dalam finally.
//   DATABASE_URL="postgresql://dev:dev@localhost:5433/dicci" npx tsx scripts/testGifts.ts
import { saveGifts } from "../lib/mutations";
import {
  giftCostSummaryImpl, stockistGiftsImpl, stockistBottlesImpl,
  streamSummaryImpl, skuGiftsListImpl, CONF_SQL,
} from "../lib/recon";
import { ensureGiftTable } from "../lib/giftsSchema";
import { getPool } from "../lib/db";

// GUARD: skrip ni tulis/padam sku_gifts. Refuse selain dev PG lokal.
if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost). Skrip ni menulis data.");
  process.exit(1);
}

let fail = 0;
function ok(c: boolean, label: string) {
  console.log((c ? "  PASS " : "  FAIL ") + label);
  if (!c) fail++;
}
// Kos DOUBLE PRECISION, banding dengan toleransi sen.
function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

// Definisi gift seed. qty > 1 sengaja (fan-out paling ketara kalau join salah),
// nama "Ujian Beg" dikongsi dua SKU untuk uji gabungan byGiftType.
interface GiftDef { name: string; cost: number; qty: number; }
const GIFTS_A: GiftDef[] = [
  { name: "Ujian Beg", cost: 3.5, qty: 2 },
  { name: "Ujian Sticker", cost: 0.8, qty: 1 },
];
const GIFTS_B: GiftDef[] = [{ name: "Ujian Beg", cost: 3.5, qty: 1 }];

// Penanda baris cod_bill_lines sintetik kes (c), supaya cleanup boleh sasar
// tepat (termasuk sisa dari run yang mati separuh jalan).
const SYNTH_BILL = "UJIAN-RM0-testGifts";

// ====================================================================
// BACKFILL katalog SKU untuk ujian (penanda sendiri, dibuang dalam finally).
//
// Kenapa perlu: pemilih skuA/skuB di bawah JOIN sku_bottles (katalog SKU),
// sebab kos gift hanya bermakna untuk SKU yang app kenal. Snapshot dev
// (backups/*/sku_bottles.csv) cuma ada 9 SKU lama (JAG-MY-*, KK-JAQ-*, ...),
// sedangkan SEMUA order yang duitnya disahkan dalam snapshot tu duduk atas SKU
// MYSE-* / MYS-*. Hasilnya skuA jatuh pada SKU yang confirmed = 0, jadi assert
// `expConf > 0` gagal dan seluruh cabang "confirmed" (byGiftType, stockistGifts)
// diuji atas sifar , iaitu ujian tanpa gigi.
//
// Kenapa di sini, bukan dalam snapshot backup: sku_bottles snapshot ialah
// baseline berkongsi , testMutations pin `jangka 9` dan NOTA restore dalam
// testAll.mjs sengaja TAK jalankan backfillAutoSkus.py atas sebab sama.
// Jadi backfill ni self-contained: disuntik di awal, dibuang dalam finally.
//
// Nilai paid/free = OUTPUT SEBENAR ingest.derive_bottles() untuk nama SKU tu
// (corak sama yang backfillAutoSkus.py guna), bukan nombor rekaan.
const SYNTH_SKU_NOTE = "UJIAN-testGifts";
interface BottleDef { sku: string; paid: number; free: number; }
const SEED_BOTTLES: BottleDef[] = [
  // Pembawa "confirmed" paling banyak dalam snapshot (jadi calon skuA).
  { sku: "MYSE-JAG-2", paid: 2, free: 0 },
  // Pembawa "at-risk" paling banyak (jadi calon skuB). Dua duanya menang
  // ranking dengan margin lebar, jadi pilihan SKU kekal stabil.
  { sku: "MYS-JAG2-AGM1", paid: 2, free: 1 },
];

// Ungkapan conf GUNA SEMULA CONF_SQL dari recon.ts, bukan salinan tangan.
// Sebab: yang diuji di sini ialah matematik agregat kos gift, BUKAN definisi
// "duit disahkan" (definisi tu ada gate sendiri, parity harness lawan
// reconcile.py). Salinan tangan dulu senyap senyap jadi lebih LONGGAR dari
// enjin (hilang tapisan cod_amount > 0 dan tapisan status/amount prepaid),
// jadi oracle boleh "lulus" sambil mengesahkan benda yang enjin tolak.
// Kes (c) di bawah yang pin makna RM0 tu dengan jangkaan tulis tangan.
const ORACLE_SQL = `
  SELECT o.order_id, o.status, os.sku, os.qty,
         ${CONF_SQL} AS conf
  FROM orders o
  JOIN order_skus os ON os.order_id = o.order_id
  WHERE os.sku = ANY($1)`;

// Jumlah botol dari dua laluan sebenar app: stockistBottles (semua stokis) dan
// daily botol stream J&T. JSON penuh stockistBottles supaya pecahan per stokis
// pun kena identik, bukan sekadar jumlah besar.
async function bottleSnapshot(): Promise<{ stockists: string; daily: string }> {
  const st = await stockistBottlesImpl();
  const jnt = await streamSummaryImpl("jnt");
  const daily = jnt.daily
    .map((d) => `${d.day}:${d.botol}/${d.botol_free}`)
    .join(",");
  return { stockists: JSON.stringify(st), daily };
}

async function main() {
  await ensureGiftTable();
  const p = getPool();

  // Backfill katalog SKU (lihat SEED_BOTTLES). Buang sisa run yang mati dulu,
  // pastu suntik. ON CONFLICT DO NOTHING supaya baris SEBENAR yang dah wujud
  // tak dicop dengan penanda ujian (dan tak dipadam oleh cleanup).
  await p.query("DELETE FROM sku_bottles WHERE product_name = $1", [SYNTH_SKU_NOTE]);
  const bottlesBefore = Number((await p.query(
    "SELECT COUNT(*) AS n FROM sku_bottles")).rows[0].n);
  for (const b of SEED_BOTTLES) {
    await p.query(
      `INSERT INTO sku_bottles (sku, product_name, paid, free) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sku) DO NOTHING`, [b.sku, SYNTH_SKU_NOTE, b.paid, b.free]);
  }
  const seeded = await p.query(
    "SELECT sku FROM sku_bottles WHERE sku = ANY($1)", [SEED_BOTTLES.map((b) => b.sku)]);
  ok(seeded.rowCount === SEED_BOTTLES.length,
    `katalog SKU ujian sedia (${seeded.rowCount}/${SEED_BOTTLES.length} SKU)`);

  // Snapshot sku_gifts sedia ada untuk restore di akhir.
  const giftBackup = (await p.query(
    "SELECT sku, gift_name, unit_cost, qty FROM sku_gifts")).rows;

  // Pilih SKU dinamik (tak bergantung isi backup): skuA = paling banyak order
  // Completed + duit disahkan, skuB = paling banyak order at-risk (kalau ada).
  const confSku = await p.query(`
    SELECT o.status, os.sku, ${CONF_SQL} AS conf
    FROM orders o
    JOIN order_skus os ON os.order_id = o.order_id
    JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku`);
  const bySku = new Map<string, { conf: number; risk: number }>();
  for (const r of confSku.rows) {
    const e = bySku.get(r.sku) ?? { conf: 0, risk: 0 };
    if (r.status === "Completed" && Number(r.conf) === 1) e.conf++;
    else if (["Returned", "Rejected"].includes(r.status) ||
             (r.status === "Completed" && Number(r.conf) === 0)) e.risk++;
    bySku.set(r.sku, e);
  }
  const ranked = [...bySku.entries()];
  const skuA = ranked.sort((x, y) => y[1].conf - x[1].conf)[0]?.[0];
  const skuB = ranked.filter(([s]) => s !== skuA)
    .sort((x, y) => y[1].risk - x[1].risk)[0]?.[0];
  ok(!!skuA && !!skuB, `SKU ujian dipilih: A=${skuA} B=${skuB}`);
  if (!skuA || !skuB) throw new Error("dev DB tak cukup data SKU untuk ujian");

  console.log("== (a) sifar fan-out botol ==");
  const before = await bottleSnapshot();

  try {
    // Kosongkan sku_gifts supaya kos = gift seed SAHAJA (oracle mudah tepat).
    await p.query("DELETE FROM sku_gifts");

    // Seed via saveGifts sebenar; skuA sengaja lowercase, uji laluan UPPER(TRIM).
    await saveGifts(skuA.toLowerCase(), GIFTS_A.map((g) =>
      ({ gift_name: g.name, unit_cost: g.cost, qty: g.qty })));
    await saveGifts(skuB, GIFTS_B.map((g) =>
      ({ gift_name: g.name, unit_cost: g.cost, qty: g.qty })));

    const after = await bottleSnapshot();
    ok(after.stockists === before.stockists,
      "stockistBottles IDENTIK selepas seed gift (sifar fan-out)");
    ok(after.daily === before.daily,
      "daily botol stream J&T IDENTIK selepas seed gift");

    console.log("== (b) kos derive lawan oracle ==");
    // Oracle: baris mentah untuk 2 SKU ujian, kira semula dalam JS.
    const defs = new Map<string, GiftDef[]>([[skuA, GIFTS_A], [skuB, GIFTS_B]]);
    const costPerUnit = (sku: string) =>
      (defs.get(sku) ?? []).reduce((a, g) => a + g.cost * g.qty, 0);
    const raw = await p.query(ORACLE_SQL, [[skuA, skuB]]);
    const perOrder = new Map<string, { status: string; conf: number; gc: number }>();
    for (const r of raw.rows) {
      const e = perOrder.get(r.order_id) ??
        { status: r.status, conf: Number(r.conf), gc: 0 };
      e.gc += Number(r.qty) * costPerUnit(r.sku);
      perOrder.set(r.order_id, e);
    }
    let expConf = 0, expRisk = 0, expGiven = 0;
    const expByType = new Map<string, { qty: number; cost: number }>();
    for (const o of perOrder.values()) {
      const isConf = o.status === "Completed" && o.conf === 1;
      if (isConf) expConf += o.gc;
      else if (["Returned", "Rejected"].includes(o.status) ||
               (o.status === "Completed" && o.conf === 0)) expRisk += o.gc;
    }
    for (const r of raw.rows) {
      const o = perOrder.get(r.order_id)!;
      if (!(o.status === "Completed" && o.conf === 1)) continue;
      for (const g of defs.get(r.sku) ?? []) {
        const t = expByType.get(g.name) ?? { qty: 0, cost: 0 };
        t.qty += Number(r.qty) * g.qty;
        t.cost += Number(r.qty) * g.qty * g.cost;
        expByType.set(g.name, t);
        expGiven += Number(r.qty) * g.qty;
      }
    }
    ok(expConf > 0, `oracle ada kos confirmed (RM${r2(expConf)})`);
    if (expRisk === 0) console.log("  NOTA: tiada order at-risk untuk SKU ujian, banding tetap dibuat (0 = 0)");

    const sum = await giftCostSummaryImpl();
    ok(approx(sum.confirmedCost, expConf),
      `confirmedCost ${r2(sum.confirmedCost)} = oracle ${r2(expConf)}`);
    ok(approx(sum.atRiskCost, expRisk),
      `atRiskCost ${r2(sum.atRiskCost)} = oracle ${r2(expRisk)}`);
    ok(sum.giftsGiven === expGiven, `giftsGiven ${sum.giftsGiven} = oracle ${expGiven}`);
    ok(sum.skusWithGifts === 2, `skusWithGifts = ${sum.skusWithGifts} (jangka 2)`);
    ok(sum.giftTypes === 2, `giftTypes = ${sum.giftTypes} (jangka 2, nama dikongsi digabung)`);
    for (const [name, t] of expByType) {
      const got = sum.byGiftType.find((g) => g.gift_name === name);
      ok(!!got && got.qty === t.qty && approx(got.cost, t.cost),
        `byGiftType '${name}' qty=${got?.qty}/${t.qty} cost=${r2(got?.cost ?? -1)}/${r2(t.cost)}`);
    }

    // skuGiftsList: costPerUnit skuA = 2 x 3.50 + 1 x 0.80 = 7.80.
    const list = await skuGiftsListImpl();
    const a = list.find((s) => s.sku.toUpperCase().trim() === skuA);
    ok(!!a && approx(a.costPerUnit, 7.8) && a.gifts.length === 2,
      `skuGiftsList costPerUnit skuA = ${a?.costPerUnit} (jangka 7.8, 2 gift)`);

    // Cross-invariant: stockistGifts (confirmed) mesti jumlah balik ke summary.
    const sg = await stockistGiftsImpl();
    const sgCost = sg.reduce((x, g) => x + g.cost, 0);
    const sgQty = sg.reduce((x, g) => x + g.qty, 0);
    ok(approx(sgCost, sum.confirmedCost),
      `sum stockistGifts cost ${r2(sgCost)} = confirmedCost ${r2(sum.confirmedCost)}`);
    ok(sgQty === sum.giftsGiven, `sum stockistGifts qty ${sgQty} = giftsGiven ${sum.giftsGiven}`);

    // ================================================================
    // (c) Baris bil RM0 BUKAN bukti duit masuk.
    // Snapshot dev takde langsung baris cod_amount 0/null/negatif, jadi (b)
    // di atas takkan nampak beza walaupun oracle terlepas tapisan
    // cod_amount > 0. Kes ni CIPTA baris tu sendiri (contoh sebenar: caj
    // "Returned to Sender" Ninja Van, bil ada, duit tak ada) dan kunci
    // maksudnya dengan jangkaan tulis tangan.
    // ================================================================
    console.log("== (c) baris bil RM0 bukan duit masuk ==");
    const oracleConf = async (orderId: string): Promise<number[]> => {
      const rs = await p.query(ORACLE_SQL, [[skuA, skuB]]);
      return rs.rows.filter((r) => r.order_id === orderId).map((r) => Number(r.conf));
    };
    // Calon: order Completed ber-gift yang BELUM ada apa apa bukti duit, dan
    // AWB dia belum wujud dalam cod_bill_lines (awb = PK, elak timpa data dev).
    const cand = await p.query(`
      SELECT o.order_id, o.tracking
      FROM orders o
      JOIN order_skus os ON os.order_id = o.order_id
      WHERE o.status = 'Completed' AND os.sku = ANY($1)
        AND o.tracking IS NOT NULL AND TRIM(o.tracking) <> ''
        AND (${CONF_SQL}) = 0
        AND NOT EXISTS (SELECT 1 FROM cod_bill_lines cl WHERE cl.awb = o.tracking)
      LIMIT 1`, [[skuA, skuB]]);
    ok(cand.rowCount === 1, "ada order Completed tanpa bukti duit untuk suntik baris ujian");
    if (cand.rowCount === 1) {
      const candId = cand.rows[0].order_id as string;
      const synthAwb = cand.rows[0].tracking as string;
      const base = await giftCostSummaryImpl();

      await p.query(
        `INSERT INTO cod_bill_lines (awb, bill_id, cod_amount, fee, source_file)
         VALUES ($1, $2, 0, 0, 'testGifts.ts')`, [synthAwb, SYNTH_BILL]);
      ok((await oracleConf(candId)).every((c) => c === 0),
        "oracle: baris bil RM0 TIDAK mengesahkan duit (conf kekal 0)");
      const zero = await giftCostSummaryImpl();
      ok(approx(zero.confirmedCost, base.confirmedCost) &&
         approx(zero.atRiskCost, base.atRiskCost),
        `kos gift TAK berubah oleh baris RM0 (confirmed ${r2(zero.confirmedCost)}, at-risk ${r2(zero.atRiskCost)})`);

      // Kawalan (bukti ujian atas ni ada gigi): baris SAMA dinaikkan jadi RM50
      // mesti FLIP order tu jadi confirmed. Tanpa ni, "tiada perubahan" boleh
      // jadi sekadar kerana order calon memang tak menyumbang kos gift.
      await p.query("UPDATE cod_bill_lines SET cod_amount = 50 WHERE awb = $1", [synthAwb]);
      ok((await oracleConf(candId)).every((c) => c === 1),
        "oracle: baris bil RM50 MENGESAHKAN duit (conf jadi 1)");
      const paid = await giftCostSummaryImpl();
      ok(paid.confirmedCost > base.confirmedCost + 0.005 &&
         paid.atRiskCost < base.atRiskCost - 0.005,
        `kos gift berpindah at-risk -> confirmed bila duit betul masuk ` +
        `(confirmed ${r2(base.confirmedCost)} -> ${r2(paid.confirmedCost)}, ` +
        `at-risk ${r2(base.atRiskCost)} -> ${r2(paid.atRiskCost)})`);
    }
  } finally {
    // Buang baris bil sintetik (ikut bill_id, jadi sisa run yang crash pun kena).
    await p.query("DELETE FROM cod_bill_lines WHERE bill_id = $1", [SYNTH_BILL]);
    // Buang backfill katalog SKU (ikut penanda product_name, jadi baris sebenar
    // dengan sku sama TAK tersentuh).
    await p.query("DELETE FROM sku_bottles WHERE product_name = $1", [SYNTH_SKU_NOTE]);
    // Pulihkan sku_gifts asal walau ujian gagal separuh jalan.
    await p.query("DELETE FROM sku_gifts");
    for (const g of giftBackup) {
      await p.query(
        "INSERT INTO sku_gifts (sku, gift_name, unit_cost, qty) VALUES ($1, $2, $3, $4)",
        [g.sku, g.gift_name, g.unit_cost, g.qty]);
    }
  }
  const restored = await p.query("SELECT COUNT(*) AS n FROM sku_gifts");
  ok(Number(restored.rows[0].n) === giftBackup.length,
    `sku_gifts dipulihkan (${restored.rows[0].n} baris, jangka ${giftBackup.length})`);
  const bottlesAfter = Number((await p.query(
    "SELECT COUNT(*) AS n FROM sku_bottles")).rows[0].n);
  ok(bottlesAfter === bottlesBefore,
    `sku_bottles dipulihkan (${bottlesAfter} baris, jangka ${bottlesBefore})`);

  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
