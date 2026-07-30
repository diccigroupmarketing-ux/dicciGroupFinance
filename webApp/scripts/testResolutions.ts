// Ujian lapisan Resolution (lib/resolutions.ts + lib/resolutionsSchema.ts).
//   npx tsx scripts/testResolutions.ts
//
// Suite ni MENULIS ke dev PG (jadual recon_resolutions + recon_resolution_events),
// dan dalam ujian 5 ia ubah sementara satu nilai selling_price lalu memulihkannya
// (bahagian F pula menulis NULL/0 sementara ke satu baris cod_bill_lines, dan
// bahagian G menulis amaun KURANG SEDIKIT ke satu baris bil lain , dua duanya
// pulih dalam `finally` + disahkan selepasnya).
// Jadi ia didaftar dalam kumpulan "memadam" testAll.mjs (restore sebelum + selepas).
//
// Bahagian:
//   A. TULEN , tiada DB langsung. Pembundaran, cap jari, kunci subjek, guard item.
//   B. INVARIAN DUIT , bukti struktur bahawa lapisan ni tak boleh gerakkan duit.
//   C. MAKER CHECKER + ESKALASI , dikuatkuasa di SQL dan di gate admin.
//   D. CAP JARI + SNOOZE , kes basi dan snooze luput balik jadi terbuka.
//   E. GUARD PROPOSE , tally, sanity amaun, perlumbaan subjek sama.
//   F. AMAUN TAK DAPAT DIBACA , snapshot NULL + kelulusan naik admin (fail closed).
//   G. AMOUNT_MISMATCH SINTETIK , kes Singapura (duit masuk kurang sebab kadar
//      tukaran) dibina sendiri, lalu alur penuh fx_adjustment atasnya.
//   H. GREP , fail ni tak boleh menulis ke jadual duit.
import "./reconEnv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import {
  PREPAID, REMIT_PENDING_DAYS, buildTmpM, reconTodayYmd, streamSummaryImpl,
  type ExcRow, type StreamKey, type StreamSummary,
} from "../lib/recon";
import {
  BATCH_HARD_MAX, MAX_SNOOZE_DAYS, RESOLVABLE_KATS, ResolutionError,
  addDaysYmd, adminThreshold, amountSane, decideResolutions, decorate,
  fingerprintOf, getResolutionEvents, getResolutions, peerBatchMax,
  proposeItemProblem, proposeResolutions, reasonMeta, reasonOptions,
  resolutionContext, round2,
  streamFacts, subjectKeyForExcRow, subjectKeyForGhostRow, subjectKeyStr,
  withdrawResolutions,
  type LiveFact, type ProposeItem, type Resolution, type SubjectKey,
} from "../lib/resolutions";
import { ensureResolutionTables } from "../lib/resolutionsSchema";

// GUARD: jangan sekali kali tunjuk ke Neon prod dari ujian yang MENULIS.
const DB = process.env.DATABASE_URL ?? "";
if (!DB.includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost).");
  process.exit(1);
}
if (/neon/i.test(DB)) {
  console.error("TOLAK: DATABASE_URL mengandungi 'neon'. BERHENTI.");
  process.exit(1);
}

let fail = 0;
function ok(cond: boolean | undefined, label: string) {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) fail++;
}
function eq(a: unknown, b: unknown, label: string) {
  const same = stable(a) === stable(b);
  ok(same, label);
  if (!same) {
    console.log("    dijangka:", stable(b).slice(0, 400));
    console.log("    dapat   :", stable(a).slice(0, 400));
  }
}
// Stringify dengan kunci disusun REKURSIF (perbandingan nested yang sebenar).
function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v as object).sort().map((k) =>
      JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k]),
    ).join(",") + "}";
  }
  return JSON.stringify(v);
}

const MAKER = "maker@dicci.test";
const CHECKER = "checker@dicci.test";
const ADMIN = "admin@dicci.test";
const NOW = "2026-06-18T09:00:00.000Z";
const TODAY = reconTodayYmd();       // 2026-06-18 (dikunci oleh reconEnv)

async function clearResolutions() {
  await ensureResolutionTables();
  const p = getPool();
  await p.query("DELETE FROM recon_resolution_events");
  await p.query("DELETE FROM recon_resolutions");
}

function itemsOf(facts: LiveFact[], stream: string): ProposeItem[] {
  return facts.map((f) => ({
    subjectType: f.subjectType, subjectId: f.subjectId, stream,
  }));
}

// Satu order berkategori `kat` dalam stream courier (guna tmp_m enjin, read-only).
async function pickKat(key: StreamKey, kat: string): Promise<string | null> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query("BEGIN");
    await buildTmpM(client, key, REMIT_PENDING_DAYS);
    const r = await client.query(
      `SELECT order_id FROM tmp_m
        WHERE kategori = $1 AND order_id IS NOT NULL LIMIT 1`, [kat]);
    await client.query("ROLLBACK");
    return (r.rows[0]?.order_id as string | undefined) ?? null;
  } finally {
    client.release();
  }
}

async function sellingPriceOf(orderId: string): Promise<number> {
  const r = await getPool().query(
    "SELECT selling_price FROM orders WHERE order_id = $1", [orderId]);
  return Number(r.rows[0]?.selling_price ?? 0);
}

// Satu baris bil 'tally' jnt yang SELAMAT diubah jadi kes mismatch sintetik.
// Syarat pilihan (semuanya penting, kalau tidak ujian menguji benda lain):
//   , satu order SAHAJA berkongsi tracking tu. Kalau dua, guard AWB dikongsi
//     yang tentukan kategori (ia paksa amount_mismatch sendiri), jadi ujian
//     tak lagi membuktikan beza amaun yang kita suntik.
//   , satu baris bil SAHAJA untuk awb tu. Guard multi line tak menghalang
//     propose, dan pemulihan dalam `finally` kena tepat satu baris.
//   , selling_price cukup besar supaya potongan BESAR (atas ambang admin) pun
//     tinggalkan duit masuk > 0. Baris bil <= 0 jatuh cabang lain dalam enjin
//     (belum_remit / hilang_lewat), BUKAN amount_mismatch.
interface TallyPick {
  orderId: string; awb: string; billId: string; price: number; codAsal: number;
}
async function pickTallyLine(minPrice: number): Promise<TallyPick | null> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query("BEGIN");
    await buildTmpM(client, "jnt", REMIT_PENDING_DAYS);
    const r = await client.query(
      `SELECT m.order_id, m.awb, m.bill_id, m.selling_price, m.cod_amount
         FROM tmp_m m
        WHERE m.kategori = 'tally' AND m.selling_price > $1
          AND (SELECT COUNT(*) FROM cod_bill_lines l WHERE l.awb = m.awb) = 1
          AND (SELECT COUNT(*) FROM orders o WHERE o.tracking = m.tracking) = 1
        ORDER BY m.selling_price DESC, m.order_id LIMIT 1`, [minPrice]);
    await client.query("ROLLBACK");
    const row = r.rows[0];
    if (!row) return null;
    return {
      orderId: String(row.order_id), awb: String(row.awb),
      billId: String(row.bill_id), price: Number(row.selling_price),
      codAsal: Number(row.cod_amount),
    };
  } finally {
    client.release();
  }
}

// Tulis amaun baris bil yang dipilih (satu baris tepat: awb + bill_id).
async function setLineAmount(p: TallyPick, amount: number) {
  await getPool().query(
    "UPDATE cod_bill_lines SET cod_amount = $3 WHERE awb = $1 AND bill_id = $2",
    [p.awb, p.billId, amount]);
}

// Fakta hidup satu order (undefined = dia bukan lagi baris boleh-settle).
async function orderFact(orderId: string): Promise<LiveFact | undefined> {
  const facts = await streamFacts("jnt");
  return facts.bySubject.get(
    subjectKeyStr({ subjectType: "order", subjectId: orderId }));
}

async function main() {
  console.log(`\n=== A. TULEN (tiada DB) ===`);

  // Pembundaran ROUND_HALF_UP, half AWAY FROM ZERO, dan tahan wakilan binari.
  ok(round2(1.005) === 1.01, "round2(1.005) = 1.01 (half up, bukan 1.00)");
  ok(round2(2.675) === 2.68, "round2(2.675) = 2.68");
  ok(round2(-1.005) === -1.01, "round2(-1.005) = -1.01 (half away from zero)");
  ok(round2(0.1 + 0.2) === 0.3, "round2(0.1+0.2) = 0.3");

  // Cap jari: stabil untuk fakta sama, berubah untuk setiap medan material.
  const base = { stream: "jnt", category: "belum_remit", amount: 0, expected: 407 };
  const fp = fingerprintOf(base);
  ok(fp === fingerprintOf({ ...base }), "fingerprint stabil untuk fakta identik");
  ok(fp === fingerprintOf({ ...base, expected: 407.0000001 }),
    "fingerprint tak flip sebab nyatakan semula sen (dibundar dulu)");
  ok(fp !== fingerprintOf({ ...base, amount: 1 }), "fingerprint sensitif pada amount");
  ok(fp !== fingerprintOf({ ...base, expected: 408 }), "fingerprint sensitif pada expected");
  ok(fp !== fingerprintOf({ ...base, category: "hilang_lewat" }),
    "fingerprint sensitif pada category");
  ok(fp !== fingerprintOf({ ...base, stream: "ninja" }),
    "fingerprint sensitif pada stream");

  // AMAUN TAK DAPAT DIBACA ialah fakta material SENDIRI, bukan RM 0.00.
  //   , Baris biasa mesti kekal BYTE IDENTIK dengan cap jari lama, kalau tidak
  //     setiap kes prod sedia ada terus jadi stale bila kod ni naik.
  //   , Baris tak-boleh-dibaca mesti BERBEZA dari baris RM 0.00 sebenar. Kalau
  //     dua dua dicap "0.00", fail rosak yang kemudian dibaiki jadi RM 0.00
  //     betul betul akan lolos senyap tanpa membuka semula kes.
  ok(fp === fingerprintOf({ ...base, amountUnreadable: false }),
    "fingerprint IDENTIK bila amountUnreadable=false (kes lama tak jadi stale)");
  ok(fp !== fingerprintOf({ ...base, amountUnreadable: true }),
    "fingerprint 'tak dapat dibaca' BERBEZA dari fingerprint RM 0.00");
  ok(fingerprintOf({ ...base, amount: 999, amountUnreadable: true })
     === fingerprintOf({ ...base, amount: 0, amountUnreadable: true }),
    "amaun tak dapat dibaca: nombor di sebaliknya diabaikan (memang tak diketahui)");

  // Kunci subjek: awb COD dan order_ref CHIP TAK BOLEH berlanggar.
  const codKey = subjectKeyForGhostRow({
    awb: "X1", cod_amount: 1, bill_id: null, settlement_date: null,
    source_file: null, courier: "J&T Express", streamKey: "jnt",
  });
  const chipKey = subjectKeyForGhostRow({
    awb: "X1", cod_amount: 1, bill_id: null, settlement_date: null,
    source_file: null, courier: "CHIP", streamKey: "chip",
  });
  ok(codKey?.subjectId === "cod:X1", `kunci COD berprefiks (${codKey?.subjectId})`);
  ok(chipKey?.subjectId === "chip:X1", `kunci CHIP berprefiks (${chipKey?.subjectId})`);
  ok(codKey!.subjectId !== chipKey!.subjectId, "awb COD lawan order_ref CHIP tak berlanggar");

  // ExcRow: order menang bila kedua duanya ada (paksi ORDER).
  const excOrder = subjectKeyForExcRow({
    order_id: "660", seller_name: null, tracking: "T", awb: "T",
    kategori: "amount_mismatch", selling_price: 10, cod_amount: 9, umur_hari: 1,
  }, "jnt");
  ok(excOrder?.subjectType === "order" && excOrder.subjectId === "660",
    "ExcRow dengan order_id -> paksi order");
  const excAwb = subjectKeyForExcRow({
    order_id: null, seller_name: null, tracking: null, awb: "T9",
    kategori: "duit_hantu", selling_price: null, cod_amount: 9, umur_hari: null,
  }, "jnt");
  ok(excAwb?.subjectType === "awb" && excAwb.subjectId === "cod:T9",
    "ExcRow tanpa order_id -> paksi awb berprefiks");

  ok(addDaysYmd("2026-06-18", 30) === "2026-07-18", "addDaysYmd merentas bulan");
  ok(addDaysYmd("2026-12-31", 1) === "2027-01-01", "addDaysYmd merentas tahun");

  // amountSane (guard 3).
  ok(amountSane(0, 0, 407), "adjust 0 sentiasa sah");
  ok(amountSane(-350, 0, 407), "adjust -350 lawan beza -407: sah");
  ok(!amountSane(-500, 0, 407), "adjust -500 lawan beza -407: DITOLAK (melebihi beza)");
  ok(!amountSane(350, 0, 407), "adjust +350 lawan beza -407: DITOLAK (salah arah)");
  ok(amountSane(50, 100, 50), "adjust +50 lawan beza +50: sah");
  ok(!amountSane(-1, 100, 100), "beza 0 tapi adjust bukan 0: DITOLAK");

  // proposeItemProblem (guard 4 + 5, tulen).
  const synth = (over: Partial<LiveFact>): LiveFact => ({
    subjectType: "order", subjectId: "X", stream: "jnt", category: "belum_remit",
    amount: 0, expected: 407, value: 407, lines: 1, mixed: false,
    amountUnreadable: false, ...over,
  });
  const k: SubjectKey = { subjectType: "order", subjectId: "X" };
  ok(proposeItemProblem(k, synth({}), "data_entry_error", 0) === null,
    "item normal lulus guard");
  ok(proposeItemProblem(k, null, "data_entry_error", 0)?.includes("bukan baris exception"),
    "GUARD 5: subjek tiada dalam populasi hidup -> tolak (baris tally jatuh sini)");
  ok(proposeItemProblem(k, synth({ lines: 2 }), "data_entry_error", 0)
    === "multi line, resolve per bill line",
    "GUARD 4: lines > 1 -> 'multi line, resolve per bill line'");
  ok(proposeItemProblem(k, synth({ mixed: true }), "data_entry_error", 0)
    === "multi line, resolve per bill line",
    "GUARD 4: kategori bercampur -> tolak juga");
  ok(proposeItemProblem(k, synth({}), "data_entry_error", -500)?.includes("tidak munasabah"),
    "GUARD 3: adjust melebihi beza -> tolak");
  ok(proposeItemProblem(k, synth({}), "unattributed_income", 0)?.includes("sisi awb"),
    "reason sisi awb tak boleh dipakai atas baris order");

  // GUARD 3b: pelarasan atas baris yang amaunnya tak dapat dibaca. amountSane()
  // menilai baris tu seolah olah duit masuk RM0, jadi tanpa guard ni pelarasan
  // sebesar seluruh selling_price akan lulus "sanity" atas nilai yang kita
  // memang tak tahu. Settle tanpa pelarasan tetap dibenarkan (itu keputusan,
  // bukan angka), yang ditolak cuma pelarasan bernombor.
  const unread = synth({ amountUnreadable: true });
  ok(proposeItemProblem(k, unread, "data_entry_error", 0) === null,
    "amaun tak dapat dibaca + adjust 0: lulus guard (kes masih boleh dicadang)");
  ok(proposeItemProblem(k, unread, "partial_or_refund", -100)
    ?.includes("tak dapat dibaca"),
    "GUARD 3b: adjust bernombor atas amaun tak dapat dibaca -> DITOLAK");
  ok(proposeItemProblem(k, synth({}), "partial_or_refund", -100) === null,
    "kontras: adjust -100 lawan beza -407 pada baris BOLEH dibaca tetap lulus");

  // RESOLVABLE_KATS = senarai putih, bukan 'semua bukan tally'.
  ok(!RESOLVABLE_KATS.includes("tally"), "tally BUKAN kategori boleh-settle");
  for (const kk of ["returned", "rejected", "pending"]) {
    ok(!RESOLVABLE_KATS.includes(kk), `status order '${kk}' bukan kategori boleh-settle`);
  }
  for (const kk of ["hilang_lewat", "duit_hantu", "belum_remit", "belum_bayar",
                    "amount_mismatch", "match_luar_skop", "duit_masuk_order_returned"]) {
    ok(RESOLVABLE_KATS.includes(kk), `'${kk}' termasuk kategori boleh-settle`);
  }

  // Registry sebab: taksonomi yang team finance nampak. Ujian ni yang menangkap
  // kalau ada orang tersilap tukar KOD dalaman sedangkan yang patut tukar cuma
  // LABEL (kod hidup dalam DB, label cuma teks skrin).
  const opts = reasonOptions();
  ok(opts.some((o) => o.code === "awaiting_bill_upload"),
    "kod dalaman 'awaiting_bill_upload' KEKAL (kes lama dalam DB tak putus rujukan)");
  ok(reasonMeta("awaiting_bill_upload").label === "Bill not in yet",
    `label 'awaiting_bill_upload' = "Bill not in yet" `
    + `(${reasonMeta("awaiting_bill_upload").label})`);
  ok(!opts.some((o) => o.label === "Awaiting bill upload"),
    "label lama 'Awaiting bill upload' tiada lagi dalam registry");

  const mp = reasonMeta("missing_parcel");
  ok(mp.label === "Missing parcel", `label missing_parcel = "Missing parcel" (${mp.label})`);
  ok(mp.side === "order", `missing_parcel sisi ORDER sahaja (${mp.side})`);
  ok(mp.kelas === "snooze" && mp.snooze === true,
    "missing_parcel kelas SNOOZE (bukan settle kekal)");
  ok(mp.bolehBatch === true, "missing_parcel boleh batch (sama macam pending_recovery)");
  ok(mp.adminSahaja === false, "missing_parcel BUKAN admin sahaja (peer boleh guna)");
  ok(mp.minNote === 0, "missing_parcel tak wajibkan nota");
  ok(mp.wajibCounterparty === false && mp.wajibRef === false,
    "missing_parcel tak menuntut counterparty atau duplicate ref");
  ok((mp.desc ?? "").length > 0, `missing_parcel ada tooltip sendiri (${mp.desc ?? "TIADA"})`);
  const pr = reasonMeta("pending_recovery");
  ok(mp.side === pr.side && mp.snooze === pr.snooze && mp.kelas === pr.kelas
    && mp.bolehBatch === pr.bolehBatch && mp.adminSahaja === pr.adminSahaja
    && mp.minNote === pr.minNote,
    "missing_parcel SESIFAT dengan pending_recovery (kecuali label + tooltip)");

  // Sebab sisi order tak boleh dipakai atas baris duit.
  const kAwb: SubjectKey = { subjectType: "awb", subjectId: "cod:T9" };
  ok(proposeItemProblem(kAwb, synth({ subjectType: "awb", subjectId: "cod:T9" }),
    "missing_parcel", 0)?.includes("sisi order"),
    "missing_parcel atas baris sisi awb: DITOLAK");
  ok(proposeItemProblem(k, synth({}), "missing_parcel", 0) === null,
    "missing_parcel atas baris sisi order: lulus guard");

  // Sebab COST baru 'fx_adjustment' (label skrin "Selling price adjustment").
  // Order Singapura: selling_price tetap dalam RM tapi duit settle selepas tukar
  // mata wang. Ujian ni yang berbunyi kalau ada orang tersilap tanda ia snooze
  // (nanti ia berhenti dikira settled) atau tersilap jadikan ia admin sahaja.
  const fx = reasonMeta("fx_adjustment");
  ok(fx.label === "Selling price adjustment",
    `label fx_adjustment = "Selling price adjustment" (${fx.label})`);
  ok(fx.side === "order", `fx_adjustment sisi ORDER sahaja (${fx.side})`);
  ok(fx.kelas === "cost" && fx.snooze === false,
    "fx_adjustment kelas COST (settle terus bila lulus, BUKAN snooze)");
  ok(fx.bolehBatch === true, "fx_adjustment boleh batch (sama macam processing_fee)");
  ok(fx.adminSahaja === false, "fx_adjustment BUKAN admin sahaja (peer boleh guna)");
  ok(fx.minNote === 0, "fx_adjustment tak wajibkan nota");
  ok(fx.wajibCounterparty === false && fx.wajibRef === false,
    "fx_adjustment tak menuntut counterparty atau duplicate ref");
  ok((fx.desc ?? "").length > 0, `fx_adjustment ada tooltip sendiri (${fx.desc ?? "TIADA"})`);
  const pf = reasonMeta("processing_fee");
  ok(fx.side === pf.side && fx.snooze === pf.snooze && fx.kelas === pf.kelas
    && fx.bolehBatch === pf.bolehBatch && fx.adminSahaja === pf.adminSahaja
    && fx.minNote === pf.minNote,
    "fx_adjustment SESIFAT dengan processing_fee (kecuali label + tooltip)");
  ok(opts.some((o) => o.code === "fx_adjustment"),
    "fx_adjustment muncul dalam senarai dropdown reasonOptions()");

  ok(proposeItemProblem(kAwb, synth({ subjectType: "awb", subjectId: "cod:T9" }),
    "fx_adjustment", 0)?.includes("sisi order"),
    "fx_adjustment atas baris sisi awb: DITOLAK");
  ok(proposeItemProblem(k, synth({ category: "amount_mismatch", amount: 400,
    expected: 426, value: 400 }), "fx_adjustment", 0) === null,
    "fx_adjustment atas baris amount_mismatch sisi order: lulus guard");

  // ================================================================
  console.log(`\n=== B. INVARIAN DUIT (lapisan ni tak boleh gerakkan duit) ===`);
  await clearResolutions();

  const jntFacts = await streamFacts("jnt");
  const jntSubs = [...jntFacts.bySubject.values()]
    .filter((f) => f.subjectType === "order" && f.lines === 1)
    .sort((a, b) => (a.subjectId < b.subjectId ? -1 : 1));
  ok(jntSubs.length >= 60,
    `dev DB ada ${jntSubs.length} subjek jnt boleh-settle (perlu >= 60)`);

  const before = await streamSummaryImpl("jnt", REMIT_PENDING_DAYS);

  const p1 = await proposeResolutions({
    items: itemsOf(jntSubs.slice(0, 3), "jnt"), reason: "data_entry_error",
    note: "ujian invarian", actor: MAKER, isAdminActor: false,
    now: NOW, todayYmd: TODAY,
  });
  ok(p1.created.length === 3, `3 kes dicadang (${p1.created.length})`);
  const d1 = await decideResolutions({
    resolutionIds: p1.created.map((c) => c.resolutionId), action: "approve",
    actor: CHECKER, isAdminActor: false, now: NOW,
  });
  ok(d1.changed.length === 3, `3 kes diluluskan checker (${d1.changed.length})`);

  const after = await streamSummaryImpl("jnt", REMIT_PENDING_DAYS);
  eq(after, before,
    "INVARIAN: streamSummary IDENTIK (deep equal) selepas 3 kes diluluskan");

  // decorate() TULEN: cuma TAMBAH medan, tak sentuh apa apa yang sedia ada.
  const ctxB = await resolutionContext("jnt", TODAY);
  // Salinan BEBAS diambil SEBELUM decorate. Tanpa ni, decorate yang mengubah
  // objek input akan lulus secara palsu (kita akan banding objek dengan dirinya).
  const afterClone = JSON.parse(JSON.stringify(after)) as StreamSummary;
  const dec = decorate(after, ctxB);
  const strip = (s: StreamSummary) => ({
    ...s,
    integ: s.integ.map(({ ...r }) => { delete (r as Record<string, unknown>).resolution; return r; }),
    aged: s.aged.map(({ ...r }) => { delete (r as Record<string, unknown>).resolution; return r; }),
    auditPreview: s.auditPreview.map(({ ...r }) => {
      delete (r as Record<string, unknown>).resolution; return r; }),
  });
  const { resolutionSummary, ...decRest } = dec;
  eq(strip(decRest as unknown as StreamSummary), strip(afterClone),
    "INVARIAN: decorate() cuma TAMBAH medan (buang `resolution` -> identik)");
  eq(after, afterClone, "INVARIAN: decorate() TIDAK mengubah objek input");
  ok(resolutionSummary.loaded, "agregat overlay dimuatkan (ada kes hidup)");
  ok(resolutionSummary.settledN === 3,
    `settledN = 3 (${resolutionSummary.settledN})`);
  ok(resolutionSummary.exceptionN === jntFacts.exceptionN,
    `exceptionN ikut kiraan PENUH tmp_m (${resolutionSummary.exceptionN}), bukan senarai bertutup`);
  ok(resolutionSummary.openN === resolutionSummary.exceptionN - 3,
    `openN turun 3 (${resolutionSummary.openN})`);
  ok(resolutionSummary.exceptionN > (after.integ.length + after.aged.length)
     || after.integ.length + after.aged.length > 0,
    "populasi exception dikira dari GROUP BY, bukan panjang array");

  // Lencana baris: snapshot dev TIADA baris integ/aged (kategorinya belum_remit /
  // status order sahaja), jadi laluan lencana diuji atas ringkasan SINTETIK.
  // decorate() fungsi TULEN, jadi ujian ni sah sepenuhnya dan deterministik.
  const rowOrder: ExcRow = {
    order_id: "SYN-ORDER-1", seller_name: "UJIAN", tracking: "TRK1", awb: "TRK1",
    kategori: "amount_mismatch", selling_price: 100, cod_amount: 90, umur_hari: 5,
  };
  const rowAwb: ExcRow = {
    order_id: null, seller_name: null, tracking: null, awb: "TRK9",
    kategori: "duit_hantu", selling_price: null, cod_amount: 45, umur_hari: null,
  };
  const factOrder: LiveFact = {
    subjectType: "order", subjectId: "SYN-ORDER-1", stream: "jnt",
    category: "amount_mismatch", amount: 90, expected: 100, value: 90,
    lines: 1, mixed: false, amountUnreadable: false,
  };
  const factAwb: LiveFact = {
    subjectType: "awb", subjectId: "cod:TRK9", stream: "jnt",
    category: "duit_hantu", amount: 45, expected: 0, value: 45,
    lines: 1, mixed: false, amountUnreadable: false,
  };
  const mkRes = (f: LiveFact, over: Partial<Resolution> = {}): Resolution => ({
    resolutionId: `R-${f.subjectId}`, subjectType: f.subjectType,
    subjectId: f.subjectId, streamSnapshot: f.stream, categorySnapshot: f.category,
    amountSnapshot: f.amount, expectedSnapshot: f.expected,
    fingerprint: fingerprintOf({ stream: f.stream, category: f.category,
      amount: f.amount, expected: f.expected }),
    reason: "data_entry_error", note: null, adjustAmount: 0, counterparty: null,
    duplicateRef: null, expiresOn: null, batchId: null, state: "approved",
    proposedBy: MAKER, proposedAt: NOW, decidedBy: CHECKER, decidedAt: NOW,
    decisionNote: null, supersedes: null, ...over,
  });
  const synthSummary: StreamSummary = {
    katN: { amount_mismatch: 1, duit_hantu: 1 },
    katCod: { amount_mismatch: 90, duit_hantu: 45 },
    daily: [], integ: [rowOrder, rowAwb], integN: 2, integRisk: 135,
    aged: [], agedN: 0, perBill: [], bills: [],
    linesN: 2, linesCod: 135, linesFee: 0, tallyN: 0, tallyCod: 0,
    auditPreview: [rowOrder], scopedOrders: 1, stokisKat: [], otherCouriers: [],
  };
  const synthCtx = {
    stream: "jnt",
    resolutions: [mkRes(factOrder), mkRes(factAwb)],
    facts: new Map([
      [subjectKeyStr(factOrder), factOrder],
      [subjectKeyStr(factAwb), factAwb],
    ]),
    factsLoaded: true, exceptionN: 2, exceptionValue: 135, todayYmd: TODAY,
  };
  const synthDec = decorate(synthSummary, synthCtx);
  const tagged = synthDec.integ.filter((r) => r.resolution);
  ok(tagged.length === 2,
    `kedua dua paksi baris dapat lencana resolution (${tagged.length}/2)`);
  ok(tagged.every((r) => r.resolution!.settled && !r.resolution!.stale),
    "lencana baris: settled + tidak stale");
  ok(synthDec.auditPreview[0]?.resolution?.resolutionId === "R-SYN-ORDER-1",
    "auditPreview turut dilencana");
  ok(synthDec.resolutionSummary.settledN === 2
    && synthDec.resolutionSummary.openN === 0,
    "agregat sintetik: 2 settled, 0 terbuka");
  // Lencana baris untuk sebab SNOOZE: snoozed=true DAN settled=false. Agregat
  // sahaja tak cukup sebab cabang snooze menang dahulu dalam if/else.
  const snoozeCtx = {
    ...synthCtx,
    resolutions: [
      mkRes(factOrder, { reason: "awaiting_bill_upload" as const,
                         expiresOn: addDaysYmd(TODAY, 10) }),
      mkRes(factAwb),
    ],
  };
  const snoozeDec = decorate(synthSummary, snoozeCtx);
  ok(snoozeDec.integ[0].resolution?.snoozed === true,
    "lencana baris snooze: snoozed = true");
  ok(snoozeDec.integ[0].resolution?.settled === false,
    "lencana baris snooze: settled = FALSE (snooze TAK PERNAH settled)");
  ok(snoozeDec.resolutionSummary.snoozedN === 1
    && snoozeDec.resolutionSummary.settledN === 1,
    "agregat: 1 snoozed + 1 settled (snooze tak dikira settled)");

  // Fingerprint tak padan -> lencana stale, dan agregat berhenti kira ia settled.
  const staleCtx = {
    ...synthCtx,
    resolutions: [mkRes(factOrder, { fingerprint: "cap-jari-lama" }), mkRes(factAwb)],
  };
  const staleDec = decorate(synthSummary, staleCtx);
  ok(staleDec.integ[0].resolution?.stale === true
    && staleDec.integ[0].resolution?.settled === false,
    "lencana baris jadi stale bila fingerprint tak padan");
  ok(staleDec.resolutionSummary.settledN === 1
    && staleDec.resolutionSummary.staleN === 1,
    "agregat: kes basi keluar dari settled");
  // decorate atas ringkasan sintetik pun tak sentuh medan angka sedia ada.
  const staleRest: Record<string, unknown> = { ...staleDec };
  delete staleRest.resolutionSummary;
  eq(strip(staleRest as unknown as StreamSummary), strip(synthSummary),
    "INVARIAN (sintetik): decorate cuma TAMBAH medan");

  // Jejak APPEND ONLY wujud untuk setiap transisi.
  // Nota: ujian ni suntik cap masa `at` yang SAMA untuk propose dan approve,
  // jadi susunan (ORDER BY at, event_id) tak deterministik di sini. Yang penting
  // = kedua dua transisi direkod. Dalam guna sebenar `at` memang berbeza.
  const ev = await getResolutionEvents(p1.created[0].resolutionId);
  const evNames = ev.map((e) => e.event).sort();
  eq(evNames, ["approve", "proposed"],
    `2 event direkod (proposed + approve) [${ev.map((e) => e.event).join(",")}]`);
  const evApprove = ev.find((e) => e.event === "approve");
  ok(typeof evApprove?.payload?.fingerprint === "string",
    "payload event keputusan menyimpan fingerprint yang pemutus NAMPAK");
  ok(evApprove?.payload?.proposedBy === MAKER,
    "payload event keputusan menyimpan siapa pencadang (jejak maker checker)");

  // ================================================================
  console.log(`\n=== C. MAKER CHECKER + ESKALASI ===`);
  await clearResolutions();

  // 2) Maker tak boleh lulus kes sendiri (rowCount 0 dari SQL).
  const pSelf = await proposeResolutions({
    items: itemsOf(jntSubs.slice(0, 1), "jnt"), reason: "data_entry_error",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  const selfId = pSelf.created[0].resolutionId;
  const dSelf = await decideResolutions({
    resolutionIds: [selfId], action: "approve", actor: MAKER,
    isAdminActor: false, now: NOW,
  });
  ok(dSelf.changed.length === 0, "maker approve kes sendiri: 0 baris berubah");
  ok(dSelf.failed[0]?.why.includes("maker checker"),
    `sebab kegagalan jelas: ${dSelf.failed[0]?.why}`);
  // Beza huruf besar kecil pun tetap orang yang sama.
  const dSelfCase = await decideResolutions({
    resolutionIds: [selfId], action: "approve", actor: MAKER.toUpperCase(),
    isAdminActor: false, now: NOW,
  });
  ok(dSelfCase.changed.length === 0, "maker checker tak boleh dipintas dengan huruf besar");
  // Orang lain boleh.
  const dPeer = await decideResolutions({
    resolutionIds: [selfId], action: "approve", actor: CHECKER,
    isAdminActor: false, now: NOW,
  });
  ok(dPeer.changed.length === 1, "checker (bukan pencadang) boleh lulus");

  // Withdraw: maker sendiri sahaja, keadaan 'proposed' sahaja.
  await clearResolutions();
  const pW = await proposeResolutions({
    items: itemsOf(jntSubs.slice(1, 2), "jnt"), reason: "data_entry_error",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  const wOther = await withdrawResolutions({
    resolutionIds: [pW.created[0].resolutionId], actor: CHECKER, now: NOW,
  });
  ok(wOther.changed.length === 0, "orang lain tak boleh withdraw cadangan maker");
  const wSelf = await withdrawResolutions({
    resolutionIds: [pW.created[0].resolutionId], actor: MAKER, now: NOW,
  });
  ok(wSelf.changed.length === 1, "maker boleh withdraw cadangan sendiri");

  // 3) Ambang RM300: peer ditolak, admin lulus.
  await clearResolutions();
  const ninja = await streamFacts("ninja");
  const bigSub = [...ninja.bySubject.values()]
    .find((f) => f.subjectType === "order" && f.lines === 1
      && Math.abs(f.amount - f.expected) > adminThreshold() + 20);
  ok(!!bigSub, `ada subjek ninja dengan beza > RM ${adminThreshold()} `
    + `(${bigSub?.subjectId ?? "TIADA"})`);
  const bigAdjust = -(adminThreshold() + 20);   // sama arah dengan beza (negatif)
  const pBig = await proposeResolutions({
    items: itemsOf([bigSub!], "ninja"), reason: "partial_or_refund",
    adjustAmount: bigAdjust, actor: MAKER, isAdminActor: false,
    now: NOW, todayYmd: TODAY,
  });
  ok(pBig.created.length === 1, "kes besar boleh DICADANG oleh peer");
  let threw: ResolutionError | null = null;
  try {
    await decideResolutions({
      resolutionIds: [pBig.created[0].resolutionId], action: "approve",
      actor: CHECKER, isAdminActor: false, now: NOW,
    });
  } catch (e) { threw = e as ResolutionError; }
  ok(threw?.status === 403 && threw.message.includes("ambang"),
    `peer lulus kes > RM${adminThreshold()}: DITOLAK 403 (${threw?.message ?? "tiada ralat"})`);
  const dAdminBig = await decideResolutions({
    resolutionIds: [pBig.created[0].resolutionId], action: "approve",
    actor: ADMIN, isAdminActor: true, now: NOW,
  });
  ok(dAdminBig.changed.length === 1, "admin lulus kes besar: OK");

  // Reason adminSahaja: peer tak boleh cadang pun.
  await clearResolutions();
  let threwWo: ResolutionError | null = null;
  try {
    await proposeResolutions({
      items: itemsOf(jntSubs.slice(0, 1), "jnt"), reason: "written_off",
      actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
    });
  } catch (e) { threwWo = e as ResolutionError; }
  ok(threwWo?.status === 403, "reason 'written_off' (adminSahaja): peer ditolak 403");

  // 'other' HARAM batch + nota minimum 20 aksara.
  let threwOther: ResolutionError | null = null;
  try {
    await proposeResolutions({
      items: itemsOf(jntSubs.slice(0, 2), "jnt"), reason: "other",
      note: "nota yang cukup panjang untuk lulus", actor: ADMIN,
      isAdminActor: true, now: NOW, todayYmd: TODAY,
    });
  } catch (e) { threwOther = e as ResolutionError; }
  ok(threwOther?.message.includes("tidak boleh batch"), "reason 'other' HARAM batch");
  let threwNote: ResolutionError | null = null;
  try {
    await proposeResolutions({
      items: itemsOf(jntSubs.slice(0, 1), "jnt"), reason: "other",
      note: "pendek", actor: ADMIN, isAdminActor: true, now: NOW, todayYmd: TODAY,
    });
  } catch (e) { threwNote = e as ResolutionError; }
  ok(threwNote?.message.includes("20 aksara"), "reason 'other' perlu nota >= 20 aksara");

  // 4) Batch melebihi had peer (50): peer ditolak, admin lulus.
  await clearResolutions();
  const bulkMax = peerBatchMax();
  const bulk = jntSubs.slice(0, bulkMax + 1);
  ok(bulk.length === bulkMax + 1, `sedia ${bulk.length} item (had peer ${bulkMax})`);
  const pBulk = await proposeResolutions({
    items: itemsOf(bulk, "jnt"), reason: "data_entry_error",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(pBulk.created.length === bulkMax + 1,
    `${pBulk.created.length} kes dicadang dalam satu batch`);
  ok(!!pBulk.batchId, "batch_id dijana bila > 1 item");
  const bulkIds = pBulk.created.map((c) => c.resolutionId);
  let threwBulk: ResolutionError | null = null;
  try {
    await decideResolutions({
      resolutionIds: bulkIds, action: "approve", actor: CHECKER,
      isAdminActor: false, now: NOW,
    });
  } catch (e) { threwBulk = e as ResolutionError; }
  ok(threwBulk?.status === 403,
    `peer lulus ${bulkIds.length} baris: DITOLAK 403 (${threwBulk?.message ?? "tiada ralat"})`);
  // Anti salami: hiris kecil dari batch besar pun kekal admin sahaja.
  let threwSlice: ResolutionError | null = null;
  try {
    await decideResolutions({
      resolutionIds: bulkIds.slice(0, 5), action: "approve", actor: CHECKER,
      isAdminActor: false, now: NOW,
    });
  } catch (e) { threwSlice = e as ResolutionError; }
  ok(threwSlice?.status === 403 && threwSlice.message.includes("batch"),
    "anti salami: hiris 5 dari batch 51 pun wajib admin");
  const dBulk = await decideResolutions({
    resolutionIds: bulkIds, action: "approve", actor: ADMIN,
    isAdminActor: true, now: NOW,
  });
  ok(dBulk.changed.length === bulkMax + 1, `admin lulus ${dBulk.changed.length} baris`);

  // Had ids.length DIUJI BERASINGAN dari peraturan anti salami: dua batch KECIL
  // (26 setiap satu, di bawah had) tapi diluluskan SEKALI GUS (52 baris). Kalau
  // semakan ids.length dibuang, ujian ni yang menangkapnya.
  await clearResolutions();
  const half = Math.floor(bulkMax / 2) + 1;         // 26 bila had 50
  const pA = await proposeResolutions({
    items: itemsOf(jntSubs.slice(0, half), "jnt"), reason: "data_entry_error",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  const pB = await proposeResolutions({
    items: itemsOf(jntSubs.slice(half, half * 2), "jnt"), reason: "data_entry_error",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  const twoIds = [...pA.created, ...pB.created].map((c) => c.resolutionId);
  ok(twoIds.length === half * 2 && half <= bulkMax,
    `dua batch ${half}+${half} = ${twoIds.length} baris (tiap batch di bawah had ${bulkMax})`);
  // Setiap batch sendiri BOLEH diluluskan peer (bukti had per-batch tak menghalang).
  const dHalf = await decideResolutions({
    resolutionIds: pA.created.map((c) => c.resolutionId), action: "approve",
    actor: CHECKER, isAdminActor: false, now: NOW,
  });
  ok(dHalf.changed.length === half, `peer lulus satu batch ${half} baris: OK`);
  let threwTwo: ResolutionError | null = null;
  try {
    await decideResolutions({
      resolutionIds: pB.created.map((c) => c.resolutionId).concat(
        pA.created.map((c) => c.resolutionId)),
      action: "approve", actor: CHECKER, isAdminActor: false, now: NOW,
    });
  } catch (e) { threwTwo = e as ResolutionError; }
  ok(threwTwo?.status === 403 && threwTwo.message.includes("maksimum"),
    `peer lulus ${twoIds.length} baris merentas dua batch kecil: DITOLAK 403 `
    + `(${threwTwo?.message ?? "tiada ralat"})`);

  // Had teknikal satu permintaan.
  let threwCap: ResolutionError | null = null;
  try {
    await proposeResolutions({
      items: Array.from({ length: BATCH_HARD_MAX + 1 }, (_, i) => ({
        subjectType: "order" as const, subjectId: `X${i}`, stream: "jnt" })),
      reason: "data_entry_error", actor: MAKER, isAdminActor: false,
      now: NOW, todayYmd: TODAY,
    });
  } catch (e) { threwCap = e as ResolutionError; }
  ok(threwCap?.message.includes(String(BATCH_HARD_MAX)),
    `had teknikal ${BATCH_HARD_MAX} item satu permintaan dikuatkuasa`);

  // ================================================================
  console.log(`\n=== D. CAP JARI (stale) + SNOOZE ===`);
  await clearResolutions();

  // 5) Ubah amaun dalam DB -> kes jadi stale dan BERHENTI dikira settled.
  const sub5 = jntSubs[0];
  const orderId5 = sub5.subjectId;
  const price5 = await sellingPriceOf(orderId5);
  ok(price5 > 0, `subjek ujian ada selling_price (${price5})`);
  const p5 = await proposeResolutions({
    items: itemsOf([sub5], "jnt"), reason: "data_entry_error",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  await decideResolutions({
    resolutionIds: [p5.created[0].resolutionId], action: "approve",
    actor: CHECKER, isAdminActor: false, now: NOW,
  });
  const sum5 = await streamSummaryImpl("jnt", REMIT_PENDING_DAYS);
  const ctx5a = await resolutionContext("jnt", TODAY);
  const a5a = decorate(sum5, ctx5a).resolutionSummary;
  ok(a5a.settledN === 1 && a5a.staleN === 0,
    `sebelum fakta berubah: settledN=${a5a.settledN} staleN=${a5a.staleN}`);

  await getPool().query(
    "UPDATE orders SET selling_price = selling_price + 10 WHERE order_id = $1",
    [orderId5]);
  const ctx5b = await resolutionContext("jnt", TODAY);
  const a5b = decorate(await streamSummaryImpl("jnt", REMIT_PENDING_DAYS), ctx5b)
    .resolutionSummary;
  ok(a5b.settledN === 0 && a5b.staleN === 1,
    `selepas amaun berubah: settledN=${a5b.settledN} staleN=${a5b.staleN} (kes jadi stale)`);
  ok(a5b.openN === a5b.exceptionN, "baris basi kembali dikira TERBUKA");
  const live5 = (await getResolutions()).find(
    (r) => r.resolutionId === p5.created[0].resolutionId);
  ok(live5?.state === "approved",
    "keadaan DB kekal 'approved' (stale dikira masa BACA, tak disimpan)");

  // 6) Fakta dipulihkan (re-upload identik) -> kes kembali dikira settled.
  await getPool().query(
    "UPDATE orders SET selling_price = $2 WHERE order_id = $1", [orderId5, price5]);
  const ctx6 = await resolutionContext("jnt", TODAY);
  const a6 = decorate(await streamSummaryImpl("jnt", REMIT_PENDING_DAYS), ctx6)
    .resolutionSummary;
  ok(a6.settledN === 1 && a6.staleN === 0,
    "re-upload fakta IDENTIK: kes kekal approved dan dikira settled semula (idempotent)");

  // 7) Snooze TAK PERNAH settled, dan luput mengembalikannya jadi terbuka.
  await clearResolutions();
  const p7 = await proposeResolutions({
    items: itemsOf(jntSubs.slice(0, 1), "jnt"), reason: "awaiting_bill_upload",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(p7.created.length === 1, "kes snooze dicadang");
  const live7 = (await getResolutions())[0];
  ok(live7.expiresOn === addDaysYmd(TODAY, MAX_SNOOZE_DAYS),
    `expires_on lalai = hari ini + ${MAX_SNOOZE_DAYS} (${live7.expiresOn})`);
  await decideResolutions({
    resolutionIds: [p7.created[0].resolutionId], action: "approve",
    actor: CHECKER, isAdminActor: false, now: NOW,
  });
  const sum7 = await streamSummaryImpl("jnt", REMIT_PENDING_DAYS);
  const a7 = decorate(sum7, await resolutionContext("jnt", TODAY)).resolutionSummary;
  ok(a7.settledN === 0, `snooze TAK PERNAH dikira settled (settledN=${a7.settledN})`);
  ok(a7.snoozedN === 1, `snooze dikira snoozedN=${a7.snoozedN}`);
  ok(a7.openN === a7.exceptionN - 1, "baris snooze keluar dari kiraan terbuka (buat sementara)");

  // Snooze melebihi 30 hari ditolak.
  await clearResolutions();
  let threwSnooze: ResolutionError | null = null;
  try {
    await proposeResolutions({
      items: itemsOf(jntSubs.slice(0, 1), "jnt"), reason: "awaiting_bill_upload",
      expiresOn: addDaysYmd(TODAY, MAX_SNOOZE_DAYS + 1),
      actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
    });
  } catch (e) { threwSnooze = e as ResolutionError; }
  ok(threwSnooze?.message.includes(String(MAX_SNOOZE_DAYS)),
    `snooze melebihi ${MAX_SNOOZE_DAYS} hari: DITOLAK`);

  // Luput -> balik terbuka automatik (tiada kerja tangan, dikira masa BACA).
  const p7b = await proposeResolutions({
    items: itemsOf(jntSubs.slice(0, 1), "jnt"), reason: "awaiting_bill_upload",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  await decideResolutions({
    resolutionIds: [p7b.created[0].resolutionId], action: "approve",
    actor: CHECKER, isAdminActor: false, now: NOW,
  });
  const ctx7c = await resolutionContext("jnt", TODAY);
  const a7c = decorate(sum7, {
    ...ctx7c, todayYmd: addDaysYmd(TODAY, MAX_SNOOZE_DAYS + 1),
  }).resolutionSummary;
  ok(a7c.snoozedN === 0 && a7c.expiredN === 1,
    `selepas tarikh luput: snoozedN=${a7c.snoozedN} expiredN=${a7c.expiredN}`);
  ok(a7c.openN === a7c.exceptionN, "baris snooze luput kembali dikira TERBUKA");

  // 7b) Sebab SNOOZE baru 'missing_parcel' terikat peraturan snooze yang SAMA.
  // Kalau nanti ada orang tersilap tanda ia bukan snooze, dua ujian ni yang
  // berbunyi: ia akan mula dikira settled, dan had 30 hari akan lesap.
  await clearResolutions();
  const pMp = await proposeResolutions({
    items: itemsOf(jntSubs.slice(0, 1), "jnt"), reason: "missing_parcel",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(pMp.created.length === 1, "kes 'missing_parcel' dicadang oleh peer (bukan admin sahaja)");
  const liveMp = (await getResolutions())[0];
  ok(liveMp.expiresOn === addDaysYmd(TODAY, MAX_SNOOZE_DAYS),
    `missing_parcel: expires_on lalai = hari ini + ${MAX_SNOOZE_DAYS} (${liveMp.expiresOn})`);
  await decideResolutions({
    resolutionIds: [pMp.created[0].resolutionId], action: "approve",
    actor: CHECKER, isAdminActor: false, now: NOW,
  });
  const aMp = decorate(sum7, await resolutionContext("jnt", TODAY)).resolutionSummary;
  ok(aMp.settledN === 0 && aMp.snoozedN === 1,
    `missing_parcel TAK PERNAH settled (settledN=${aMp.settledN} snoozedN=${aMp.snoozedN})`);
  const aMpExp = decorate(sum7, {
    ...(await resolutionContext("jnt", TODAY)),
    todayYmd: addDaysYmd(TODAY, MAX_SNOOZE_DAYS + 1),
  }).resolutionSummary;
  ok(aMpExp.snoozedN === 0 && aMpExp.expiredN === 1,
    `missing_parcel luput kembali TERBUKA (expiredN=${aMpExp.expiredN})`);

  await clearResolutions();
  let threwMp: ResolutionError | null = null;
  try {
    await proposeResolutions({
      items: itemsOf(jntSubs.slice(0, 1), "jnt"), reason: "missing_parcel",
      expiresOn: addDaysYmd(TODAY, MAX_SNOOZE_DAYS + 1),
      actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
    });
  } catch (e) { threwMp = e as ResolutionError; }
  ok(threwMp?.message.includes(String(MAX_SNOOZE_DAYS)),
    `missing_parcel melebihi ${MAX_SNOOZE_DAYS} hari: DITOLAK (had snooze sama)`);

  // Batch pula dibenarkan (sama macam pending_recovery), jadi finance boleh tutup
  // beberapa parcel hilang sekali gus tanpa 3 klik seorang.
  await clearResolutions();
  const pMpBatch = await proposeResolutions({
    items: itemsOf(jntSubs.slice(0, 3), "jnt"), reason: "missing_parcel",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(pMpBatch.created.length === 3,
    `missing_parcel boleh batch (${pMpBatch.created.length} kes dicadang sekali gus)`);

  // 7c) KONTRAS dengan 7b: sebab COST 'fx_adjustment' SETTLE TERUS bila lulus,
  // tiada tarikh luput, dan angka MENTAH stream tetap tak bergerak sesen pun.
  // Baris amount_mismatch dipilih kalau ada dalam data dev (itu baldi sebenar
  // untuk order Singapura). Kalau tiada, mana mana baris boleh-settle buktikan
  // perkara yang sama , yang menentukan settle lawan snooze ialah KELAS sebab,
  // bukan kategori baris.
  await clearResolutions();
  const fxSub = jntSubs.find((f) => f.category === "amount_mismatch") ?? jntSubs[0];
  console.log(`  (fx_adjustment diuji atas baris berkategori '${fxSub.category}')`);
  const rawBeforeFx = await streamSummaryImpl("jnt", REMIT_PENDING_DAYS);
  const pFx = await proposeResolutions({
    items: itemsOf([fxSub], "jnt"), reason: "fx_adjustment",
    note: "order Singapura, kadar tukaran mata wang", actor: MAKER,
    isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(pFx.created.length === 1,
    "kes 'fx_adjustment' dicadang oleh peer (bukan admin sahaja)");
  const liveFx = (await getResolutions())[0];
  ok(liveFx.expiresOn === null,
    `fx_adjustment TIADA tarikh luput, ia bukan snooze (${liveFx.expiresOn})`);
  const dFx = await decideResolutions({
    resolutionIds: [pFx.created[0].resolutionId], action: "approve",
    actor: CHECKER, isAdminActor: false, now: NOW,
  });
  ok(dFx.changed.length === 1,
    "peer boleh lulus kes fx_adjustment (adjust 0, di bawah ambang admin)");
  const rawAfterFx = await streamSummaryImpl("jnt", REMIT_PENDING_DAYS);
  eq(rawAfterFx, rawBeforeFx,
    "INVARIAN: angka mentah stream IDENTIK selepas kes fx_adjustment diluluskan");
  const aFx = decorate(rawAfterFx, await resolutionContext("jnt", TODAY))
    .resolutionSummary;
  ok(aFx.settledN === 1 && aFx.snoozedN === 0,
    `fx_adjustment SETTLE TERUS (settledN=${aFx.settledN} snoozedN=${aFx.snoozedN})`);
  ok(aFx.openN === aFx.exceptionN - 1,
    "baris fx_adjustment keluar dari kiraan terbuka (settled, bukan diparkir)");

  // ================================================================
  console.log(`\n=== E. GUARD PROPOSE ===`);
  await clearResolutions();

  // 8) HARAM propose atas baris tally (disemak LIVE).
  const tallyId = await pickKat("jnt", "tally");
  ok(!!tallyId, `ada order tally untuk diuji (${tallyId})`);
  const pTally = await proposeResolutions({
    items: [{ subjectType: "order", subjectId: tallyId!, stream: "jnt" }],
    reason: "data_entry_error", actor: MAKER, isAdminActor: false,
    now: NOW, todayYmd: TODAY,
  });
  ok(pTally.created.length === 0, "baris tally: tiada kes dicipta");
  ok(pTally.rejected[0]?.why.includes("bukan baris exception"),
    `sebab jelas: ${pTally.rejected[0]?.why}`);
  const nAfterTally = (await getResolutions()).length;
  ok(nAfterTally === 0, "tiada baris tertinggal dalam DB selepas propose tally ditolak");

  // Status order (pending/returned/rejected) pun bukan populasi boleh-settle.
  const pendId = await pickKat("jnt", "pending");
  if (pendId) {
    const pPend = await proposeResolutions({
      items: [{ subjectType: "order", subjectId: pendId, stream: "jnt" }],
      reason: "data_entry_error", actor: MAKER, isAdminActor: false,
      now: NOW, todayYmd: TODAY,
    });
    ok(pPend.created.length === 0, "order berstatus 'pending' juga tak boleh di-settle");
  } else {
    console.log("  SKIP order 'pending' tiada dalam data dev");
  }

  // 9) Sanity amaun menolak adjustment melebihi beza / salah arah.
  await clearResolutions();
  const sub9 = jntSubs[2];
  const pOver = await proposeResolutions({
    items: itemsOf([sub9], "jnt"), reason: "partial_or_refund",
    adjustAmount: -(Math.abs(sub9.amount - sub9.expected) + 100),
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(pOver.created.length === 0 && pOver.rejected[0]?.why.includes("tidak munasabah"),
    `adjust melebihi beza DITOLAK: ${pOver.rejected[0]?.why}`);
  const pDir = await proposeResolutions({
    items: itemsOf([sub9], "jnt"), reason: "partial_or_refund",
    adjustAmount: Math.abs(sub9.amount - sub9.expected) / 2,   // arah bertentangan
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(pDir.created.length === 0 && pDir.rejected[0]?.why.includes("tidak munasabah"),
    `adjust salah arah DITOLAK: ${pDir.rejected[0]?.why}`);

  // Perlumbaan dua maker atas subjek sama: yang kedua ditolak (index unik separa).
  await clearResolutions();
  const pRace1 = await proposeResolutions({
    items: itemsOf(jntSubs.slice(3, 4), "jnt"), reason: "data_entry_error",
    actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  const pRace2 = await proposeResolutions({
    items: itemsOf(jntSubs.slice(3, 4), "jnt"), reason: "data_entry_error",
    actor: CHECKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(pRace1.created.length === 1 && pRace2.created.length === 0,
    "maker kedua atas subjek sama: ditolak (satu kes hidup sahaja)");
  ok(pRace2.rejected[0]?.why.includes("sudah wujud"),
    `sebab jelas: ${pRace2.rejected[0]?.why}`);

  // Selepas kes lama mati, subjek sama boleh dicadang semula + rantai supersedes.
  await withdrawResolutions({
    resolutionIds: [pRace1.created[0].resolutionId], actor: MAKER, now: NOW });
  const pRace3 = await proposeResolutions({
    items: itemsOf(jntSubs.slice(3, 4), "jnt"), reason: "data_entry_error",
    actor: CHECKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
  });
  ok(pRace3.created.length === 1, "subjek boleh dicadang semula selepas kes lama ditarik");
  const chained = (await getResolutions()).find(
    (r) => r.resolutionId === pRace3.created[0].resolutionId);
  ok(chained?.supersedes === pRace1.created[0].resolutionId,
    "rantai supersedes menuding kes sebelumnya");

  // Prepaid (CHIP) pun dilayan oleh laluan yang sama.
  await clearResolutions();
  const chip = await streamFacts("chip");
  const chipSub = [...chip.bySubject.values()].find((f) => f.lines === 1);
  if (chipSub) {
    const pChip = await proposeResolutions({
      items: itemsOf([chipSub], "chip"), reason: "data_entry_error",
      actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
    });
    ok(pChip.created.length === 1, "stream prepaid (CHIP) guna laluan yang sama");
    ok(Object.prototype.hasOwnProperty.call(PREPAID, "chip"),
      "chip memang stream prepaid (ruang nama kunci 'chip:')");
  }

  // ================================================================
  // Baris yang ADA bayaran padan tapi amaunnya GAGAL DIBACA masa ingest (parser
  // simpan NULL, bukan 0.0). Dulu snapshot membekukan RM 0.00: skrin Awaiting
  // approval / Settled papar "RM 0.00" selamanya, dan ambang kelulusan menilai
  // baris paling rosak dalam sistem sebagai kes terkecil (sentiasa laluan peer).
  // Sekarang: snapshot NULL + laluan ADMIN (fail closed).
  console.log(`\n=== F. AMAUN TAK DAPAT DIBACA (fail closed) ===`);
  await clearResolutions();

  // Tiru keadaan sebenar atas satu baris bil yang wujud, pulih dalam `finally`.
  const unreadOrder = await pickKat("jnt", "tally");
  ok(!!unreadOrder,
    `ada order tally untuk ditukar jadi 'tak dapat dibaca' (${unreadOrder})`);
  const trkRow = await getPool().query(
    "SELECT tracking FROM orders WHERE order_id = $1", [unreadOrder]);
  const unreadAwb = String(trkRow.rows[0]?.tracking ?? "");
  const lineRow = await getPool().query(
    "SELECT cod_amount FROM cod_bill_lines WHERE awb = $1", [unreadAwb]);
  const codAsal = Number(lineRow.rows[0]?.cod_amount ?? 0);
  ok(!!unreadAwb && codAsal > 0,
    `baris bil asal ada amaun (awb ${unreadAwb}, RM ${codAsal})`);

  try {
    await getPool().query(
      "UPDATE cod_bill_lines SET cod_amount = NULL WHERE awb = $1", [unreadAwb]);

    const gKey: SubjectKey = { subjectType: "order", subjectId: unreadOrder! };
    const gFact = (await streamFacts("jnt")).bySubject.get(subjectKeyStr(gKey));
    ok(gFact?.amountUnreadable === true,
      `fakta hidup menanda amaun tak dapat dibaca (kategori '${gFact?.category}')`);
    ok(gFact?.amount === 0,
      "amount kekal 0 untuk aritmetik, bendera yang bawa kebenaran");
    ok(gFact?.lines === 1, "satu baris hidup (guard multi line tak menghalang)");

    // Pintu propose: pelarasan bernombor DITOLAK (tiada apa nak diukur lawan).
    const gItems: ProposeItem[] = [
      { subjectType: "order", subjectId: unreadOrder!, stream: "jnt" }];
    const gAdj = await proposeResolutions({
      items: gItems, reason: "partial_or_refund", adjustAmount: -50,
      actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
    });
    ok(gAdj.created.length === 0
      && !!gAdj.rejected[0]?.why.includes("tak dapat dibaca"),
      `pelarasan atas amaun tak dapat dibaca DITOLAK: ${gAdj.rejected[0]?.why}`);

    // Cadangan tanpa pelarasan tetap dibenarkan (itu keputusan, bukan angka).
    const gP = await proposeResolutions({
      items: gItems, reason: "data_entry_error", actor: MAKER,
      isAdminActor: false, now: NOW, todayYmd: TODAY,
    });
    ok(gP.created.length === 1, "kes atas baris tak-boleh-dibaca boleh DICADANG");
    const gLive = (await getResolutions())[0];
    ok(gLive.amountSnapshot === null,
      `snapshot amaun disimpan NULL, BUKAN 0 (${gLive.amountSnapshot})`);
    ok((gLive.expectedSnapshot ?? 0) > 0,
      `expected_snapshot kekal nombor sebenar (${gLive.expectedSnapshot})`);
    const gEv = await getResolutionEvents(gP.created[0].resolutionId);
    ok(gEv[0]?.payload?.amount === null,
      "jejak event pun merekod amount null, bukan RM0 palsu");

    // GUARD 2b: peer TAK BOLEH lulus, walaupun adjust 0 dan bukan batch.
    let gThrew: ResolutionError | null = null;
    try {
      await decideResolutions({
        resolutionIds: [gP.created[0].resolutionId], action: "approve",
        actor: CHECKER, isAdminActor: false, now: NOW,
      });
    } catch (e) { gThrew = e as ResolutionError; }
    ok(gThrew?.status === 403 && gThrew.message.includes("tak dapat dibaca"),
      `peer lulus kes amaun tak diketahui: DITOLAK 403 (${gThrew?.message ?? "tiada ralat"})`);

    // Tapi peer BOLEH TOLAK: arah selamat tak perlu tunggu admin.
    const gRej = await decideResolutions({
      resolutionIds: [gP.created[0].resolutionId], action: "reject",
      actor: CHECKER, isAdminActor: false, now: NOW,
    });
    ok(gRej.changed.length === 1,
      "peer BOLEH tolak kes amaun tak diketahui (fail closed cuma pada kelulusan)");

    // Admin boleh lulus, dan bukti "apa yang pemutus nampak" kekal jujur.
    const gP2 = await proposeResolutions({
      items: gItems, reason: "data_entry_error", actor: MAKER,
      isAdminActor: false, now: NOW, todayYmd: TODAY,
    });
    const gAdmin = await decideResolutions({
      resolutionIds: [gP2.created[0].resolutionId], action: "approve",
      actor: ADMIN, isAdminActor: true, now: NOW,
    });
    ok(gAdmin.changed.length === 1, "admin lulus kes amaun tak dapat dibaca");
    ok(gAdmin.seen[0]?.amount === null,
      `bukti keputusan simpan amaun NULL, bukan RM 0.00 (${gAdmin.seen[0]?.amount})`);

    const gAgg = decorate(await streamSummaryImpl("jnt", REMIT_PENDING_DAYS),
      await resolutionContext("jnt", TODAY)).resolutionSummary;
    ok(gAgg.settledN === 1 && gAgg.staleN === 0,
      `kes dikira settled selagi fakta tak berubah (settledN=${gAgg.settledN})`);

    // Cap jari: "tak dapat dibaca" BERTUKAR jadi RM 0.00 SEBENAR ialah perubahan
    // fakta material walaupun kategori, stream dan expected semuanya sama, dan
    // walaupun nombornya kekal 0. Kalau cap jari mencap dua duanya "0.00",
    // perubahan ni lolos senyap dan kes kekal 'settled'.
    await getPool().query(
      "UPDATE cod_bill_lines SET cod_amount = 0 WHERE awb = $1", [unreadAwb]);
    const gFact0 = (await streamFacts("jnt")).bySubject.get(subjectKeyStr(gKey));
    ok(gFact0?.amountUnreadable === false && gFact0?.amount === 0,
      "RM 0.00 sebenar: bendera padam, nombor kekal 0");
    ok(gFact0?.category === gFact?.category,
      `kategori TAK berubah (${gFact0?.category}), cuma kebolehbacaan`);
    const gAgg0 = decorate(await streamSummaryImpl("jnt", REMIT_PENDING_DAYS),
      await resolutionContext("jnt", TODAY)).resolutionSummary;
    ok(gAgg0.settledN === 0 && gAgg0.staleN === 1,
      `kes TERBUKA SEMULA bila amaun tak-boleh-dibaca jadi RM 0.00 sebenar `
      + `(settledN=${gAgg0.settledN} staleN=${gAgg0.staleN})`);
  } finally {
    // Pulih baris bil, walau apa pun yang gagal di atas.
    await getPool().query(
      "UPDATE cod_bill_lines SET cod_amount = $2 WHERE awb = $1",
      [unreadAwb, codAsal]);
    await clearResolutions();
  }
  const pulih = await getPool().query(
    "SELECT cod_amount FROM cod_bill_lines WHERE awb = $1", [unreadAwb]);
  ok(Number(pulih.rows[0]?.cod_amount) === codAsal,
    `baris bil dipulihkan kepada RM ${codAsal} (dev DB bersih)`);

  // ================================================================
  // Kes SEBENAR yang sebab 'fx_adjustment' direka untuk: order Singapura yang
  // selling_price-nya RM tetap, tapi duit yang masuk KURANG SEDIKIT sebab kadar
  // tukaran mata wang. Snapshot dev tiada kes macam tu (sebab itu bahagian 7c
  // terpaksa uji fx_adjustment atas baris belum_remit), jadi di sini kita BINA
  // satu: ambil baris 'tally' yang selamat dan tolak RM12.50 dari amaun bil.
  // Nilainya KURANG SEDIKIT , bukan NULL, bukan 0 , itu yang membezakan
  // bahagian ni daripada bahagian F.
  // Semua tulisan dipulihkan dalam `finally` dan pemulihan tu DISAHKAN selepas.
  console.log(`\n=== G. AMOUNT_MISMATCH SINTETIK (kes Singapura + fx_adjustment) ===`);
  await clearResolutions();

  const FX_GAP = 12.5;                              // beza kecil, bawah ambang
  const BIG_GAP = round2(adminThreshold() + 20);    // beza besar, atas ambang
  const fxPick = await pickTallyLine(BIG_GAP + 20);
  ok(!!fxPick, `ada baris tally jnt selamat dengan selling_price > RM `
    + `${BIG_GAP + 20} untuk dijadikan mismatch sintetik (${fxPick?.orderId ?? "TIADA"})`);

  if (fxPick) {
    try {
      // --- 1. Bina kes: duit masuk KURANG RM12.50 dari selling_price.
      await setLineAmount(fxPick, round2(fxPick.price - FX_GAP));
      const f1 = await orderFact(fxPick.orderId);
      ok(f1?.category === "amount_mismatch",
        `kes sintetik jatuh kategori 'amount_mismatch' dalam recon (${f1?.category})`);
      ok(f1?.amountUnreadable === false,
        "amaun BOLEH dibaca (kes beza nombor, bukan nilai hilang macam bahagian F)");
      ok(f1?.lines === 1 && f1?.mixed === false,
        "satu baris hidup, tak bercampur (guard multi line tak menghalang)");
      ok(f1 !== undefined && f1.amount > 0,
        `duit masuk masih > 0, bukan sifar dan bukan NULL (RM ${f1?.amount})`);
      ok(f1 !== undefined && round2(f1.expected - f1.amount) === FX_GAP,
        `beza tepat RM ${FX_GAP} (jangka ${f1?.expected}, masuk ${f1?.amount})`);

      // --- 2. Alur penuh fx_adjustment atas kes tu.
      const rawBeforeSg = await streamSummaryImpl("jnt", REMIT_PENDING_DAYS);
      const pSg = await proposeResolutions({
        items: [{ subjectType: "order", subjectId: fxPick.orderId, stream: "jnt" }],
        reason: "fx_adjustment", adjustAmount: -FX_GAP,
        note: "order Singapura, duit masuk kurang sebab kadar tukaran",
        actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
      });
      ok(pSg.created.length === 1,
        `fx_adjustment dicadang atas baris amount_mismatch `
        + `(${pSg.rejected[0]?.why ?? "diterima"})`);
      const liveSg = (await getResolutions())[0];
      ok(liveSg?.categorySnapshot === "amount_mismatch",
        `snapshot kategori = amount_mismatch (${liveSg?.categorySnapshot})`);
      ok(liveSg?.amountSnapshot === round2(fxPick.price - FX_GAP)
        && liveSg?.expectedSnapshot === fxPick.price,
        `snapshot amaun sebenar disimpan (${liveSg?.amountSnapshot} lawan `
        + `jangka ${liveSg?.expectedSnapshot})`);
      ok(liveSg?.adjustAmount === -FX_GAP,
        `pelarasan = -${FX_GAP}, sama besar dengan beza (${liveSg?.adjustAmount})`);
      ok(liveSg?.expiresOn === null,
        `tiada tarikh luput, kelas cost bukan snooze (${liveSg?.expiresOn})`);

      // Sebelum diluluskan, baris tu MASIH terbuka (menunggu checker).
      const aPre = decorate(rawBeforeSg, await resolutionContext("jnt", TODAY))
        .resolutionSummary;
      ok(aPre.proposedN === 1 && aPre.settledN === 0,
        `sebelum kelulusan: menunggu checker, belum settled `
        + `(proposedN=${aPre.proposedN} settledN=${aPre.settledN})`);
      ok(aPre.openN === aPre.exceptionN,
        "sebelum kelulusan: baris masih dikira TERBUKA");

      // Laluan kelulusan ikut ambang: RM12.50 di bawah RM300, peer memadai.
      const dSg = await decideResolutions({
        resolutionIds: [pSg.created[0].resolutionId], action: "approve",
        actor: CHECKER, isAdminActor: false, now: NOW,
      });
      ok(dSg.changed.length === 1,
        `peer boleh lulus (adjust RM ${FX_GAP} bawah ambang RM ${adminThreshold()})`);
      ok(dSg.seen[0]?.amount === round2(fxPick.price - FX_GAP),
        `bukti keputusan simpan amaun sebenar, bukan RM0 (${dSg.seen[0]?.amount})`);

      // INVARIAN DUIT: settle tak menggerakkan sesen pun angka mentah.
      const rawAfterSg = await streamSummaryImpl("jnt", REMIT_PENDING_DAYS);
      eq(rawAfterSg, rawBeforeSg,
        "INVARIAN: streamSummary IDENTIK (deep equal) selepas kes mismatch di-settle");

      const decSg = decorate(rawAfterSg, await resolutionContext("jnt", TODAY));
      const aSg = decSg.resolutionSummary;
      ok(aSg.settledN === 1 && aSg.snoozedN === 0 && aSg.staleN === 0,
        `kes SETTLED terus selepas lulus (settledN=${aSg.settledN} `
        + `snoozedN=${aSg.snoozedN} staleN=${aSg.staleN})`);
      ok(aSg.openN === aSg.exceptionN - 1,
        `baris KELUAR dari senarai terbuka (openN=${aSg.openN} `
        + `daripada exceptionN=${aSg.exceptionN})`);
      const rowSg = decSg.integ.find((r) => r.order_id === fxPick.orderId);
      ok(!!rowSg, "baris mismatch muncul dalam senarai integriti (boleh dilencana)");
      ok(rowSg?.resolution?.settled === true && rowSg?.resolution?.stale === false,
        "lencana baris: settled DAN tidak stale");
      ok(rowSg?.resolution?.reason === "fx_adjustment"
        && rowSg?.resolution?.kelas === "cost",
        `lencana baris bawa sebab + kelas betul (${rowSg?.resolution?.reason} / `
        + `${rowSg?.resolution?.kelas})`);
      ok(rowSg?.resolution?.adjustAmount === -FX_GAP,
        `lencana baris bawa pelarasan -${FX_GAP} (${rowSg?.resolution?.adjustAmount})`);

      // Cap jari tak menyala PALSU: tulis semula amaun yang SAMA (re-upload
      // penyata identik) mesti biarkan kes kekal settled.
      await setLineAmount(fxPick, round2(fxPick.price - FX_GAP));
      const aSame = decorate(await streamSummaryImpl("jnt", REMIT_PENDING_DAYS),
        await resolutionContext("jnt", TODAY)).resolutionSummary;
      ok(aSame.settledN === 1 && aSame.staleN === 0,
        `re-upload amaun IDENTIK: kes kekal settled (staleN=${aSame.staleN})`);
      // Kontras (bukti cap jari memang hidup, bukan sekadar tak pernah menyala):
      // amaun bergerak RM2.50 -> kes terbuka semula.
      await setLineAmount(fxPick, round2(fxPick.price - FX_GAP - 2.5));
      const aMoved = decorate(await streamSummaryImpl("jnt", REMIT_PENDING_DAYS),
        await resolutionContext("jnt", TODAY)).resolutionSummary;
      ok(aMoved.settledN === 0 && aMoved.staleN === 1,
        `amaun bergerak RM2.50: kes jadi stale dan terbuka semula `
        + `(settledN=${aMoved.settledN} staleN=${aMoved.staleN})`);

      // --- 3. KES KAWALAN: beza melebihi ambang RM300 mesti naik admin.
      await clearResolutions();
      await setLineAmount(fxPick, round2(fxPick.price - BIG_GAP));
      const f2 = await orderFact(fxPick.orderId);
      ok(f2?.category === "amount_mismatch"
        && f2 !== undefined && round2(f2.expected - f2.amount) === BIG_GAP,
        `kes besar: beza RM ${BIG_GAP} kekal amount_mismatch (${f2?.category})`);
      ok(f2 !== undefined && f2.amount > 0,
        `duit masuk kes besar masih > 0 (RM ${f2?.amount})`);
      const pBigSg = await proposeResolutions({
        items: [{ subjectType: "order", subjectId: fxPick.orderId, stream: "jnt" }],
        reason: "fx_adjustment", adjustAmount: -BIG_GAP,
        actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
      });
      ok(pBigSg.created.length === 1,
        `kes fx RM ${BIG_GAP} boleh DICADANG oleh peer `
        + `(${pBigSg.rejected[0]?.why ?? "diterima"})`);
      let threwBigSg: ResolutionError | null = null;
      try {
        await decideResolutions({
          resolutionIds: [pBigSg.created[0].resolutionId], action: "approve",
          actor: CHECKER, isAdminActor: false, now: NOW,
        });
      } catch (e) { threwBigSg = e as ResolutionError; }
      ok(threwBigSg?.status === 403 && threwBigSg.message.includes("ambang"),
        `peer lulus fx RM ${BIG_GAP}: DITOLAK 403 `
        + `(${threwBigSg?.message ?? "tiada ralat"})`);
      const dBigSg = await decideResolutions({
        resolutionIds: [pBigSg.created[0].resolutionId], action: "approve",
        actor: ADMIN, isAdminActor: true, now: NOW,
      });
      ok(dBigSg.changed.length === 1, "admin lulus kes fx besar: OK");
      const aBigSg = decorate(await streamSummaryImpl("jnt", REMIT_PENDING_DAYS),
        await resolutionContext("jnt", TODAY)).resolutionSummary;
      ok(aBigSg.settledN === 1 && aBigSg.staleN === 0,
        `kes besar settled selepas admin lulus (settledN=${aBigSg.settledN})`);

      // NOTA DASAR (dicatat, bukan diandaikan): ambang admin dinilai atas
      // adjustAmount, BUKAN atas saiz beza baris. Jadi beza melebihi ambang yang
      // di-settle TANPA pelarasan bernombor (adjust 0) masih laluan peer.
      // Ujian ni merakam kelakuan sebenar , kalau dasar bertukar jadi "ambang
      // ikut beza baris", ia yang berbunyi dahulu.
      await clearResolutions();
      const pZero = await proposeResolutions({
        items: [{ subjectType: "order", subjectId: fxPick.orderId, stream: "jnt" }],
        reason: "fx_adjustment", adjustAmount: 0,
        actor: MAKER, isAdminActor: false, now: NOW, todayYmd: TODAY,
      });
      const dZero = await decideResolutions({
        resolutionIds: [pZero.created[0].resolutionId], action: "approve",
        actor: CHECKER, isAdminActor: false, now: NOW,
      });
      ok(dZero.changed.length === 1,
        `DASAR SEMASA: beza RM ${BIG_GAP} dengan adjust 0 masih boleh diluluskan `
        + "peer (ambang menilai adjustAmount, bukan beza baris)");
    } finally {
      // Pulih baris bil, walau apa pun yang gagal di atas.
      await setLineAmount(fxPick, fxPick.codAsal);
      await clearResolutions();
    }
    const sgPulih = await getPool().query(
      "SELECT cod_amount FROM cod_bill_lines WHERE awb = $1 AND bill_id = $2",
      [fxPick.awb, fxPick.billId]);
    ok(Number(sgPulih.rows[0]?.cod_amount) === fxPick.codAsal,
      `baris bil dipulihkan kepada RM ${fxPick.codAsal} (dev DB bersih)`);
    ok((await orderFact(fxPick.orderId)) === undefined,
      "order kembali 'tally' (keluar semula dari populasi boleh-settle)");
    ok((await getResolutions()).length === 0,
      "tiada kes ujian tertinggal dalam recon_resolutions");
  }

  // ================================================================
  console.log(`\n=== H. GREP , fail resolutions TAK BOLEH menulis ke jadual duit ===`);
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "lib", "resolutions.ts"), "utf8");
  // Buang komen dulu supaya nota penjelasan tak jadi positif palsu.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const MONEY_TABLES = [
    "orders", "order_skus", "cod_bill_lines", "cod_bills",
    "prepaid_payments", "wallet_txns", "sku_bottles", "bank_deposits",
  ];
  for (const t of MONEY_TABLES) {
    const re = new RegExp(
      `(insert\\s+into|update|delete\\s+from)\\s+${t}\\b`, "i");
    ok(!re.test(code), `lib/resolutions.ts tiada tulisan ke '${t}'`);
  }
  // Dan pastikan ia MEMANG menulis ke jadualnya sendiri (kalau tidak, grep di
  // atas lulus secara palsu sebab fail kosong dari SQL).
  ok(/insert\s+into\s+recon_resolutions/i.test(code),
    "lib/resolutions.ts memang menulis ke recon_resolutions (grep tak lulus palsu)");
  ok(/insert\s+into\s+recon_resolution_events/i.test(code),
    "lib/resolutions.ts memang menulis ke recon_resolution_events");

  // Bersih: jangan tinggalkan kes ujian dalam dev DB.
  await clearResolutions();

  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
