// Ujian lapisan tapis julat tarikh untuk page "Not collected"
// (lib/uncollectedRange.ts).
//   npx tsx scripts/testUncollectedRange.ts
//
// Dua bahagian:
//   A. TULEN , tiada DB. Tapisan atas bundle sintetik: All time kekal penuh,
//      julat sempit betul betul kurangkan baris DAN kira semula agregat, baris
//      tanpa tarikh tak pernah hilang senyap, baris ghost tak pernah ditapis,
//      dan kategori + umur (aging) tak pernah disentuh oleh julat.
//   B. SETIA , atas dev PG. aggregateUncollected(bundle, ALL_TIME) mesti IDENTIK
//      dengan uncollectedCourier()/ghostPrepaid() enjin, medan demi medan. Ini
//      bukti lapisan tapis cuma "restriction" (tiada julat = tiada perubahan
//      angka), dan bukti enjin recon memang tak diusik.
//
// Bahagian B baca sahaja (SELECT + tmp table dalam transaksi yang di-ROLLBACK),
// tiada baris ditulis atau dipadam.
import "./reconEnv";
import { ALL_TIME, type DateRange } from "../lib/dateRange";
import {
  aggregateUncollected, ghostPrepaidRowBundle, uncollectedRowBundle,
  type UncollectedRowBundle,
} from "../lib/uncollectedRange";
import {
  COURIERS, EXC_CAP, PREPAID, PrepaidKey, REMIT_PENDING_DAYS, StreamKey,
  ghostPrepaid, uncollectedCourier,
  type GhostRow, type NotCollectedRow, type UncollectedStream,
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

const JUN: DateRange = { from: "2026-06-01", to: "2026-06-30" };

// ====================================================================
// A. Ujian tulen (tiada DB)
// ====================================================================
function nc(p: Partial<NotCollectedRow>): NotCollectedRow {
  return {
    order_id: null, order_date: null, seller_name: null, tracking: null,
    kategori: "hilang_lewat", selling_price: null, umur_hari: null,
    courier: "J&T", streamKey: "jnt", source_file: null, ...p,
  };
}
function gh(p: Partial<GhostRow>): GhostRow {
  return {
    awb: null, cod_amount: null, bill_id: null, settlement_date: null,
    source_file: null, courier: "J&T", streamKey: "jnt", ...p,
  };
}

// Bundle sintetik: 2 order lewat (Mei + Jun), 2 order belum remit (Jun +
// Julai), 1 order lewat TANPA tarikh order (feed tiada tarikh), dan 2 baris
// ghost (satu bertarikh bil Mei, satu tanpa tarikh langsung).
function fixture(): UncollectedRowBundle {
  return {
    streamKey: "jnt", courier: "J&T Express",
    notCollected: [
      nc({ order_id: "A", order_date: "2026-05-20 10:00:00", selling_price: 100,
           umur_hari: 29, kategori: "hilang_lewat" }),
      nc({ order_id: "B", order_date: "2026-06-01 09:00:00", selling_price: 200,
           umur_hari: 17, kategori: "hilang_lewat" }),
      nc({ order_id: "C", order_date: "2026-06-30 23:30:00", selling_price: 300,
           umur_hari: 2, kategori: "belum_remit" }),
      nc({ order_id: "D", order_date: "2026-07-05 08:00:00", selling_price: 400,
           umur_hari: 1, kategori: "belum_remit" }),
      // Order tanpa tarikh dalam feed: tak boleh diletak dalam masa, jadi kekal.
      nc({ order_id: "E", order_date: null, selling_price: 50, umur_hari: null,
           kategori: "hilang_lewat" }),
    ],
    ghost: [
      gh({ awb: "AWB9", cod_amount: 90, bill_id: "B1", settlement_date: "2026-05-25" }),
      gh({ awb: "AWB8", cod_amount: 10, bill_id: "B2", settlement_date: null }),
    ],
  };
}

function testPure() {
  const b = fixture();

  console.log("\n--- A1. All time = semua baris, agregat penuh ---");
  const all = aggregateUncollected(b, ALL_TIME);
  eq(all.overdueN, 3, "overdue All time = 3 (A, B, E)");
  ok(near(all.overdueValue, 350), `nilai overdue = 350 (dapat ${all.overdueValue})`);
  eq(all.awaitingN, 2, "awaiting All time = 2 (C, D)");
  ok(near(all.awaitingValue, 700), `nilai awaiting = 700 (dapat ${all.awaitingValue})`);
  eq(all.ghostN, 2, "ghost All time = 2 baris");
  ok(near(all.ghostValue, 100), `nilai ghost = 100 (dapat ${all.ghostValue})`);
  eq(all.overdueRows.map((r) => r.order_id), ["A", "B", "E"],
    "senarai overdue susun ikut tarikh, baris tanpa tarikh di hujung");
  eq(all.awaitingRows.map((r) => r.order_id), ["C", "D"], "senarai awaiting");
  eq(all.totalRows, 7, "7 baris mentah (5 belum kutip + 2 ghost)");
  eq(all.filteredRows, 7, "All time tak buang apa apa");
  eq(all.undatedNotCollected, 1, "1 order tanpa tarikh");
  eq(all.undatedGhost, 2, "semua baris ghost dikira tanpa tarikh order");
  eq(all.undatedRows, 3, "jumlah item tanpa tarikh order");
  eq(all.capped, false, "data kecil, tiada cap");

  console.log("\n--- A2. julat sempit BETUL BETUL kurangkan baris + agregat ---");
  const jun = aggregateUncollected(b, JUN);
  eq(jun.overdueRows.map((r) => r.order_id), ["B", "E"],
    "order Mei keluar, order tanpa tarikh KEKAL");
  eq(jun.awaitingRows.map((r) => r.order_id), ["C"], "order Julai keluar");
  eq(jun.overdueN, 2, "overdueN dikira SEMULA (3 -> 2), bukan angka asal");
  ok(near(jun.overdueValue, 250), `nilai overdue Jun = 250 (dapat ${jun.overdueValue})`);
  eq(jun.awaitingN, 1, "awaitingN dikira semula (2 -> 1)");
  ok(near(jun.awaitingValue, 300), `nilai awaiting Jun = 300 (dapat ${jun.awaitingValue})`);
  ok(jun.overdueN < all.overdueN && jun.awaitingN < all.awaitingN,
    "julat sempit < All time untuk kedua dua baldi");
  eq(jun.overdueN, jun.overdueRows.length, "kiraan padan senarai yang dipapar");
  eq(jun.awaitingN, jun.awaitingRows.length, "kiraan awaiting padan senarai");
  eq(jun.filteredRows, 5, "3 baris belum kutip + 2 ghost lulus");
  eq(jun.totalRows, all.totalRows, "totalRows = jumlah mentah, tak berubah");

  console.log("\n--- A3. sempadan INKLUSIF ---");
  eq(aggregateUncollected(b, { from: "2026-06-01", to: "2026-06-01" })
    .overdueRows.map((r) => r.order_id), ["B", "E"], "hari pertama julat MASUK");
  eq(aggregateUncollected(b, { from: "2026-06-30", to: "2026-06-30" })
    .awaitingRows.map((r) => r.order_id), ["C"],
    "order 30 Jun 23:30 masuk (bahagian masa diabai)");
  eq(aggregateUncollected(b, { from: "2026-06-02", to: "2026-06-30" })
    .overdueRows.map((r) => r.order_id), ["E"], "1 Jun keluar bila julat mula 2 Jun");
  eq(aggregateUncollected(b, { from: "2026-06-01", to: null }).awaitingN, 2,
    "julat hujung terbuka atas");

  console.log("\n--- A4. baris tanpa tarikh TAK hilang senyap ---");
  const kosong = aggregateUncollected(b, { from: "2020-01-01", to: "2020-12-31" });
  eq(kosong.overdueRows.map((r) => r.order_id), ["E"],
    "julat kosong: order tanpa tarikh KEKAL dipapar");
  eq(kosong.overdueN, 1, "kiraan ikut baris yang tinggal");
  eq(kosong.awaitingN, 0, "tiada awaiting dalam julat kosong");
  eq(kosong.filteredRows, kosong.undatedRows,
    "julat tanpa order: hanya item tanpa tarikh yang tinggal");

  console.log("\n--- A5. Ghost money TAK PERNAH ditapis (keputusan design) ---");
  for (const r of [ALL_TIME, JUN, { from: "2020-01-01", to: "2020-12-31" }] as DateRange[]) {
    const x = aggregateUncollected(b, r);
    eq(x.ghostRows.map((g) => g.awb), ["AWB9", "AWB8"],
      `ghost penuh untuk julat ${JSON.stringify(r)}`);
    eq(x.ghostN, 2, "ghostN kekal penuh");
    ok(near(x.ghostValue, 100), "nilai ghost kekal penuh");
    eq(x.undatedGhost, x.ghostN, "setiap baris ghost dikira sebagai tanpa tarikh");
  }
  // Baris ghost yang tarikh BILnya dalam Mei tak dibuang oleh julat Jun: bukti
  // kita tak diam diam tukar makna kawalan jadi tarikh bil.
  ok(aggregateUncollected(b, JUN).ghostRows.some((g) => g.awb === "AWB9"),
    "ghost bertarikh bil Mei kekal dalam julat Jun (tapis ikut tarikh ORDER)");

  console.log("\n--- A6. aging (RECON_TODAY + ambang) TAK disentuh julat ---");
  const byId = (x: { overdueRows: NotCollectedRow[]; awaitingRows: NotCollectedRow[] }) =>
    Object.fromEntries([...x.overdueRows, ...x.awaitingRows]
      .map((r) => [r.order_id, `${r.kategori}|${r.umur_hari}`]));
  const mAll = byId(all), mJun = byId(jun);
  ok(Object.keys(mJun).every((k) => mJun[k] === mAll[k]),
    "kategori + umur setiap baris identik dalam julat dan All time");
  eq(mJun["B"], "hilang_lewat|17", "order lewat kekal lewat walau julat sempit");
  eq(mJun["C"], "belum_remit|2", "order belum remit kekal belum remit");

  console.log("\n--- A7. gateway prepaid: ghost sahaja ---");
  const pre = aggregateUncollected(
    { streamKey: "chip", courier: "CHIP", notCollected: [], ghost: b.ghost }, JUN);
  eq(pre.overdueN + pre.awaitingN, 0, "prepaid tiada aging, tiada overdue/awaiting");
  eq(pre.ghostN, 2, "ghost prepaid kekal penuh dalam julat");
}

// ====================================================================
// B. Kesetiaan lawan enjin (dev PG)
// ====================================================================
function cmpStream(tag: string, mine: UncollectedStream, ref: UncollectedStream) {
  eq(mine.streamKey, ref.streamKey, `[${tag}] streamKey`);
  eq(mine.courier, ref.courier, `[${tag}] label kurier`);
  eq(mine.overdueN, ref.overdueN, `[${tag}] overdueN`);
  ok(near(mine.overdueValue, ref.overdueValue),
    `[${tag}] overdueValue (${mine.overdueValue} lwn ${ref.overdueValue})`);
  eq(mine.awaitingN, ref.awaitingN, `[${tag}] awaitingN`);
  ok(near(mine.awaitingValue, ref.awaitingValue),
    `[${tag}] awaitingValue (${mine.awaitingValue} lwn ${ref.awaitingValue})`);
  eq(mine.ghostN, ref.ghostN, `[${tag}] ghostN`);
  ok(near(mine.ghostValue, ref.ghostValue),
    `[${tag}] ghostValue (${mine.ghostValue} lwn ${ref.ghostValue})`);
  eq(mine.capped, ref.capped, `[${tag}] bendera capped`);

  // Senarai baris: banding sebagai SET (urutan seri tarikh sama tak dijamin
  // oleh Postgres, jadi hanya keahlian yang bermakna). Bila data melebihi cap,
  // set memang boleh beza di sempadan, jadi cuma saiz yang dibanding.
  const ncSet = (rows: NotCollectedRow[]) =>
    rows.map((r) => `${r.order_id}|${r.kategori}|${r.umur_hari}|${r.selling_price}`).sort();
  const ghSet = (rows: GhostRow[]) =>
    rows.map((r) => `${r.awb}|${r.bill_id}|${r.cod_amount}`).sort();
  if (ref.capped) {
    eq(mine.overdueRows.length + mine.awaitingRows.length,
      ref.overdueRows.length + ref.awaitingRows.length, `[${tag}] saiz senarai (dicap)`);
    eq(mine.ghostRows.length, ref.ghostRows.length, `[${tag}] saiz senarai ghost (dicap)`);
  } else {
    eq(ncSet(mine.overdueRows), ncSet(ref.overdueRows), `[${tag}] baris overdue`);
    eq(ncSet(mine.awaitingRows), ncSet(ref.awaitingRows), `[${tag}] baris awaiting`);
    eq(ghSet(mine.ghostRows), ghSet(ref.ghostRows), `[${tag}] baris ghost`);
  }
}

async function testFidelity() {
  console.log("\n--- B1. All time = output enjin (dev PG) ---");
  const courierKeys = Object.keys(COURIERS) as StreamKey[];
  const prepaidKeys = Object.keys(PREPAID) as PrepaidKey[];
  for (const key of courierKeys) {
    const [bundle, ref] = await Promise.all([
      uncollectedRowBundle(key, REMIT_PENDING_DAYS),
      uncollectedCourier(key, REMIT_PENDING_DAYS),
    ]);
    cmpStream(key, aggregateUncollected(bundle, ALL_TIME), ref);
  }
  for (const key of prepaidKeys) {
    const [bundle, ref] = await Promise.all([
      ghostPrepaidRowBundle(key), ghostPrepaid(key),
    ]);
    cmpStream(key, aggregateUncollected(bundle, ALL_TIME), ref);
  }

  console.log("\n--- B2. ambang aging lain (7 hari) pun setia ---");
  const [b7, ref7] = await Promise.all([
    uncollectedRowBundle("jnt", 7), uncollectedCourier("jnt", 7),
  ]);
  cmpStream("jnt@7d", aggregateUncollected(b7, ALL_TIME), ref7);

  console.log("\n--- B3. julat separa = subset data sebenar ---");
  const bundle = await uncollectedRowBundle("jnt", REMIT_PENDING_DAYS);
  const all = aggregateUncollected(bundle, ALL_TIME);
  const jun = aggregateUncollected(bundle, JUN);
  ok(jun.overdueN <= all.overdueN, "overdue julat <= All time");
  ok(jun.awaitingN <= all.awaitingN, "awaiting julat <= All time");
  ok(jun.overdueValue <= all.overdueValue + 0.005, "nilai overdue julat <= All time");
  ok(jun.filteredRows <= all.filteredRows, "baris lulus julat <= All time");
  eq(jun.ghostN, all.ghostN, "ghost tak ditapis oleh julat (data sebenar)");
  ok(near(jun.ghostValue, all.ghostValue), "nilai ghost tak berubah oleh julat");
  ok(jun.undatedRows <= jun.filteredRows, "item tanpa tarikh sebahagian dari yang lulus");
  // Kiraan mesti konsisten dengan senarai yang dipapar (selagi bawah cap).
  if (!jun.capped) {
    eq(jun.overdueN, jun.overdueRows.length, "kiraan overdue padan senarai dipapar");
    eq(jun.awaitingN, jun.awaitingRows.length, "kiraan awaiting padan senarai dipapar");
  } else {
    ok(jun.overdueRows.length + jun.awaitingRows.length <= EXC_CAP, "senarai dicap EXC_CAP");
  }

  console.log("\n--- B4. julat kosong: tinggal item tanpa tarikh sahaja ---");
  const kosong = aggregateUncollected(bundle, { from: "1999-01-01", to: "1999-12-31" });
  eq(kosong.filteredRows, kosong.undatedRows,
    "julat tanpa order: hanya item tanpa tarikh yang tinggal");
  eq(kosong.ghostN, all.ghostN, "ghost kekal penuh walau julat kosong");

  console.log("\n--- B5. kategori + umur data sebenar tak berubah oleh julat ---");
  const key = (r: NotCollectedRow) => `${r.order_id}`;
  const refMap = new Map(
    [...all.overdueRows, ...all.awaitingRows].map((r) => [key(r), `${r.kategori}|${r.umur_hari}`]));
  const drift = [...jun.overdueRows, ...jun.awaitingRows]
    .filter((r) => refMap.has(key(r)) && refMap.get(key(r)) !== `${r.kategori}|${r.umur_hari}`);
  eq(drift.length, 0, "sifar baris tukar kategori atau umur bila julat aktif");
}

async function main() {
  testPure();
  await testFidelity();
  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
