// Ujian lapisan tapis julat tarikh (lib/dateRange.ts + lib/streamRange.ts +
// lib/dashboardRange.ts).
//   npx tsx scripts/testDateRange.ts
//
// Empat bahagian:
//   A. TULEN , tiada DB. Parse julat, sempadan inklusif, baris tanpa tarikh
//      kekal, agregat dikira semula dari baris sintetik.
//   B. SETIA (stream) , atas dev PG. aggregateStream(bundle, ALL_TIME) mesti
//      IDENTIK dengan streamSummaryImpl() enjin, medan demi medan. Ini bukti
//      lapisan tapis cuma "restriction" (tiada julat = tiada perubahan angka),
//      dan bukti enjin recon memang tak diusik.
//   C. TULEN (dashboard) , roll-up semua stream, baldi bayaran, kos gift.
//   D. SETIA (dashboard) , atas dev PG. Versi ALL_TIME setiap lapisan dashboard
//      mesti identik dengan fungsi enjin lama.
//
// Bahagian B dan D baca sahaja (SELECT + tmp table dalam transaksi yang
// di-ROLLBACK), tiada baris ditulis atau dipadam.
import "./reconEnv";
import {
  ALL_TIME, activePreset, parseDateRange, parseYmd, presetRanges, rowInRange,
  streamQuery, ymdOf, type DateRange,
} from "../lib/dateRange";
import {
  aggregateStream, prepaidRowBundle, streamRowBundle,
  type StreamRowBundle, type TmpMRow,
} from "../lib/streamRange";
import {
  aggregateGiftCost, aggregatePayBuckets, giftBundle, payOrderRows, rollupStreams,
  type GiftBundle, type PayOrderRow,
} from "../lib/dashboardRange";
import {
  COURIERS, PREPAID, PrepaidKey, StreamKey,
  giftCostSummaryImpl, paymentBucketsImpl,
  streamPrepaidSummaryImpl, streamSummaryImpl,
  type GiftCostSummary, type PayBucket, type StreamSummary,
} from "../lib/recon";
import { getPool } from "../lib/db";

// GUARD: walaupun read-only, jangan sekali kali tunjuk ke Neon prod dari ujian.
if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost).");
  process.exit(1);
}

let fail = 0;
function ok(cond: boolean, label: string) {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) fail++;
}
function eq(a: unknown, b: unknown, label: string) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(same, same ? label : `${label} , dapat ${JSON.stringify(a)} jangka ${JSON.stringify(b)}`);
}
// Duit dibanding dengan toleransi separuh sen: susunan tambah float TS lawan
// SUM() Postgres boleh beza di digit terakhir, itu bukan divergen logik.
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// ====================================================================
// A. Ujian tulen (tiada DB)
// ====================================================================
function testParsing() {
  console.log("\n--- A1. parse tarikh + julat ---");
  eq(parseYmd("2026-06-01"), "2026-06-01", "tarikh sah diterima");
  eq(parseYmd("2026-02-31"), null, "31 Feb ditolak (bukan tarikh sebenar)");
  eq(parseYmd("2026-13-01"), null, "bulan 13 ditolak");
  eq(parseYmd("bukan tarikh"), null, "sampah ditolak");
  eq(parseYmd(undefined), null, "kosong ditolak");
  eq(ymdOf("2026-06-11 00:00:00"), "2026-06-11", "bahagian masa dibuang");
  eq(ymdOf(null), null, "tiada tarikh -> null");
  eq(ymdOf("11/06/2026"), null, "format lain dilayan macam tiada tarikh");

  eq(parseDateRange(undefined), ALL_TIME, "tiada param = All time");
  eq(parseDateRange({ from: "abc", to: "xyz" }), ALL_TIME, "param sampah = All time");
  eq(parseDateRange({ from: "2026-06-30", to: "2026-06-01" }),
    { from: "2026-06-01", to: "2026-06-30" }, "from > to ditukar tempat");
  eq(parseDateRange({ from: "2026-06-01" }),
    { from: "2026-06-01", to: null }, "julat hujung terbuka dibenarkan");

  console.log("\n--- A2. preset ---");
  const p = presetRanges("2026-06-18");
  eq(p.thisMonth, { from: "2026-06-01", to: "2026-06-30" }, "This month = bulan penuh");
  eq(p.lastMonth, { from: "2026-05-01", to: "2026-05-31" }, "Last month = Mei");
  const jan = presetRanges("2026-01-05");
  eq(jan.lastMonth, { from: "2025-12-01", to: "2025-12-31" }, "Januari -> Last month = Dis tahun lepas");
  const feb = presetRanges("2024-02-10");
  eq(feb.thisMonth, { from: "2024-02-01", to: "2024-02-29" }, "tahun lompat: Feb 29 hari");
  eq(activePreset(ALL_TIME, p), "all", "preset aktif: all");
  eq(activePreset(p.thisMonth, p), "thisMonth", "preset aktif: thisMonth");
  eq(activePreset({ from: "2026-06-03", to: "2026-06-09" }, p), "custom", "preset aktif: custom");

  console.log("\n--- A3. keahlian baris (sempadan INKLUSIF) ---");
  const r: DateRange = { from: "2026-06-01", to: "2026-06-30" };
  ok(rowInRange("2026-06-01", r), "hari pertama julat MASUK");
  ok(rowInRange("2026-06-30", r), "hari terakhir julat MASUK");
  ok(rowInRange("2026-06-30 23:59:59", r), "hujung hari terakhir MASUK (masa diabai)");
  ok(!rowInRange("2026-05-31", r), "sehari sebelum julat keluar");
  ok(!rowInRange("2026-07-01", r), "sehari selepas julat keluar");
  ok(rowInRange(null, r), "baris TANPA tarikh sentiasa masuk");
  ok(rowInRange("", r), "tarikh kosong sentiasa masuk");
  ok(rowInRange("2020-01-01", ALL_TIME), "All time terima semua");
  ok(rowInRange("2026-05-31", { from: null, to: "2026-06-30" }), "hujung terbuka bawah");
  ok(rowInRange("2026-07-31", { from: "2026-06-01", to: null }), "hujung terbuka atas");

  console.log("\n--- A4. query URL ---");
  eq(streamQuery({ grain: undefined, pending: undefined }, ALL_TIME), "",
    "All time + lalai = URL bersih");
  eq(streamQuery({ grain: "monthly" }, { from: "2026-06-01", to: "2026-06-30" }),
    "grain=monthly&from=2026-06-01&to=2026-06-30", "julat + grain dikekalkan");
}

// Bina baris tmp_m sintetik ringkas.
function row(p: Partial<TmpMRow>): TmpMRow {
  return {
    order_id: null, order_date: null, status: "Completed", seller_name: null,
    tracking: null, selling_price: null, awb: null, bill_id: null,
    cod_amount: null, fee: null, delivered_date: null, kategori: "tally",
    ...p,
  };
}

// Bundle sintetik: 3 order berbayar (Mei, 1 Jun, 30 Jun), 1 order belum remit
// (Julai), 1 baris duit hantu TANPA tarikh order, dan 1 pasangan AWB dikongsi
// (dua order padan satu baris bil yang sama).
function fixture(): StreamRowBundle {
  return {
    rows: [
      row({ order_id: "A", order_date: "2026-05-20 10:00:00", seller_name: "Ali",
            awb: "AWB1", bill_id: "B1", cod_amount: 100, fee: 5,
            delivered_date: "2026-05-22", selling_price: 100, kategori: "tally" }),
      row({ order_id: "B", order_date: "2026-06-01 09:00:00", seller_name: "Ali",
            awb: "AWB2", bill_id: "B2", cod_amount: 200, fee: 10,
            delivered_date: "2026-06-03", selling_price: 200, kategori: "tally" }),
      row({ order_id: "C", order_date: "2026-06-30 23:30:00", seller_name: "Siti",
            awb: "AWB3", bill_id: "B2", cod_amount: 300, fee: 15,
            delivered_date: "2026-07-02", selling_price: 300, kategori: "amount_mismatch" }),
      row({ order_id: "D", order_date: "2026-07-05 08:00:00", seller_name: "Siti",
            selling_price: 400, kategori: "belum_remit" }),
      // Duit hantu: baris bil tanpa order, TIADA order_date.
      row({ awb: "AWB9", bill_id: "B2", cod_amount: 90, fee: 4,
            delivered_date: "2026-06-10", kategori: "duit_hantu" }),
      // AWB dikongsi: dua order padan baris bil B3/AWB4 yang SAMA. Duit bil
      // hanya boleh dikira SEKALI.
      row({ order_id: "E1", order_date: "2026-06-15", seller_name: "Ali",
            awb: "AWB4", bill_id: "B3", cod_amount: 50, fee: 2,
            delivered_date: "2026-06-16", selling_price: 50, kategori: "amount_mismatch" }),
      row({ order_id: "E2", order_date: "2026-06-15", seller_name: "Ali",
            awb: "AWB4", bill_id: "B3", cod_amount: 50, fee: 2,
            delivered_date: "2026-06-16", selling_price: 50, kategori: "amount_mismatch" }),
    ],
    bills: [
      { bill_id: "B1", settlement_date: "2026-05-25", source_file: "mei.xlsx" },
      { bill_id: "B2", settlement_date: "2026-06-25", source_file: "jun.xlsx" },
      { bill_id: "B3", settlement_date: "2026-06-28", source_file: "jun.xlsx" },
    ],
    bottlesByOrder: {
      A: { botol: 3, botolFree: 1 }, B: { botol: 6, botolFree: 2 },
      C: { botol: 9, botolFree: 3 },
    },
    otherCourierDays: [
      { courier: "Ninja Van", day: "2026-06-05", orders: 2, value: 150 },
      { courier: "Ninja Van", day: "2026-07-20", orders: 1, value: 60 },
      { courier: "DHL eCommerce", day: null, orders: 1, value: 40 },
    ],
  };
}

function testAggregate() {
  const b = fixture();

  console.log("\n--- A5. All time = semua baris ---");
  const all = aggregateStream(b, ALL_TIME);
  eq(all.katN, { tally: 2, amount_mismatch: 3, belum_remit: 1, duit_hantu: 1 },
    "kiraan kategori penuh");
  eq(all.scopedOrders, 6, "6 baris ada order");
  eq(all.linesN, 5, "5 baris bil UNIK (AWB dikongsi dikira sekali)");
  ok(near(all.linesCod, 740), `COD bil = 740 (dapat ${all.linesCod})`);
  ok(near(all.linesFee, 36), `fi bil = 36 (dapat ${all.linesFee})`);
  eq(all.bills.length, 3, "All time: senarai bil kekal penuh");
  eq(all.undatedRows, 1, "1 baris tanpa tarikh order");
  eq(all.otherCouriers.map((o) => `${o.courier}:${o.orders}`),
    ["DHL eCommerce:1", "Ninja Van:3"], "kurier lain: semua hari");

  console.log("\n--- A6. julat biasa (Jun) ---");
  const jun = aggregateStream(b, { from: "2026-06-01", to: "2026-06-30" });
  eq(jun.katN, { tally: 1, amount_mismatch: 3, duit_hantu: 1 },
    "order Mei & Julai keluar, duit hantu KEKAL");
  eq(jun.scopedOrders, 4, "order dalam Jun sahaja (B, C, E1, E2)");
  eq(jun.undatedRows, 1, "baris tanpa tarikh masih dikira");
  eq(jun.linesN, 4, "baris bil Jun: AWB2, AWB3, AWB9, AWB4");
  ok(near(jun.linesCod, 640), `COD Jun = 640 (dapat ${jun.linesCod})`);
  eq(jun.perBill.map((p) => `${p.bill_id}:${p.parcel}`), ["B2:3", "B3:2"],
    "perBill: B1 (Mei) hilang, B2 kekal 3 baris");
  eq(jun.bills.map((x) => x.bill_id), ["B2", "B3"],
    "senarai bil ikut julat (bil tanpa parcel dalam julat dibuang)");
  eq(jun.otherCouriers.map((o) => `${o.courier}:${o.orders}`),
    ["DHL eCommerce:1", "Ninja Van:2"],
    "kurier lain ditapis; baris tanpa tarikh kekal");
  // Chart ikut delivered_date, tapi HANYA untuk baris yang lulus tapisan order.
  eq(jun.daily.map((d) => d.day), ["2026-06-03", "2026-06-10", "2026-06-16", "2026-07-02"],
    "hari chart = tarikh hantar baris tertapis");
  eq(jun.daily.find((d) => d.day === "2026-06-03")?.botol, 6, "botol ikut order");

  console.log("\n--- A7. sempadan INKLUSIF ---");
  const tepat = aggregateStream(b, { from: "2026-06-01", to: "2026-06-30" });
  ok(tepat.integ.concat(tepat.aged).some((x) => x.order_id === "C")
     || tepat.katN["amount_mismatch"] === 3, "order 30 Jun 23:30 masuk (hujung inklusif)");
  const sehari = aggregateStream(b, { from: "2026-06-01", to: "2026-06-01" });
  eq(sehari.scopedOrders, 1, "julat satu hari = order 1 Jun sahaja");
  eq(sehari.undatedRows, 1, "julat satu hari: duit hantu tetap dipapar");
  const sebelum = aggregateStream(b, { from: "2026-06-02", to: "2026-06-30" });
  eq(sebelum.scopedOrders, 3, "1 Jun keluar bila julat mula 2 Jun");

  console.log("\n--- A8. julat kosong ---");
  const kosong = aggregateStream(b, { from: "2020-01-01", to: "2020-12-31" });
  eq(kosong.scopedOrders, 0, "tiada order dalam julat");
  eq(kosong.katN, { duit_hantu: 1 }, "baris tanpa tarikh KEKAL walau julat kosong");
  eq(kosong.linesN, 1, "baris bil tanpa order kekal dikira");
}

// ====================================================================
// B. Kesetiaan lawan enjin (dev PG)
// ====================================================================
// Susunan kunci objek tak bermakna (enjin pulang ikut urutan GROUP BY), jadi
// normalkan sebelum banding.
function sortKeys(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function cmpSummary(tag: string, mine: StreamSummary, ref: StreamSummary) {
  eq(sortKeys(mine.katN), sortKeys(ref.katN), `[${tag}] katN`);
  eq(Object.keys(mine.katCod).sort(), Object.keys(ref.katCod).sort(), `[${tag}] kunci katCod`);
  ok(Object.keys(ref.katCod).every((k) => near(mine.katCod[k], ref.katCod[k])),
    `[${tag}] nilai katCod`);
  eq(mine.linesN, ref.linesN, `[${tag}] linesN`);
  ok(near(mine.linesCod, ref.linesCod),
    `[${tag}] linesCod (${mine.linesCod} lwn ${ref.linesCod})`);
  ok(near(mine.linesFee, ref.linesFee),
    `[${tag}] linesFee (${mine.linesFee} lwn ${ref.linesFee})`);
  eq(mine.tallyN, ref.tallyN, `[${tag}] tallyN`);
  ok(near(mine.tallyCod, ref.tallyCod), `[${tag}] tallyCod`);
  eq(mine.integN, ref.integN, `[${tag}] integN`);
  ok(near(mine.integRisk, ref.integRisk), `[${tag}] integRisk`);
  eq(mine.agedN, ref.agedN, `[${tag}] agedN`);
  eq(mine.scopedOrders, ref.scopedOrders, `[${tag}] scopedOrders`);
  eq(mine.bills.map((b) => b.bill_id), ref.bills.map((b) => b.bill_id), `[${tag}] senarai bil`);

  eq(mine.daily.map((d) => d.day), ref.daily.map((d) => d.day), `[${tag}] hari chart`);
  ok(ref.daily.every((d, i) => {
    const m = mine.daily[i];
    return m && m.parcel === d.parcel && m.tally === d.tally && m.exception === d.exception
      && m.botol === d.botol && m.botol_free === d.botol_free
      && near(m.cod_dikutip, d.cod_dikutip) && near(m.fee, d.fee);
  }), `[${tag}] nilai harian (parcel/tally/exception/botol/duit)`);

  eq(mine.perBill.map((p) => `${p.bill_id}|${p.parcel}|${p.tally}|${p.exc}`),
    ref.perBill.map((p) => `${p.bill_id}|${p.parcel}|${p.tally}|${p.exc}`),
    `[${tag}] perBill (kiraan)`);
  ok(ref.perBill.every((p, i) => near(mine.perBill[i].cod, p.cod) && near(mine.perBill[i].fee, p.fee)),
    `[${tag}] perBill (duit)`);

  const sk = (rows: { seller: string; kategori: string; n: number }[]) =>
    rows.map((x) => `${x.seller}|${x.kategori}|${x.n}`).sort();
  eq(sk(mine.stokisKat), sk(ref.stokisKat), `[${tag}] stokisKat`);

  const oc = (rows: { courier: string; orders: number }[]) =>
    rows.map((x) => `${x.courier}|${x.orders}`).sort();
  eq(oc(mine.otherCouriers), oc(ref.otherCouriers), `[${tag}] otherCouriers`);

  // Senarai pengecualian: banding sebagai SET (urutan seri tarikh sama tak
  // dijamin oleh Postgres, jadi hanya keahlian yang bermakna).
  const ex = (rows: { order_id: string | null; awb: string | null; kategori: string }[]) =>
    rows.map((x) => `${x.order_id}|${x.awb}|${x.kategori}`).sort();
  eq(ex(mine.integ), ex(ref.integ), `[${tag}] baris integrity`);
  eq(ex(mine.aged), ex(ref.aged), `[${tag}] baris aged`);
  eq(mine.auditPreview.length, ref.auditPreview.length, `[${tag}] saiz audit preview`);
}

async function testFidelity() {
  console.log("\n--- B. All time = output enjin (dev PG) ---");
  for (const key of Object.keys(COURIERS) as StreamKey[]) {
    const [bundle, ref] = await Promise.all([streamRowBundle(key), streamSummaryImpl(key)]);
    cmpSummary(key, aggregateStream(bundle, ALL_TIME), ref);
  }
  for (const key of Object.keys(PREPAID) as PrepaidKey[]) {
    const [bundle, ref] = await Promise.all([
      prepaidRowBundle(key), streamPrepaidSummaryImpl(key),
    ]);
    cmpSummary(key, aggregateStream(bundle, ALL_TIME), ref);
  }

  // Julat separa atas data sebenar: mesti subset (tiada agregat membesar).
  console.log("\n--- B2. julat separa = subset data sebenar ---");
  const key: StreamKey = "jnt";
  const bundle = await streamRowBundle(key);
  const all = aggregateStream(bundle, ALL_TIME);
  const half = aggregateStream(bundle, { from: "2026-06-01", to: "2026-06-30" });
  ok(half.scopedOrders <= all.scopedOrders, "order dalam julat <= semua order");
  ok(half.linesN <= all.linesN, "baris bil dalam julat <= semua baris bil");
  ok(half.linesCod <= all.linesCod + 0.005, "COD dalam julat <= semua COD");
  ok(half.undatedRows <= half.filteredRows, "baris tanpa tarikh sebahagian dari yang lulus");
  const kosong = aggregateStream(bundle, { from: "1999-01-01", to: "1999-12-31" });
  eq(kosong.filteredRows, kosong.undatedRows,
    "julat tanpa order: hanya baris tanpa tarikh yang tinggal");
}

// ====================================================================
// C. Dashboard roll-up , ujian TULEN (tiada DB)
// ====================================================================
// Bundle stream kedua (kurier lain) supaya roll-up ada lebih dari satu sumber.
function fixture2(): StreamRowBundle {
  return {
    rows: [
      row({ order_id: "P", order_date: "2026-06-10", seller_name: "Ali",
            awb: "XA1", bill_id: "C1", cod_amount: 500, fee: 20,
            delivered_date: "2026-06-12", selling_price: 500, kategori: "tally" }),
      row({ order_id: "Q", order_date: "2026-07-10", seller_name: "Siti",
            awb: "XA2", bill_id: "C1", cod_amount: 700, fee: 30,
            delivered_date: "2026-07-12", selling_price: 700, kategori: "duit_masuk_order_returned" }),
    ],
    bills: [{ bill_id: "C1", settlement_date: "2026-07-20", source_file: "c.xlsx" }],
    bottlesByOrder: { P: { botol: 4, botolFree: 0 }, Q: { botol: 8, botolFree: 2 } },
    otherCourierDays: [],
  };
}

function testRollup() {
  console.log("\n--- C1. roll-up dashboard (tulen) ---");
  const a = fixture(), b = fixture2();
  const entries = (r: DateRange) => [
    { key: "jnt", name: "J&T COD", summary: aggregateStream(a, r) },
    { key: "dhl", name: "DHL", summary: aggregateStream(b, r) },
  ];

  const all = rollupStreams(entries(ALL_TIME));
  eq(all.rows.map((x) => x.key), ["jnt", "dhl"], "susunan stream dikekalkan");
  eq(all.totParcels, 5 + 2, "parcel = jumlah baris bil unik semua stream");
  ok(near(all.totCollected, 740 + 1200), `COD roll-up = 1940 (dapat ${all.totCollected})`);
  ok(near(all.totFee, 36 + 50), `fi roll-up = 86 (dapat ${all.totFee})`);
  ok(near(all.totNet, 704 + 1150), `net roll-up = 1854 (dapat ${all.totNet})`);
  eq(all.totExc, 4 + 1, "exception roll-up = jumlah integriti semua stream");
  eq(all.withMoney, 2, "dua stream ada duit");
  eq(all.totBottles, 18 + 12, "botol roll-up = jumlah botol harian semua stream");
  eq(all.undatedRows, 1, "satu baris tanpa tarikh (duit hantu J&T)");
  eq(all.daily.length,
    aggregateStream(a, ALL_TIME).daily.length + aggregateStream(b, ALL_TIME).daily.length,
    "hari chart digabung dari semua stream");

  console.log("\n--- C2. roll-up ikut julat ---");
  const jun = rollupStreams(entries({ from: "2026-06-01", to: "2026-06-30" }));
  ok(jun.totCollected < all.totCollected, "COD julat lebih kecil dari All time");
  ok(near(jun.totCollected, 640 + 500), `COD Jun = 1140 (dapat ${jun.totCollected})`);
  // J&T: 3 amount_mismatch + 1 duit hantu (tanpa tarikh, kekal). Kurier kedua:
  // order Julai (duit masuk order returned) keluar dari julat, jadi 0.
  eq(jun.totExc, 4 + 0, "exception ikut julat (order Julai keluar)");
  eq(jun.rows[1].parcels, 1, "stream kedua tinggal satu parcel dalam Jun");
  eq(jun.undatedRows, 1, "baris tanpa tarikh KEKAL dikira dalam julat");

  const kosong = rollupStreams(entries({ from: "2020-01-01", to: "2020-12-31" }));
  eq(kosong.totParcels, 1, "julat kosong: tinggal baris bil tanpa tarikh order");
  eq(kosong.withMoney, 1, "hanya stream yang ada baris tanpa tarikh kekal");

  console.log("\n--- C3. baldi bayaran (tulen) ---");
  const payRows: PayOrderRow[] = [
    { order_date: "2026-05-20", selling_price: 100, shipping_provider: "J&T", bucket: "confirmed_cod", bottles: 3 },
    { order_date: "2026-06-02", selling_price: 200, shipping_provider: "J&T", bucket: "confirmed_cod", bottles: 6 },
    { order_date: "2026-06-20", selling_price: 300, shipping_provider: "Ninja Van", bucket: "awaiting_cod", bottles: 9 },
    { order_date: "2026-07-01", selling_price: 400, shipping_provider: "J&T", bucket: "awaiting_cod", bottles: 2 },
    { order_date: null, selling_price: 50, shipping_provider: null, bucket: "no_feed", bottles: 1 },
  ];
  const pAll = aggregatePayBuckets(payRows, ALL_TIME);
  eq(pAll.filteredOrders, 5, "All time: semua order Completed");
  eq(pAll.undatedOrders, 1, "satu order tanpa tarikh");
  eq(pAll.buckets.map((x) => `${x.bucket}:${x.orders}`),
    ["confirmed_cod:2", "awaiting_cod:2", "no_feed:1"], "baldi All time ikut susunan enjin");
  ok(near(pAll.buckets[0].expected, 300), "nilai dijangka baldi confirmed");

  const pJun = aggregatePayBuckets(payRows, { from: "2026-06-01", to: "2026-06-30" });
  eq(pJun.buckets.map((x) => `${x.bucket}:${x.orders}`),
    ["confirmed_cod:1", "awaiting_cod:1", "no_feed:1"],
    "baldi ikut julat, order tanpa tarikh KEKAL");
  eq(pJun.undatedOrders, 1, "order tanpa tarikh sentiasa dipapar");
  eq(pJun.buckets[0].bottles, 6, "botol ikut baldi tertapis");
  const cod = pJun.buckets.find((x) => x.bucket === "awaiting_cod");
  eq(cod?.byCourier?.map((c) => `${c.provider}:${c.orders}`), ["Ninja Van:1"],
    "pecahan per kurier hanya kurier dalam julat");
  const pKosong = aggregatePayBuckets(payRows, { from: "2000-01-01", to: "2000-12-31" });
  eq(pKosong.buckets.map((x) => x.bucket), ["no_feed"],
    "julat kosong: tinggal order tanpa tarikh");

  console.log("\n--- C4. kos gift (tulen) ---");
  const gb: GiftBundle = {
    orders: [
      { order_date: "2026-05-10", status: "Completed", conf: 1, gift_cost: 10 },
      { order_date: "2026-06-10", status: "Completed", conf: 1, gift_cost: 20 },
      { order_date: "2026-06-11", status: "Completed", conf: 0, gift_cost: 30 },
      { order_date: "2026-06-12", status: "Returned", conf: 1, gift_cost: 40 },
      { order_date: null, status: "Completed", conf: 1, gift_cost: 5 },
    ],
    types: [
      { order_date: "2026-05-10", status: "Completed", conf: 1, gift_name: "Tumbler", qty: 1, cost: 10 },
      { order_date: "2026-06-10", status: "Completed", conf: 1, gift_name: "Tumbler", qty: 2, cost: 20 },
      { order_date: "2026-06-11", status: "Completed", conf: 0, gift_name: "Beg", qty: 3, cost: 30 },
      { order_date: null, status: "Completed", conf: 1, gift_name: "Beg", qty: 1, cost: 5 },
    ],
    counts: { skuCount: 16, skusWithGifts: 3, giftTypes: 2 },
  };
  const gAll = aggregateGiftCost(gb, ALL_TIME);
  ok(near(gAll.confirmedCost, 35), `kos confirmed All time = 35 (dapat ${gAll.confirmedCost})`);
  ok(near(gAll.atRiskCost, 70), `kos berisiko All time = 70 (dapat ${gAll.atRiskCost})`);
  eq(gAll.byGiftType.map((g) => `${g.gift_name}:${g.qty}`), ["Tumbler:3", "Beg:1"],
    "pecahan gift disusun ikut kos menurun");
  eq(gAll.skuCount, 16, "kiraan katalog bukan angka masa, kekal");

  const gJun = aggregateGiftCost(gb, { from: "2026-06-01", to: "2026-06-30" });
  ok(near(gJun.confirmedCost, 25), `kos confirmed Jun = 20 + 5 tanpa tarikh (dapat ${gJun.confirmedCost})`);
  ok(near(gJun.atRiskCost, 70), "kos berisiko Jun kekal (kedua dua order dalam Jun)");
  eq(gJun.giftsGiven, 3, "unit gift Jun = 2 Tumbler + 1 Beg tanpa tarikh");
  eq(gJun.giftTypes, 2, "jenis gift katalog kekal");
}

// ====================================================================
// D. Kesetiaan dashboard lawan enjin (dev PG)
// ====================================================================
function cmpBuckets(tag: string, mine: PayBucket[], ref: PayBucket[]) {
  eq(mine.map((b) => b.bucket), ref.map((b) => b.bucket), `[${tag}] susunan baldi`);
  eq(mine.map((b) => `${b.bucket}|${b.orders}|${b.bottles}|${b.oldestDays}`),
    ref.map((b) => `${b.bucket}|${b.orders}|${b.bottles}|${b.oldestDays}`),
    `[${tag}] kiraan baldi + aging`);
  ok(ref.every((b, i) => near(mine[i].expected, b.expected)), `[${tag}] nilai dijangka`);
  const bc = (rows: PayBucket[]) => rows.flatMap((b) =>
    (b.byCourier ?? []).map((c) => `${b.bucket}|${c.provider}|${c.orders}|${c.bottles}|${c.oldestDays}`));
  eq(bc(mine), bc(ref), `[${tag}] pecahan per kurier`);
}

function cmpGift(tag: string, mine: GiftCostSummary, ref: GiftCostSummary) {
  ok(near(mine.confirmedCost, ref.confirmedCost),
    `[${tag}] kos confirmed (${mine.confirmedCost} lwn ${ref.confirmedCost})`);
  ok(near(mine.atRiskCost, ref.atRiskCost),
    `[${tag}] kos berisiko (${mine.atRiskCost} lwn ${ref.atRiskCost})`);
  eq(mine.giftsGiven, ref.giftsGiven, `[${tag}] unit gift`);
  eq(mine.giftTypes, ref.giftTypes, `[${tag}] jenis gift`);
  eq(mine.skusWithGifts, ref.skusWithGifts, `[${tag}] SKU bergift`);
  eq(mine.skuCount, ref.skuCount, `[${tag}] jumlah SKU`);
  eq(mine.byGiftType.map((g) => `${g.gift_name}|${g.qty}`),
    ref.byGiftType.map((g) => `${g.gift_name}|${g.qty}`), `[${tag}] pecahan gift`);
  ok(ref.byGiftType.every((g, i) => near(mine.byGiftType[i].cost, g.cost)),
    `[${tag}] kos pecahan gift`);
}

// Stream aktif dashboard (padan ACTIVE dalam app/impact/page.tsx).
const DASH: StreamKey[] = ["jnt", "dhl", "ninja"];

async function testDashboardFidelity() {
  console.log("\n--- D1. roll-up All time = angka dashboard lama (dev PG) ---");
  const bundles = await Promise.all(DASH.map((k) => streamRowBundle(k)));
  const refs = await Promise.all(DASH.map((k) => streamSummaryImpl(k)));
  const mine = rollupStreams(DASH.map((k, i) => ({
    key: k, name: COURIERS[k].name, summary: aggregateStream(bundles[i], ALL_TIME),
  })));
  const ref = rollupStreams(DASH.map((k, i) => ({
    key: k, name: COURIERS[k].name, summary: refs[i],
  })));
  eq(mine.rows.map((r) => `${r.key}|${r.parcels}|${r.exc}|${r.hasBills}`),
    ref.rows.map((r) => `${r.key}|${r.parcels}|${r.exc}|${r.hasBills}`), "baris per stream");
  ok(near(mine.totCollected, ref.totCollected), `totCollected (${mine.totCollected} lwn ${ref.totCollected})`);
  ok(near(mine.totFee, ref.totFee), `totFee (${mine.totFee} lwn ${ref.totFee})`);
  ok(near(mine.totNet, ref.totNet), `totNet (${mine.totNet} lwn ${ref.totNet})`);
  eq(mine.totParcels, ref.totParcels, "totParcels");
  eq(mine.totExc, ref.totExc, "totExc");
  eq(mine.withMoney, ref.withMoney, "withMoney");
  eq(mine.totBottles, ref.totBottles, "totBottles");
  eq(mine.daily.length, ref.daily.length, "bilangan hari chart");

  console.log("\n--- D2. julat separa roll-up = subset ---");
  const jun = rollupStreams(DASH.map((k, i) => ({
    key: k, name: COURIERS[k].name,
    summary: aggregateStream(bundles[i], { from: "2026-06-01", to: "2026-06-30" }),
  })));
  ok(jun.totParcels <= mine.totParcels, "parcel julat <= All time");
  ok(jun.totCollected <= mine.totCollected + 0.005, "COD julat <= All time");
  ok(jun.totBottles <= mine.totBottles, "botol julat <= All time");

  console.log("\n--- D3. baldi bayaran All time = paymentBuckets() enjin ---");
  const [rows, refBuckets] = await Promise.all([payOrderRows(), paymentBucketsImpl()]);
  const pAll = aggregatePayBuckets(rows, ALL_TIME);
  cmpBuckets("buckets", pAll.buckets, refBuckets);
  eq(pAll.filteredOrders, pAll.totalOrders, "All time tak buang apa apa");
  const pJun = aggregatePayBuckets(rows, { from: "2026-06-01", to: "2026-06-30" });
  ok(pJun.filteredOrders <= pAll.filteredOrders, "order julat <= All time");
  ok(pJun.buckets.reduce((a, b) => a + b.orders, 0) <= pAll.buckets.reduce((a, b) => a + b.orders, 0),
    "jumlah baldi julat <= All time");
  const pKosong = aggregatePayBuckets(rows, { from: "1999-01-01", to: "1999-12-31" });
  eq(pKosong.filteredOrders, pKosong.undatedOrders,
    "julat tanpa order: hanya order tanpa tarikh yang tinggal");

  console.log("\n--- D4. kos gift All time = giftCostSummary() enjin ---");
  const [gb, refGift] = await Promise.all([giftBundle(), giftCostSummaryImpl()]);
  cmpGift("gift", aggregateGiftCost(gb, ALL_TIME), refGift);
  const gJun = aggregateGiftCost(gb, { from: "2026-06-01", to: "2026-06-30" });
  ok(gJun.confirmedCost <= refGift.confirmedCost + 0.005, "kos gift julat <= All time");
}

async function main() {
  testParsing();
  testAggregate();
  testRollup();
  await testFidelity();
  await testDashboardFidelity();
  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
