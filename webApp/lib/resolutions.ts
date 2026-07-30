// ====================================================================
// LAPISAN RESOLUTION , cara team finance "settle" baris exception recon.
//
// PRINSIP MUTLAK (baca dulu sebelum ubah apa apa di sini):
//   Settle tukar STATUS baris sahaja. TAK PERNAH tukar DUIT.
//   Tiada baris keluar dari baldi, tally tak naik, variance tak turun.
//
// Sebab tu fail ni:
//   , TIDAK PERNAH menulis ke orders / cod_bill_lines / cod_bills /
//     prepaid_payments. Ia cuma menulis ke dua jadualnya sendiri
//     (recon_resolutions + recon_resolution_events). Ada ujian grep yang
//     menguatkuasakan ni (scripts/testResolutions.ts, ujian 10).
//   , TIDAK PERNAH mengubah medan angka output recon. decorate() cuma MENAMBAH
//     medan baru. Ada ujian deep-equal yang menguatkuasakan ni (ujian 1).
//   , guna semula tmp_m enjin yang SAMA (buildTmpM / buildTmpMPrepaid) bila ia
//     perlu tahu fakta hidup satu baris. Tiada laluan kategori kedua.
//
// Corak sama dengan lib/streamRange.ts + lib/dateRange.ts: lapisan read-only /
// additive DI ATAS output recon, enjin langsung tak disentuh.
//
// DUA PAKSI IDENTITI (ini satu satunya yang stabil dalam sistem):
//   'order' -> orders.order_id            (baris sisi ORDER)
//   'awb'   -> cod_bill_lines.awb  ATAU   (baris sisi DUIT: duit_hantu,
//              prepaid_payments.order_ref  match_luar_skop, dsb)
// Kategori HARAM jadi kunci (belum_remit bertukar sendiri jadi hilang_lewat bila
// hari berganti). Stream HARAM jadi kunci (shipping_provider ditimpa bila fail
// Fighter baru diupload, order boleh berpindah stream). Kedua duanya disimpan
// sebagai SNAPSHOT sahaja, dan beza snapshot lawan fakta hidup = `stale`.
// ====================================================================
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { ensureResolutionTables } from "./resolutionsSchema";
import {
  AGED, INTEGRITY_EXC, PREPAID, REMIT_PENDING_DAYS, buildTmpM, buildTmpMPrepaid,
  type ExcRow, type GhostRow, type PrepaidKey, type StreamKey,
  type StreamSummary,
} from "./recon";

// ====================================================================
// 1. Jenis asas
// ====================================================================
export type SubjectType = "order" | "awb";
export type ResolutionState =
  | "proposed" | "approved" | "rejected" | "withdrawn" | "voided";

// Keadaan yang dianggap "hidup" (satu sahaja dibenarkan per subjek, dikuatkuasa
// oleh index unik separa dalam resolutionsSchema.ts).
export const LIVE_STATES: ResolutionState[] = ["proposed", "approved"];

export interface SubjectKey {
  subjectType: SubjectType;
  subjectId: string;
}

// Kelas sebab. Ia MAKLUMAT untuk finance (jenis lubang apa), bukan arahan
// perakaunan , tiada satu pun daripadanya menggerakkan duit.
//   cost     , duit memang tak sampai penuh sebab kos dipotong
//   revenue  , baki dipulangkan / order separa
//   data     , salah taip di hulu
//   loss     , diterima sebagai kerugian (admin sahaja)
//   snooze   , BUKAN settle. Cuma "jangan tanya saya sampai tarikh X"
//   register , baris duit didaftarkan tuannya (bukan bocor)
export type ReasonClass = "cost" | "revenue" | "data" | "loss" | "snooze" | "register";

export interface ReasonMeta {
  label: string;              // UI English penuh
  side: SubjectType | "both"; // paksi mana sebab ni sah dipakai
  kelas: ReasonClass;
  snooze: boolean;            // TAK PERNAH dikira settled
  wajibCounterparty: boolean;
  wajibRef: boolean;
  adminSahaja: boolean;
  minNote: number;            // panjang minimum nota (0 = tak wajib)
  bolehBatch: boolean;
  // Tooltip khusus sebab ni (English penuh). OPSIONAL: kalau kosong, UI jatuh
  // balik pada ayat generik ikut kelas/snooze (reasonHelp dalam ResolveModal).
  // Ia ditulis di sini, bukan dalam komponen, supaya UI tak pernah hardcode
  // pengetahuan tentang mana mana kod sebab.
  desc?: string;
}

// Enum TERTUTUP. Tambah sebab baru = tambah di sini sahaja; route dan UI baca
// dari registry ni, jadi tiada senarai kedua yang boleh jadi tak selaras.
export const REASONS = {
  // ---- sisi ORDER ----
  processing_fee: {
    label: "Processing fee deducted", side: "order", kelas: "cost",
    snooze: false, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  courier_adjustment: {
    label: "Courier adjustment", side: "order", kelas: "cost",
    snooze: false, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  // Order lintas sempadan (contoh Singapura): selling_price disimpan TETAP dalam
  // RM, tapi duit yang betul betul masuk bank sikit kurang sebab kadar tukaran
  // mata wang bergerak antara masa order dan masa duit settle. Ini PUNCA SAH
  // untuk baldi amount_mismatch, bukan bocor duit dan bukan salah taip.
  //
  // Sifatnya SAMA macam processing_fee / courier_adjustment: kelas `cost`, jadi
  // ia SETTLE TERUS bila diluluskan, BUKAN snooze , beza kadar tukaran itu fakta
  // yang dah muktamad, bukan sesuatu yang kita tunggu. Sisi ORDER sahaja sebab
  // amount_mismatch ialah kategori sisi order.
  //
  // KOD dalaman guna `fx` (currency exchange) sebab itu punca sebenar dan ia
  // kekal betul walaupun label skrin ditukar nanti , sama semangat dengan
  // `awaiting_bill_upload` yang kodnya kekal walau labelnya dah bertukar.
  fx_adjustment: {
    label: "Selling price adjustment", side: "order", kelas: "cost",
    snooze: false, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
    desc: "Selling price is fixed in MYR, but the payment settles after a "
      + "currency conversion, so a small gap is the exchange rate moving, "
      + "not a shortfall.",
  },
  partial_or_refund: {
    label: "Partial payment or refund", side: "order", kelas: "revenue",
    snooze: false, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  data_entry_error: {
    label: "Data entry error", side: "order", kelas: "data",
    snooze: false, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  // KOD dalaman kekal `awaiting_bill_upload` (ia dah wujud dalam DB). Yang
  // ditukar cuma LABEL yang team finance nampak, ikut permintaan mereka.
  awaiting_bill_upload: {
    label: "Bill not in yet", side: "order", kelas: "snooze",
    snooze: true, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  pending_recovery: {
    label: "Pending recovery", side: "order", kelas: "snooze",
    snooze: true, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  // Parcel hilang di tangan kurier. Sifatnya SAMA macam pending_recovery: ia
  // snooze (bukan settle kekal), sebab duit tu belum tentu mati , tuntutan
  // kurier boleh bayar balik. Sisi ORDER sahaja: parcel itu konsep order, baris
  // duit (awb) tak ada parcel untuk hilang.
  missing_parcel: {
    label: "Missing parcel", side: "order", kelas: "snooze",
    snooze: true, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
    desc: "Courier lost the parcel, waiting on their claim process.",
  },
  written_off: {
    label: "Written off", side: "order", kelas: "loss",
    snooze: false, wajibCounterparty: false, wajibRef: false,
    adminSahaja: true, minNote: 0, bolehBatch: true,
  },
  // ---- sisi AWB (baris duit) ----
  awaiting_order_upload: {
    label: "Awaiting order upload", side: "awb", kelas: "snooze",
    snooze: true, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  belongs_other_entity: {
    label: "Belongs to another entity", side: "awb", kelas: "register",
    snooze: false, wajibCounterparty: true, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  duplicate_line: {
    label: "Duplicate bill line", side: "awb", kelas: "register",
    snooze: false, wajibCounterparty: false, wajibRef: true,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  unattributed_income: {
    label: "Unattributed income", side: "awb", kelas: "register",
    snooze: false, wajibCounterparty: false, wajibRef: false,
    adminSahaja: false, minNote: 0, bolehBatch: true,
  },
  // ---- kedua dua paksi ----
  // `other` sengaja dibuat menyakitkan: admin sahaja, nota minimum 20 aksara,
  // dan HARAM batch. Ia pintu keluar terakhir, bukan jalan pintas.
  other: {
    label: "Other (explain)", side: "both", kelas: "data",
    snooze: false, wajibCounterparty: false, wajibRef: false,
    adminSahaja: true, minNote: 20, bolehBatch: false,
  },
} as const satisfies Record<string, ReasonMeta>;

export type ReasonCode = keyof typeof REASONS;

export function isReasonCode(v: unknown): v is ReasonCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REASONS, v);
}

export function reasonMeta(code: ReasonCode): ReasonMeta {
  return REASONS[code];
}

// Senarai untuk UI (label + peraturan), supaya borang tak perlu hardcode apa apa.
export function reasonOptions(): (ReasonMeta & { code: ReasonCode })[] {
  return (Object.keys(REASONS) as ReasonCode[])
    .map((code) => ({ code, ...REASONS[code] }));
}

// ====================================================================
// 2. Konfigurasi (keputusan owner, boleh ubah lewat env tanpa deploy kod)
// ====================================================================
export const BATCH_HARD_MAX = 200;      // had teknikal satu permintaan
export const MAX_SNOOZE_DAYS = 30;      // snooze paling lama 30 hari

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Ambang RM: kes dengan |adjust_amount| melebihi ni WAJIB diputuskan admin.
export function adminThreshold(): number {
  return envNum("RESOLUTION_ADMIN_THRESHOLD_MYR", 300);
}

// Bilangan baris paling banyak yang seorang peer (bukan admin) boleh luluskan
// sekali gus. Lebih dari ni wajib admin.
export function peerBatchMax(): number {
  return envNum("RESOLUTION_PEER_BATCH_MAX", 50);
}

// ====================================================================
// 3. Kunci subjek , SATU tempat sahaja
// Semua kod lain WAJIB lalu sini. Kalau skema kunci berubah nanti (cth awb dapat
// prefix courier), satu fungsi ni je yang diubah.
// ====================================================================

// Ruang nama untuk baris DUIT. awb COD dan order_ref CHIP kedua dua duduk dalam
// lajur `awb` tmp_m, jadi tanpa prefix mereka boleh berlanggar.
export function moneyNs(stream: string): string {
  return Object.prototype.hasOwnProperty.call(PREPAID, stream) ? stream : "cod";
}

function subjectKeyOf(
  row: { order_id?: string | null; awb?: string | null }, stream: string,
): SubjectKey | null {
  const oid = (row.order_id ?? "").trim();
  if (oid) return { subjectType: "order", subjectId: oid };
  const awb = (row.awb ?? "").trim();
  if (awb) return { subjectType: "awb", subjectId: `${moneyNs(stream)}:${awb}` };
  return null;
}

// Baris exception sisi mana mana (ExcRow ada order_id DAN awb; order menang).
export function subjectKeyForExcRow(row: ExcRow, stream: string): SubjectKey | null {
  return subjectKeyOf(row, stream);
}

// GhostRow tiada order_id langsung (ia memang baris duit tanpa tuan), dan ia
// bawa streamKey sendiri, jadi tak perlu param stream.
export function subjectKeyForGhostRow(row: GhostRow): SubjectKey | null {
  return subjectKeyOf({ order_id: null, awb: row.awb }, row.streamKey);
}

// Kunci rata untuk Map / Set DAN untuk advisory lock Postgres. Pemisah '|'
// (bukan NUL): teks Postgres tak boleh simpan NUL, dan subjectType cuma dua
// nilai tetap tanpa '|', jadi 'order|X' lawan 'awb|X' tak mungkin berlanggar.
export function subjectKeyStr(k: SubjectKey): string {
  return `${k.subjectType}|${k.subjectId}`;
}

// ====================================================================
// 4. Pembundaran + cap jari
// ====================================================================

// ROUND_HALF_UP 2dp, sama semangat dengan reconcile.py:50-64 (half AWAY FROM
// ZERO). toFixed(6) dulu supaya 1.005 tak jatuh jadi 1.00 sebab wakilan binari.
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  const scaled = Number((Math.abs(n) * 100).toFixed(6));
  return (sign * Math.round(scaled)) / 100;
}

export interface MaterialFacts {
  stream: string;
  category: string;
  amount: number;    // duit MASUK untuk baris ni (cod_amount)
  expected: number;  // duit DIJANGKA (selling_price order)
  // TRUE = ada baris bayaran padan TAPI nilainya gagal dibaca masa ingest
  // (parser simpan NULL, bukan 0.0, lihat _amount_or_none dalam ingest.py).
  // "Tak dapat dibaca" BUKAN "RM 0.00" , ia fakta material yang BERBEZA, jadi ia
  // masuk cap jari. OPSIONAL dan lalai false supaya cap jari baris biasa kekal
  // BYTE IDENTIK dengan sebelum ni (kes prod sedia ada tak jadi stale).
  amountUnreadable?: boolean;
}

// Cap jari fakta MATERIAL sahaja. Kalau mana mana daripada empat ni berubah
// selepas kes diluluskan, keputusan itu dibuat atas dunia yang lain, jadi kes
// jadi `stale` dan BERHENTI dikira settled sampai orang tengok semula.
// Amaun dibundar dulu supaya nyatakan semula sen (0.1+0.2) tak flip kes.
//
// Amaun yang TAK DAPAT DIBACA dicap sebagai token "unreadable", bukan "0.00".
// Sebabnya dua: (1) ia jujur , kita memang tak tahu nilainya; (2) bila fail
// bersih diupload semula dan nilainya jadi RM 0.00 betul betul, cap jari
// BERUBAH, jadi kes lama terbuka semula untuk disemak. Kalau kedua duanya dicap
// "0.00", perubahan tu lolos senyap.
export function fingerprintOf(f: MaterialFacts): string {
  const canon = [
    "v1", f.stream, f.category,
    f.amountUnreadable ? "unreadable" : round2(f.amount).toFixed(2),
    round2(f.expected).toFixed(2),
  ].join("|");
  return createHash("sha256").update(canon).digest("hex");
}

// ====================================================================
// 5. Tarikh (teks "YYYY-MM-DD", tiada objek Date, immune zon waktu)
// ====================================================================
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && YMD_RE.test(v.trim());
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-`
    + `${String(t.getUTCDate()).padStart(2, "0")}`;
}

// ====================================================================
// 6. Bentuk baris resolution
// ====================================================================
export interface Resolution {
  resolutionId: string;
  subjectType: SubjectType;
  subjectId: string;
  streamSnapshot: string | null;
  categorySnapshot: string | null;
  // NULL ada MAKSUD: amaun baris tak dapat dibaca masa kes dicadang (ada baris
  // bayaran padan, nilainya rosak dalam fail). Ia BUKAN "RM 0.00" dan BUKAN
  // "tiada data". Kes lama (sebelum peraturan ni) sentiasa ada nombor, jadi NULL
  // tak pernah bermakna dua benda. Lihat proposeResolutions + decideResolutions.
  amountSnapshot: number | null;
  expectedSnapshot: number | null;
  fingerprint: string | null;
  reason: ReasonCode;
  note: string | null;
  adjustAmount: number;
  counterparty: string | null;
  duplicateRef: string | null;
  expiresOn: string | null;
  batchId: string | null;
  state: ResolutionState;
  proposedBy: string | null;
  proposedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  supersedes: string | null;
}

const RES_COLS = `
  resolution_id, subject_type, subject_id, stream_snapshot, category_snapshot,
  amount_snapshot, expected_snapshot, fingerprint, reason, note, adjust_amount,
  counterparty, duplicate_ref, expires_on, batch_id, state, proposed_by,
  proposed_at, decided_by, decided_at, decision_note, supersedes`;

function mapResolution(r: Record<string, unknown>): Resolution {
  return {
    resolutionId: r.resolution_id as string,
    subjectType: r.subject_type as SubjectType,
    subjectId: r.subject_id as string,
    streamSnapshot: (r.stream_snapshot as string | null) ?? null,
    categorySnapshot: (r.category_snapshot as string | null) ?? null,
    amountSnapshot: r.amount_snapshot == null ? null : Number(r.amount_snapshot),
    expectedSnapshot: r.expected_snapshot == null ? null : Number(r.expected_snapshot),
    fingerprint: (r.fingerprint as string | null) ?? null,
    reason: r.reason as ReasonCode,
    note: (r.note as string | null) ?? null,
    adjustAmount: r.adjust_amount == null ? 0 : Number(r.adjust_amount),
    counterparty: (r.counterparty as string | null) ?? null,
    duplicateRef: (r.duplicate_ref as string | null) ?? null,
    expiresOn: (r.expires_on as string | null) ?? null,
    batchId: (r.batch_id as string | null) ?? null,
    state: r.state as ResolutionState,
    proposedBy: (r.proposed_by as string | null) ?? null,
    proposedAt: (r.proposed_at as string | null) ?? null,
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    supersedes: (r.supersedes as string | null) ?? null,
  };
}

// Semua kes HIDUP (proposed + approved). SENGAJA tiada unstable_cache: ia rekod
// kawalan, mesti segar setiap kali (ikut corak getBankDeposits, lib/bank.ts).
export async function getResolutions(): Promise<Resolution[]> {
  await ensureResolutionTables();
  const res = await getPool().query(
    `SELECT ${RES_COLS} FROM recon_resolutions
      WHERE state = ANY($1) ORDER BY proposed_at, resolution_id`, [LIVE_STATES]);
  return res.rows.map(mapResolution);
}

// Sejarah PENUH satu subjek (semua keadaan), untuk panel drill UI.
export async function getResolutionsForSubject(
  k: SubjectKey,
): Promise<Resolution[]> {
  await ensureResolutionTables();
  const res = await getPool().query(
    `SELECT ${RES_COLS} FROM recon_resolutions
      WHERE subject_type = $1 AND subject_id = $2
      ORDER BY proposed_at DESC, resolution_id DESC`,
    [k.subjectType, k.subjectId]);
  return res.rows.map(mapResolution);
}

export interface ResolutionEvent {
  eventId: string; resolutionId: string; event: string;
  actor: string | null; at: string | null;
  payload: Record<string, unknown> | null;
}

export async function getResolutionEvents(
  resolutionId: string,
): Promise<ResolutionEvent[]> {
  await ensureResolutionTables();
  const res = await getPool().query(
    `SELECT event_id, resolution_id, event, actor, at, payload
       FROM recon_resolution_events
      WHERE resolution_id = $1 ORDER BY at, event_id`, [resolutionId]);
  return res.rows.map((r) => ({
    eventId: r.event_id as string, resolutionId: r.resolution_id as string,
    event: r.event as string, actor: (r.actor as string | null) ?? null,
    at: (r.at as string | null) ?? null,
    payload: (r.payload as Record<string, unknown> | null) ?? null,
  }));
}

// ====================================================================
// 7. Fakta HIDUP dari tmp_m enjin
//
// KENAPA perlu: `stale` mesti dikira lawan dunia SEKARANG, bukan lawan apa yang
// klien hantar. Dan kiraan agregat settled/snoozed mesti datang dari populasi
// PENUH, bukan dari senarai `integ`/`aged` yang bertutup EXC_CAP 5000.
//
// Ini SELECT tulen atas tmp_m yang dibina enjin. Tiada CASE kategori, tiada
// logik recon di sini. Transaksi di-ROLLBACK, jadi sifar tulisan.
// ====================================================================
export interface LiveFact {
  subjectType: SubjectType;
  subjectId: string;
  stream: string;
  category: string;
  amount: number;    // SUM(cod_amount)
  expected: number;  // SUM(selling_price)
  value: number;     // duit terlibat = cod_amount kalau ada, kalau tak selling_price
  lines: number;     // berapa baris tmp_m hidup untuk subjek ni (guard multi-line)
  mixed: boolean;    // baris subjek ni tak sekategori (mesti multi-line juga)
  // Ada baris bayaran padan (awb / order_ref bukan NULL) TAPI cod_amount NULL =
  // nilai gagal dibaca masa ingest. `amount` di atas kekal 0 (SUM COALESCE)
  // supaya aritmetik sedia ada tak pecah; bendera ni yang bawa kebenarannya.
  amountUnreadable: boolean;
}

export interface StreamFacts {
  stream: string;
  exceptionN: number;      // KIRAAN PENUH baris bukan-tally (bukan senarai bertutup)
  exceptionValue: number;
  bySubject: Map<string, LiveFact>;
}

// Populasi baris yang BOLEH di-settle. SENARAI PUTIH, bukan "semua yang bukan
// tally" , sebab tmp_m turut mengandungi kategori status order (returned,
// rejected, pending) yang BUKAN lubang duit, cuma order yang belum siap. Kalau
// mereka masuk, finance nampak barisan kerja palsu dan boleh "settle" order yang
// memang tak perlu apa apa.
//
// Senarai ni = INTEGRITY_EXC + AGED + dua baldi menunggu (belum_remit sisi COD,
// belum_bayar sisi prepaid). Ia padan tepat 7 kategori pecahan cermin prod
// (1,504 baris): hilang_lewat, duit_hantu, duit_masuk_order_returned,
// belum_bayar, match_luar_skop, belum_remit, amount_mismatch.
export const RESOLVABLE_KATS: string[] = [
  ...INTEGRITY_EXC, ...AGED, "belum_remit", "belum_bayar",
];

const FACTS_SQL = `
  SELECT (order_id IS NOT NULL) AS is_order,
         COALESCE(order_id, awb) AS raw_id,
         COUNT(*)::int AS lines,
         SUM(COALESCE(cod_amount, 0))::float8 AS amount,
         SUM(COALESCE(selling_price, 0))::float8 AS expected,
         SUM(COALESCE(cod_amount, selling_price, 0))::float8 AS value,
         -- Baris bayaran padan WUJUD (awb bukan NULL) tapi amaunnya NULL =
         -- nilai gagal dibaca masa ingest. Isyarat SAMA yang dipakai
         -- components/AmountCell.tsx, diambil dari data bukan dari kategori.
         BOOL_OR(awb IS NOT NULL AND cod_amount IS NULL) AS amount_unreadable,
         MIN(kategori) AS kat_min,
         MAX(kategori) AS kat_max
    FROM tmp_m
   WHERE kategori = ANY($1) AND COALESCE(order_id, awb) IS NOT NULL
   GROUP BY 1, 2`;

const FACTS_TOTAL_SQL = `
  SELECT COUNT(*)::int AS n,
         SUM(COALESCE(cod_amount, selling_price, 0))::float8 AS v
    FROM tmp_m WHERE kategori = ANY($1)`;

function isPrepaid(stream: string): stream is PrepaidKey {
  return Object.prototype.hasOwnProperty.call(PREPAID, stream);
}

async function readFacts(c: PoolClient, stream: string): Promise<StreamFacts> {
  const ns = moneyNs(stream);
  const rows = await c.query(FACTS_SQL, [RESOLVABLE_KATS]);
  const total = await c.query(FACTS_TOTAL_SQL, [RESOLVABLE_KATS]);
  const bySubject = new Map<string, LiveFact>();
  for (const r of rows.rows) {
    const isOrder = r.is_order === true;
    const raw = String(r.raw_id ?? "").trim();
    if (!raw) continue;
    const f: LiveFact = {
      subjectType: isOrder ? "order" : "awb",
      subjectId: isOrder ? raw : `${ns}:${raw}`,
      stream,
      category: String(r.kat_min),
      amount: Number(r.amount ?? 0),
      expected: Number(r.expected ?? 0),
      value: Number(r.value ?? 0),
      lines: Number(r.lines ?? 0),
      mixed: String(r.kat_min) !== String(r.kat_max),
      amountUnreadable: r.amount_unreadable === true,
    };
    bySubject.set(subjectKeyStr(f), f);
  }
  return {
    stream,
    exceptionN: Number(total.rows[0]?.n ?? 0),
    exceptionValue: Number(total.rows[0]?.v ?? 0),
    bySubject,
  };
}

// Fakta hidup satu stream (courier atau prepaid). READ-ONLY: BEGIN -> bina tmp_m
// -> SELECT -> ROLLBACK.
export async function streamFacts(
  stream: StreamKey | PrepaidKey | string,
  pendingDays: number = REMIT_PENDING_DAYS,
): Promise<StreamFacts> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (isPrepaid(stream)) await buildTmpMPrepaid(client, stream);
    else await buildTmpM(client, stream as StreamKey, pendingDays);
    const out = await readFacts(client, stream);
    await client.query("ROLLBACK");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ====================================================================
// 8. Konteks overlay , bahan yang decorate() perlukan
//
// PENTING (kos): fakta hidup HANYA diambil bila memang ada kes hidup. Selagi
// finance belum guna ciri ni, kos overlay = satu COUNT(*) atas jadual kecil,
// bukan satu lagi pusingan enjin recon.
// ====================================================================
export interface ResolutionContext {
  stream: string;
  resolutions: Resolution[];        // kes hidup (semua stream, ditapis dalam decorate)
  facts: Map<string, LiveFact>;
  factsLoaded: boolean;
  exceptionN: number;
  exceptionValue: number;
  todayYmd: string;                 // untuk kira snooze luput
}

export const EMPTY_CONTEXT = (stream: string, todayYmd: string): ResolutionContext => ({
  stream, resolutions: [], facts: new Map(), factsLoaded: false,
  exceptionN: 0, exceptionValue: 0, todayYmd,
});

async function countLive(): Promise<number> {
  await ensureResolutionTables();
  const r = await getPool().query(
    `SELECT COUNT(*)::int AS n FROM recon_resolutions WHERE state = ANY($1)`,
    [LIVE_STATES]);
  return Number(r.rows[0]?.n ?? 0);
}

export async function resolutionContext(
  stream: StreamKey | PrepaidKey | string,
  todayYmd: string,
  pendingDays: number = REMIT_PENDING_DAYS,
): Promise<ResolutionContext> {
  if ((await countLive()) === 0) return EMPTY_CONTEXT(stream, todayYmd);
  const [resolutions, facts] = await Promise.all([
    getResolutions(), streamFacts(stream, pendingDays),
  ]);
  return {
    stream, resolutions, facts: facts.bySubject, factsLoaded: true,
    exceptionN: facts.exceptionN, exceptionValue: facts.exceptionValue, todayYmd,
  };
}

// ====================================================================
// 9. decorate , FUNGSI TULEN. Tiada DB, tiada masa, boleh diuji sendiri.
// Ia HANYA TAMBAH medan. katN / katCod / linesCod / linesFee / daily / perBill /
// integRisk dan kawan kawan disalin bulat bulat.
// ====================================================================
export interface RowResolution {
  resolutionId: string;
  state: ResolutionState;
  reason: ReasonCode;
  reasonLabel: string;
  kelas: ReasonClass;
  stale: boolean;     // fakta hidup dah lari dari snapshot , kes terbuka semula
  snoozed: boolean;   // sebab jenis snooze DAN belum luput
  expired: boolean;   // snooze yang dah lepas expires_on , terbuka semula
  settled: boolean;   // approved + tidak stale + bukan snooze
  by: string | null;  // siapa yang putuskan (kalau belum, siapa yang cadang)
  at: string | null;
  expiresOn: string | null;
  note: string | null;
  adjustAmount: number;
}

export type ResolvedExcRow = ExcRow & { resolution?: RowResolution };
export type ResolvedGhostRow = GhostRow & { resolution?: RowResolution };

export interface ResolutionAggregate {
  stream: string;
  loaded: boolean;
  // Kiraan overlay ialah kiraan STREAM PENUH (semua masa). Ia SENGAJA tidak
  // ikut penapis tarikh: settle ialah keputusan atas satu BARIS, bukan atas
  // tetingkap paparan. UI mesti label ikut ini supaya angka tak disalah baca.
  scope: "streamAllTime";
  exceptionN: number; exceptionValue: number;
  settledN: number; settledValue: number;
  snoozedN: number; snoozedValue: number;
  openN: number; openValue: number;
  proposedN: number;   // menunggu checker (masih terbuka)
  staleN: number;      // fakta berubah selepas keputusan
  expiredN: number;    // snooze luput
  orphanN: number;     // subjek dah tiada dalam populasi exception stream ni
}

export interface ResolutionOverlay {
  integ: ResolvedExcRow[];
  aged: ResolvedExcRow[];
  auditPreview: ResolvedExcRow[];
  resolutionSummary: ResolutionAggregate;
}

// Hasil decorate: SEMUA medan asal T dikekalkan, cuma tiga senarai baris ditukar
// jadi versi berlencana (ExcRow + medan `resolution` opsional) dan satu blok
// agregat ditambah. Omit dipakai supaya `row.resolution` betul betul wujud dalam
// jenis, bukan tersembunyi dalam persilangan ExcRow[] & ResolvedExcRow[].
export type Decorated<T extends StreamSummary> =
  Omit<T, "integ" | "aged" | "auditPreview"> & ResolutionOverlay;

// Fakta hidup daripada satu baris (fallback bila facts DB tak dimuatkan).
function factFromRow(row: ExcRow, stream: string): MaterialFacts {
  return {
    stream, category: row.kategori,
    amount: row.cod_amount ?? 0, expected: row.selling_price ?? 0,
    // awb ada tapi cod_amount NULL = nilai gagal dibaca (bukan "tiada bayaran").
    amountUnreadable: row.cod_amount == null && row.awb != null,
  };
}

// Status satu kes lawan fakta hidup. Dipakai untuk baris DAN untuk agregat,
// supaya angka besar dan lencana kecil tak pernah bercanggah.
function evaluate(
  r: Resolution, live: MaterialFacts | null, todayYmd: string,
): { stale: boolean; snoozed: boolean; expired: boolean; settled: boolean } {
  const meta = REASONS[r.reason] ?? null;
  const stale = live == null
    ? true
    : fingerprintOf(live) !== (r.fingerprint ?? "");
  const isSnooze = meta?.snooze === true;
  const expired = isSnooze && !!r.expiresOn && todayYmd > r.expiresOn;
  const active = r.state === "approved" && !stale;
  return {
    stale,
    snoozed: active && isSnooze && !expired,
    expired: active && expired,
    settled: active && !isSnooze,
  };
}

function indexLive(resolutions: Resolution[]): Map<string, Resolution> {
  const m = new Map<string, Resolution>();
  for (const r of resolutions) {
    if (!LIVE_STATES.includes(r.state)) continue;
    m.set(subjectKeyStr(r), r);
  }
  return m;
}

function rowBadge(
  r: Resolution, ev: ReturnType<typeof evaluate>,
): RowResolution {
  const meta = REASONS[r.reason];
  return {
    resolutionId: r.resolutionId,
    state: r.state,
    reason: r.reason,
    reasonLabel: meta?.label ?? r.reason,
    kelas: meta?.kelas ?? "data",
    stale: ev.stale, snoozed: ev.snoozed, expired: ev.expired, settled: ev.settled,
    by: r.decidedBy ?? r.proposedBy ?? null,
    at: r.decidedAt ?? r.proposedAt ?? null,
    expiresOn: r.expiresOn,
    note: r.note,
    adjustAmount: r.adjustAmount,
  };
}

export function decorate<T extends StreamSummary>(
  s: T, ctx: ResolutionContext,
): Decorated<T> {
  const live = indexLive(ctx.resolutions);

  const tag = (row: ExcRow): ResolvedExcRow => {
    const k = subjectKeyForExcRow(row, ctx.stream);
    if (!k) return row;
    const r = live.get(subjectKeyStr(k));
    if (!r) return row;
    const fact = ctx.facts.get(subjectKeyStr(k));
    const material: MaterialFacts = fact
      ? { stream: ctx.stream, category: fact.category,
          amount: fact.amount, expected: fact.expected,
          amountUnreadable: fact.amountUnreadable }
      : factFromRow(row, ctx.stream);
    return { ...row, resolution: rowBadge(r, evaluate(r, material, ctx.todayYmd)) };
  };

  // Agregat: diambil dari jadual resolutions (dijoin dengan fakta hidup),
  // BUKAN dengan imbas senarai integ/aged yang bertutup EXC_CAP.
  const agg: ResolutionAggregate = {
    stream: ctx.stream, loaded: ctx.factsLoaded, scope: "streamAllTime",
    exceptionN: ctx.exceptionN, exceptionValue: round2(ctx.exceptionValue),
    settledN: 0, settledValue: 0, snoozedN: 0, snoozedValue: 0,
    openN: 0, openValue: 0,
    proposedN: 0, staleN: 0, expiredN: 0, orphanN: 0,
  };

  if (ctx.factsLoaded) {
    let settledValue = 0, snoozedValue = 0;
    for (const r of ctx.resolutions) {
      if (!LIVE_STATES.includes(r.state)) continue;
      const fact = ctx.facts.get(subjectKeyStr(r));
      if (!fact) {
        // Subjek tak wujud dalam populasi exception stream ni. Boleh jadi ia
        // milik stream lain, atau failnya dipadam (kes yatim). Ia TIDAK dikira
        // apa apa di sini , sekadar dilapor supaya tak hilang senyap.
        if (r.streamSnapshot === ctx.stream) agg.orphanN += 1;
        continue;
      }
      const ev = evaluate(r, {
        stream: ctx.stream, category: fact.category,
        amount: fact.amount, expected: fact.expected,
        amountUnreadable: fact.amountUnreadable,
      }, ctx.todayYmd);
      if (r.state === "proposed") agg.proposedN += 1;
      if (ev.stale) { agg.staleN += 1; continue; }
      if (ev.expired) { agg.expiredN += 1; continue; }
      if (ev.snoozed) { agg.snoozedN += fact.lines; snoozedValue += fact.value; }
      else if (ev.settled) { agg.settledN += fact.lines; settledValue += fact.value; }
    }
    agg.settledValue = round2(settledValue);
    agg.snoozedValue = round2(snoozedValue);
    agg.openN = agg.exceptionN - agg.settledN - agg.snoozedN;
    agg.openValue = round2(agg.exceptionValue - agg.settledValue - agg.snoozedValue);
  }

  return {
    ...s,
    integ: s.integ.map(tag),
    aged: s.aged.map(tag),
    auditPreview: s.auditPreview.map(tag),
    resolutionSummary: agg,
  } as Decorated<T>;
}

// Versi baris duit hantu (page Not collected). Sama logik, paksi awb sahaja.
export function decorateGhostRows(
  rows: GhostRow[], ctx: ResolutionContext,
): ResolvedGhostRow[] {
  const live = indexLive(ctx.resolutions);
  return rows.map((row) => {
    const k = subjectKeyForGhostRow(row);
    if (!k) return row;
    const r = live.get(subjectKeyStr(k));
    if (!r) return row;
    const fact = ctx.facts.get(subjectKeyStr(k));
    const material: MaterialFacts = fact
      ? { stream: fact.stream, category: fact.category,
          amount: fact.amount, expected: fact.expected,
          amountUnreadable: fact.amountUnreadable }
      // Baris ghost SENTIASA datang dari baris duit masuk, jadi cod_amount NULL
      // di sini bermakna nilainya gagal dibaca, bukan "tiada bayaran".
      : { stream: row.streamKey, category: "duit_hantu",
          amount: row.cod_amount ?? 0, expected: 0,
          amountUnreadable: row.cod_amount == null };
    return { ...row, resolution: rowBadge(r, evaluate(r, material, ctx.todayYmd)) };
  });
}

// ====================================================================
// 10. TULISAN , propose / decide / withdraw
// Semua tulisan HANYA ke recon_resolutions + recon_resolution_events.
// ====================================================================
export interface ProposeItem {
  subjectType: SubjectType;
  subjectId: string;
  stream: string;
  // category / amount / expected yang klien hantar SENGAJA diabaikan untuk
  // snapshot; ia cuma petunjuk. Snapshot + fingerprint sentiasa diambil dari
  // fakta HIDUP (guard 5: semak LIVE, bukan ikut hantaran klien).
  category?: string;
  amount?: number;
  expected?: number;
}

export interface ProposeInput {
  items: ProposeItem[];
  reason: ReasonCode;
  note?: string | null;
  adjustAmount?: number | null;
  counterparty?: string | null;
  duplicateRef?: string | null;
  expiresOn?: string | null;
  actor: string;
  isAdminActor: boolean;
  now: string;       // ISO timestamp
  todayYmd: string;  // "YYYY-MM-DD" rujukan app (reconTodayYmd)
  pendingDays?: number;
}

export interface RejectedItem {
  subjectType: SubjectType; subjectId: string; why: string;
}

export interface ProposeResult {
  batchId: string | null;
  created: { resolutionId: string; subjectType: SubjectType; subjectId: string }[];
  rejected: RejectedItem[];
}

// Ralat yang route terjemah jadi status HTTP tertentu.
export class ResolutionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ResolutionError";
    this.status = status;
  }
}

// Guard sanity amaun (guard 3): pelarasan tak boleh LEBIH BESAR dari beza, dan
// mesti sama ARAH dengan beza. Langgar = tolak, bukan amaran.
// Toleransi 1 sen supaya pembundaran tak jadi penolak palsu.
export function amountSane(adjust: number, amount: number, expected: number): boolean {
  const adj = round2(adjust);
  if (adj === 0) return true;
  const diff = round2(amount - expected);
  if (diff === 0) return false;
  if (Math.sign(adj) !== Math.sign(diff)) return false;
  return Math.abs(adj) <= Math.abs(diff) + 0.01;
}

// Guard PER ITEM masa propose, FUNGSI TULEN supaya setiap penggera boleh diuji
// tanpa DB (dan supaya ujian boleh buktikan ia betul betul menggigit).
// Pulang null = item lulus, atau teks sebab kenapa ia ditolak.
//   guard 5  , baris mesti WUJUD dalam populasi boleh-settle yang HIDUP. Baris
//              tally (dan status order returned/rejected/pending) tiada dalam
//              populasi itu, jadi ia tertolak di sini. Disemak lawan fakta
//              hidup, bukan lawan apa yang klien hantar.
//   guard 4  , multi-line. Satu subjek dengan lebih satu baris hidup tak boleh
//              di-settle sekali gus, sebab duitnya tersebar antara baris.
//   guard 3  , sanity amaun.
export function proposeItemProblem(
  key: SubjectKey, fact: LiveFact | null, reason: ReasonCode, adjust: number,
): string | null {
  if (!fact) {
    return "bukan baris exception hidup dalam stream ni (mungkin dah tally, "
      + "dah pindah stream, atau failnya dipadam)";
  }
  if (fact.lines > 1) return "multi line, resolve per bill line";
  if (fact.mixed) return "multi line, resolve per bill line";
  const meta = REASONS[reason];
  if (meta.side !== "both" && meta.side !== key.subjectType) {
    return `reason '${reason}' hanya untuk baris sisi ${meta.side}`;
  }
  // GUARD 3b (fail closed): amaun baris tak dapat dibaca -> pelarasan TAK BOLEH
  // diukur. amountSane() akan menilai baris ni seolah olah duit masuk RM0, jadi
  // pelarasan sebesar seluruh selling_price akan lulus "sanity" atas nilai yang
  // kita sebenarnya tak tahu. Tolak terus; betulkan failnya dulu.
  if (fact.amountUnreadable && round2(adjust) !== 0) {
    return "amaun baris tak dapat dibaca, adjustment tak boleh diukur lawan "
      + "nilai yang tak diketahui (upload semula penyata bersih dulu)";
  }
  if (!amountSane(adjust, fact.amount, fact.expected)) {
    return `adjustAmount ${round2(adjust).toFixed(2)} tidak munasabah lawan beza `
      + `${round2(fact.amount - fact.expected).toFixed(2)}`;
  }
  return null;
}

// Semak bentuk permintaan propose (tulen, tiada DB). Lempar ResolutionError.
function validateProposeShape(input: ProposeInput): { expiresOn: string | null } {
  if (!isReasonCode(input.reason)) {
    throw new ResolutionError(`reason tidak dikenali: ${String(input.reason)}`, 400);
  }
  const meta = REASONS[input.reason];
  const items = input.items ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    throw new ResolutionError("items kosong", 400);
  }
  if (items.length > BATCH_HARD_MAX) {
    throw new ResolutionError(
      `maksimum ${BATCH_HARD_MAX} item satu permintaan`, 400);
  }
  if (!meta.bolehBatch && items.length > 1) {
    throw new ResolutionError(
      `reason '${input.reason}' tidak boleh batch, cadang satu satu`, 400);
  }
  const note = (input.note ?? "").trim();
  if (meta.minNote > 0 && note.length < meta.minNote) {
    throw new ResolutionError(
      `reason '${input.reason}' perlu nota sekurang kurangnya ${meta.minNote} aksara`, 400);
  }
  if (meta.wajibCounterparty && !(input.counterparty ?? "").trim()) {
    throw new ResolutionError(
      `reason '${input.reason}' perlu counterparty`, 400);
  }
  if (meta.wajibRef && !(input.duplicateRef ?? "").trim()) {
    throw new ResolutionError(
      `reason '${input.reason}' perlu duplicate reference`, 400);
  }
  // Sebab admin-sahaja: pencadang pun kena admin. Kalau tidak, orang biasa boleh
  // banjirkan barisan dengan cadangan yang cuma admin boleh lulus.
  if (meta.adminSahaja && !input.isAdminActor) {
    throw new ResolutionError(
      `reason '${input.reason}' untuk admin sahaja`, 403);
  }

  let expiresOn: string | null = null;
  if (meta.snooze) {
    const maxOn = addDaysYmd(input.todayYmd, MAX_SNOOZE_DAYS);
    const want = (input.expiresOn ?? "").trim();
    expiresOn = want ? want : maxOn;
    if (!isYmd(expiresOn)) {
      throw new ResolutionError("expiresOn mesti YYYY-MM-DD", 400);
    }
    if (expiresOn <= input.todayYmd) {
      throw new ResolutionError("expiresOn mesti selepas hari ini", 400);
    }
    if (expiresOn > maxOn) {
      throw new ResolutionError(
        `snooze maksimum ${MAX_SNOOZE_DAYS} hari (sampai ${maxOn})`, 400);
    }
  }
  return { expiresOn };
}

export async function proposeResolutions(
  input: ProposeInput,
): Promise<ProposeResult> {
  await ensureResolutionTables();
  const { expiresOn } = validateProposeShape(input);
  const adjust = round2(Number(input.adjustAmount ?? 0));
  const pendingDays = input.pendingDays ?? REMIT_PENDING_DAYS;

  // Fakta HIDUP per stream terlibat. Sekali per stream, bukan sekali per item.
  const streams = [...new Set(input.items.map((i) => String(i.stream ?? "").trim()))];
  const factsByStream = new Map<string, StreamFacts>();
  for (const st of streams) {
    if (!st) continue;
    factsByStream.set(st, await streamFacts(st, pendingDays));
  }

  const rejected: RejectedItem[] = [];
  interface Ready {
    key: SubjectKey; fact: LiveFact; fingerprint: string;
  }
  const ready: Ready[] = [];
  const seenKey = new Set<string>();

  for (const it of input.items) {
    const st = String(it.stream ?? "").trim();
    const key: SubjectKey = {
      subjectType: it.subjectType, subjectId: String(it.subjectId ?? "").trim(),
    };
    const push = (why: string) =>
      rejected.push({ ...key, why });

    if (key.subjectType !== "order" && key.subjectType !== "awb") {
      push("subjectType mesti 'order' atau 'awb'"); continue;
    }
    if (!key.subjectId) { push("subjectId kosong"); continue; }
    const ks = subjectKeyStr(key);
    if (seenKey.has(ks)) { push("subjek berganda dalam permintaan sama"); continue; }
    seenKey.add(ks);

    const facts = factsByStream.get(st);
    if (!facts) { push(`stream tidak dikenali: ${st || "(kosong)"}`); continue; }

    const fact = facts.bySubject.get(ks);
    const problem = proposeItemProblem(key, fact ?? null, input.reason, adjust);
    if (problem) { push(problem); continue; }

    ready.push({
      key, fact: fact!,
      fingerprint: fingerprintOf({
        stream: fact!.stream, category: fact!.category,
        amount: fact!.amount, expected: fact!.expected,
        amountUnreadable: fact!.amountUnreadable,
      }),
    });
  }

  if (ready.length === 0) return { batchId: null, created: [], rejected };

  const batchId = input.items.length > 1 ? randomUUID() : null;
  const created: ProposeResult["created"] = [];
  const note = (input.note ?? "").trim() || null;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // GUARD 6a: advisory lock per subjek, disusun supaya dua batch yang
    // bertindih tak boleh deadlock (semua ambil kunci ikut turutan sama).
    const locks = ready.map((r) => subjectKeyStr(r.key)).sort();
    for (const l of locks) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [l]);
    }
    for (const r of ready) {
      // Rantai sejarah: kalau subjek ni pernah ada kes (yang dah mati), tuding
      // padanya supaya jejak keputusan tak putus.
      const prev = await client.query(
        `SELECT resolution_id FROM recon_resolutions
          WHERE subject_type = $1 AND subject_id = $2
          ORDER BY proposed_at DESC, resolution_id DESC LIMIT 1`,
        [r.key.subjectType, r.key.subjectId]);
      const supersedes = (prev.rows[0]?.resolution_id as string | undefined) ?? null;

      const id = randomUUID();
      // Snapshot amaun: NULL bila nilainya memang TAK DAPAT DIBACA. Menyimpan 0
      // di sini membekukan pembohongan , skrin Awaiting approval / Settled akan
      // papar "RM 0.00" selamanya, dan ambang kelulusan akan menilai kes tu
      // sebagai kes kecil. NULL = "kita tak tahu", dan setiap pembaca kena
      // melayannya begitu.
      const amountSnap = r.fact.amountUnreadable ? null : round2(r.fact.amount);
      // GUARD 6b: ON CONFLICT DO NOTHING atas index unik SEPARA. Maker kedua
      // yang berlumba subjek sama dapat rowCount 0 (route balas 409).
      const ins = await client.query(
        `INSERT INTO recon_resolutions (
           resolution_id, subject_type, subject_id, stream_snapshot,
           category_snapshot, amount_snapshot, expected_snapshot, fingerprint,
           reason, note, adjust_amount, counterparty, duplicate_ref, expires_on,
           batch_id, state, proposed_by, proposed_at, supersedes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 'proposed',$16,$17,$18)
         ON CONFLICT (subject_type, subject_id)
           WHERE state IN ('proposed', 'approved') DO NOTHING
         RETURNING resolution_id`,
        [id, r.key.subjectType, r.key.subjectId, r.fact.stream,
         r.fact.category, amountSnap, round2(r.fact.expected),
         r.fingerprint, input.reason, note, adjust,
         (input.counterparty ?? "").trim() || null,
         (input.duplicateRef ?? "").trim() || null,
         expiresOn, batchId, input.actor, input.now, supersedes]);

      if (!ins.rowCount) {
        rejected.push({ ...r.key, why: "kes hidup untuk subjek ni sudah wujud" });
        continue;
      }
      // GUARD 7: event ditulis dalam TRANSAKSI SAMA. Kalau insert kes berjaya
      // tapi event gagal, dua duanya rollback , tiada keputusan tanpa jejak.
      await client.query(
        `INSERT INTO recon_resolution_events
           (event_id, resolution_id, event, actor, at, payload)
         VALUES ($1, $2, 'proposed', $3, $4, $5::jsonb)`,
        [randomUUID(), id, input.actor, input.now, JSON.stringify({
          fingerprint: r.fingerprint, stream: r.fact.stream,
          category: r.fact.category, amount: amountSnap,
          expected: round2(r.fact.expected), adjustAmount: adjust,
          reason: input.reason, expiresOn, batchId,
        })]);
      created.push({ resolutionId: id, ...r.key });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { batchId, created, rejected };
}

// --------------------------------------------------------------------
export type DecideAction = "approve" | "reject" | "void";

export interface DecideInput {
  resolutionIds: string[];
  action: DecideAction;
  note?: string | null;
  actor: string;
  isAdminActor: boolean;
  now: string;
}

export interface DecideResult {
  action: DecideAction;
  changed: string[];
  failed: { resolutionId: string; why: string }[];
  // Apa yang pemutus NAMPAK masa dia buat keputusan (disimpan dalam event juga).
  seen: {
    resolutionId: string; fingerprint: string | null;
    amount: number | null; expected: number | null; adjustAmount: number;
  }[];
}

const STATE_FROM: Record<DecideAction, ResolutionState> = {
  approve: "proposed", reject: "proposed", void: "approved",
};
const STATE_TO: Record<DecideAction, ResolutionState> = {
  approve: "approved", reject: "rejected", void: "voided",
};

export async function decideResolutions(
  input: DecideInput,
): Promise<DecideResult> {
  await ensureResolutionTables();
  const ids = [...new Set((input.resolutionIds ?? []).map((s) => String(s ?? "").trim())
    .filter(Boolean))];
  if (ids.length === 0) throw new ResolutionError("resolutionIds kosong", 400);
  if (ids.length > BATCH_HARD_MAX) {
    throw new ResolutionError(`maksimum ${BATCH_HARD_MAX} kes satu permintaan`, 400);
  }
  if (!["approve", "reject", "void"].includes(input.action)) {
    throw new ResolutionError("action mesti approve / reject / void", 400);
  }
  const note = (input.note ?? "").trim() || null;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Baca calon DULU (FOR UPDATE) supaya semakan eskalasi dan snapshot "apa
    // yang pemutus nampak" datang dari baris yang sama yang akan dikemaskini.
    const cand = await client.query(
      `SELECT ${RES_COLS} FROM recon_resolutions
        WHERE resolution_id = ANY($1) ORDER BY resolution_id FOR UPDATE`, [ids]);
    const rows = cand.rows.map(mapResolution);

    // GUARD 2: eskalasi admin. Turutan keutamaan ikut spek , maker checker
    // (guard 1) dikuatkuasa di SQL bawah; eskalasi ni gate SEBELUM tulisan.
    if (!input.isAdminActor && input.action !== "reject") {
      const threshold = adminThreshold();
      const batchMax = peerBatchMax();
      const big = rows.find((r) => Math.abs(r.adjustAmount) > threshold);
      if (big) {
        throw new ResolutionError(
          `kes ${big.resolutionId} melebihi ambang RM ${threshold.toFixed(2)}, `
          + "wajib diputuskan admin", 403);
      }
      // GUARD 2b (FAIL CLOSED): amaun baris TAK DIKETAHUI. Ambang RM ni satu
      // satunya soalan "kes ni kecil ke besar" , dan nilai yang tak dapat
      // dibaca TIDAK BOLEH dijawab "kecil". Sebelum ni ia dibekukan jadi RM0,
      // maknanya baris paling rosak dalam sistem sentiasa lalu laluan peer.
      // Sekarang ia naik pada admin, sama macam kes yang melebihi ambang.
      // (Reject dikecualikan di atas: menolak kes sentiasa arah yang selamat.)
      const unknown = rows.find((r) => r.amountSnapshot == null);
      if (unknown) {
        throw new ResolutionError(
          `kes ${unknown.resolutionId}: amaun baris tak dapat dibaca, nilai yang `
          + `tak diketahui tak boleh dinilai bawah ambang RM ${threshold.toFixed(2)}, `
          + "wajib diputuskan admin", 403);
      }
      const adminOnly = rows.find((r) => REASONS[r.reason]?.adminSahaja);
      if (adminOnly) {
        throw new ResolutionError(
          `reason '${adminOnly.reason}' wajib diputuskan admin`, 403);
      }
      if (ids.length > batchMax) {
        throw new ResolutionError(
          `peer boleh putuskan maksimum ${batchMax} baris sekali gus `
          + `(diminta ${ids.length}), wajib admin`, 403);
      }
      // Anti salami: batch besar tak boleh dipecah jadi hirisan kecil supaya
      // lolos had peer. Kalau batch asalnya lebih besar dari had, ia milik admin.
      const batchIds = [...new Set(rows.map((r) => r.batchId).filter(Boolean))] as string[];
      if (batchIds.length) {
        const sizes = await client.query(
          `SELECT batch_id, COUNT(*)::int AS n FROM recon_resolutions
            WHERE batch_id = ANY($1) GROUP BY batch_id`, [batchIds]);
        const tooBig = sizes.rows.find((r) => Number(r.n) > batchMax);
        if (tooBig) {
          throw new ResolutionError(
            `batch ${tooBig.batch_id} ada ${tooBig.n} baris (had peer ${batchMax}), `
            + "wajib diputuskan admin", 403);
        }
      }
    }
    // Void membatalkan keputusan yang SUDAH siap. Ia admin sahaja , keputusan
    // sendiri (spek tak sebut), sebab ia menarik balik kawalan yang dah tutup.
    if (input.action === "void" && !input.isAdminActor) {
      throw new ResolutionError("void untuk admin sahaja", 403);
    }

    // GUARD 1: MAKER CHECKER DI SQL, bukan `if` dalam JS. Baris yang pencadangnya
    // sama dengan pemutus tak akan padan predikat, jadi rowCount kurang.
    // (Void tak terikat maker checker: ia dah lulus gate admin di atas.)
    const selfClause = input.action === "void"
      ? ""
      : "AND LOWER(COALESCE(proposed_by, '')) <> LOWER($4)";
    const upd = await client.query(
      `UPDATE recon_resolutions
          SET state = $2, decided_by = $4, decided_at = $5, decision_note = $6
        WHERE resolution_id = ANY($1) AND state = $3 ${selfClause}
        RETURNING resolution_id`,
      [ids, STATE_TO[input.action], STATE_FROM[input.action],
       input.actor, input.now, note]);
    const changed = (upd.rows as { resolution_id: string }[]).map((r) => r.resolution_id);
    const changedSet = new Set(changed);

    // Kenapa yang lain gagal , jawapan tepat, bukan "sesetengah gagal".
    const byId = new Map(rows.map((r) => [r.resolutionId, r]));
    const failed: DecideResult["failed"] = [];
    for (const id of ids) {
      if (changedSet.has(id)) continue;
      const r = byId.get(id);
      if (!r) { failed.push({ resolutionId: id, why: "kes tidak dijumpai" }); continue; }
      if (r.state !== STATE_FROM[input.action]) {
        failed.push({ resolutionId: id,
          why: `keadaan '${r.state}', tindakan '${input.action}' perlukan `
            + `'${STATE_FROM[input.action]}'` });
        continue;
      }
      failed.push({ resolutionId: id,
        why: "maker checker: pencadang tak boleh putuskan kes sendiri" });
    }

    const seen: DecideResult["seen"] = [];
    for (const id of changed) {
      const r = byId.get(id)!;
      seen.push({
        resolutionId: id, fingerprint: r.fingerprint,
        amount: r.amountSnapshot, expected: r.expectedSnapshot,
        adjustAmount: r.adjustAmount,
      });
      // GUARD 7: jejak dalam transaksi SAMA.
      await client.query(
        `INSERT INTO recon_resolution_events
           (event_id, resolution_id, event, actor, at, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [randomUUID(), id, input.action, input.actor, input.now,
         JSON.stringify({
           fingerprint: r.fingerprint, stream: r.streamSnapshot,
           category: r.categorySnapshot, amount: r.amountSnapshot,
           expected: r.expectedSnapshot, adjustAmount: r.adjustAmount,
           reason: r.reason, proposedBy: r.proposedBy,
           isAdminActor: input.isAdminActor, note,
         })]);
    }
    await client.query("COMMIT");
    return { action: input.action, changed, failed, seen };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------------
export interface WithdrawInput {
  resolutionIds: string[];
  actor: string;
  now: string;
  note?: string | null;
}

export interface WithdrawResult {
  changed: string[];
  failed: { resolutionId: string; why: string }[];
}

// Maker tarik balik cadangan SENDIRI yang belum diputuskan. Ini pasangan sah
// kepada maker checker: maker tak boleh LULUS kes sendiri, tapi dia boleh
// BATALKAN cadangan sendiri selagi belum ada checker sentuh.
export async function withdrawResolutions(
  input: WithdrawInput,
): Promise<WithdrawResult> {
  await ensureResolutionTables();
  const ids = [...new Set((input.resolutionIds ?? []).map((s) => String(s ?? "").trim())
    .filter(Boolean))];
  if (ids.length === 0) throw new ResolutionError("resolutionIds kosong", 400);
  if (ids.length > BATCH_HARD_MAX) {
    throw new ResolutionError(`maksimum ${BATCH_HARD_MAX} kes satu permintaan`, 400);
  }
  const note = (input.note ?? "").trim() || null;

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const cand = await client.query(
      `SELECT ${RES_COLS} FROM recon_resolutions
        WHERE resolution_id = ANY($1) ORDER BY resolution_id FOR UPDATE`, [ids]);
    const rows = cand.rows.map(mapResolution);
    const upd = await client.query(
      `UPDATE recon_resolutions
          SET state = 'withdrawn', decided_by = $2, decided_at = $3,
              decision_note = $4
        WHERE resolution_id = ANY($1) AND state = 'proposed'
          AND LOWER(COALESCE(proposed_by, '')) = LOWER($2)
        RETURNING resolution_id`,
      [ids, input.actor, input.now, note]);
    const changed = (upd.rows as { resolution_id: string }[]).map((r) => r.resolution_id);
    const changedSet = new Set(changed);
    const byId = new Map(rows.map((r) => [r.resolutionId, r]));
    const failed: WithdrawResult["failed"] = [];
    for (const id of ids) {
      if (changedSet.has(id)) continue;
      const r = byId.get(id);
      if (!r) { failed.push({ resolutionId: id, why: "kes tidak dijumpai" }); continue; }
      if (r.state !== "proposed") {
        failed.push({ resolutionId: id,
          why: `keadaan '${r.state}', withdraw hanya untuk 'proposed'` });
        continue;
      }
      failed.push({ resolutionId: id, why: "withdraw hanya untuk pencadang sendiri" });
    }
    for (const id of changed) {
      const r = byId.get(id)!;
      await client.query(
        `INSERT INTO recon_resolution_events
           (event_id, resolution_id, event, actor, at, payload)
         VALUES ($1, $2, 'withdrawn', $3, $4, $5::jsonb)`,
        [randomUUID(), id, input.actor, input.now, JSON.stringify({
          fingerprint: r.fingerprint, reason: r.reason, note,
        })]);
    }
    await client.query("COMMIT");
    return { changed, failed };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
