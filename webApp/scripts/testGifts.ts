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
  streamSummaryImpl, skuGiftsListImpl,
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

// Ungkapan conf ditulis SEMULA di sini (bukan import CONF_SQL) supaya oracle
// kekal bebas dari recon.ts; yang diuji ialah matematik agregat, bukan definisi conf.
const ORACLE_SQL = `
  SELECT o.order_id, o.status, os.sku, os.qty,
         CASE WHEN EXISTS (SELECT 1 FROM cod_bill_lines cl WHERE cl.awb = o.tracking)
                OR EXISTS (SELECT 1 FROM prepaid_payments pp WHERE pp.order_ref = o.order_id)
              THEN 1 ELSE 0 END AS conf
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

  // Snapshot sku_gifts sedia ada untuk restore di akhir.
  const giftBackup = (await p.query(
    "SELECT sku, gift_name, unit_cost, qty FROM sku_gifts")).rows;

  // Pilih SKU dinamik (tak bergantung isi backup): skuA = paling banyak order
  // Completed + duit disahkan, skuB = paling banyak order at-risk (kalau ada).
  const confSku = await p.query(`
    SELECT o.status, os.sku,
           CASE WHEN EXISTS (SELECT 1 FROM cod_bill_lines cl WHERE cl.awb = o.tracking)
                  OR EXISTS (SELECT 1 FROM prepaid_payments pp WHERE pp.order_ref = o.order_id)
                THEN 1 ELSE 0 END AS conf
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
  } finally {
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

  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
