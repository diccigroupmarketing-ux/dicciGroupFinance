// Lapisan TAPIS JULAT TARIKH untuk page "Not collected" , READ-ONLY, additive.
//
// Corak SAMA macam lib/streamRange.ts dan lib/dashboardRange.ts, dan atas sebab
// yang sama:
//   1. Enjin recon TIDAK diubah. Kategori setiap baris tetap datang dari tmp_m
//      yang SAMA (buildTmpM / buildTmpMPrepaid dalam recon.ts, yang lulus harness
//      parity lawan reconSql.py). SQL di sini cuma SELECT, tiada CASE kategori,
//      tiada kiraan umur, tiada keputusan recon.
//   2. Tapis + agregat semula dibuat di TypeScript supaya jadi FUNGSI TULEN
//      (aggregateUncollected) yang boleh diuji tanpa Postgres.
//   3. Ambang aging (pendingDays) + RECON_TODAY LANGSUNG tak disentuh. Baris
//      hilang_lewat lawan belum_remit dikategorikan oleh enjin sebelum kita
//      nampak baris tu; julat tarikh cuma memilih baris MANA yang dipapar.
//
// KENAPA tarik baris sendiri, bukan tapis output uncollectedCourier(): fungsi
// enjin tu pulangkan senarai baris yang DICAP di EXC_CAP (5000) sedangkan
// kiraan overdueN/awaitingN/ghostN adalah kiraan PENUH. Kalau kita tapis senarai
// yang dah dicap lepas tu kira semula, angka boleh jadi kurang dari yang betul
// bila data melebihi cap. Jadi kita tarik baris PENUH (tiada LIMIT), tapis,
// kira semula, baru cap untuk paparan , persis susunan kerja enjin.
//
// KEPUTUSAN "Ghost money" (baris duit hantu):
//   Baris ghost ialah baris BIL tanpa order padan, jadi ia memang TIADA tarikh
//   order. Ia hanya ada tarikh SETTLEMENT (tarikh bil). Kawalan pada page ni
//   berlabel "Order date", jadi menapis ghost guna tarikh bil bermakna satu
//   kawalan membawa dua makna berlainan pada dua tab, dan angka Ghost money
//   boleh turun tanpa sebab yang team boleh terangkan. Ikut precedent projek
//   (streamRange.ts: baris tanpa tarikh order TAK PERNAH disorok), baris ghost
//   KEKAL dipapar penuh dalam setiap julat, dan bilangannya dilaporkan melalui
//   undatedGhost supaya nota jujur di bar penapis boleh sebut jumlahnya.
//
// JAMINAN "sifar kejutan": bila tiada param julat, page LANGSUNG tak masuk sini,
// dia panggil uncollectedCourier()/ghostPrepaid() lama macam biasa. Ujian
// scripts/testUncollectedRange.ts pula membuktikan versi ALL_TIME lapisan ni
// identik dengan output enjin, medan demi medan.
import { getPool } from "./db";
import {
  AGED, COURIERS, EXC_CAP, PREPAID, PrepaidKey, REMIT_PENDING_DAYS, StreamKey,
  buildTmpM, buildTmpMPrepaid, umurHari,
  type GhostRow, type NotCollectedRow, type UncollectedStream,
} from "./recon";
import { rowInRange, type DateRange } from "./dateRange";

// Kategori "belum kutip". Cermin NOT_COLLECTED_KATS dalam recon.ts (yang tak
// diekspot). AGED datang terus dari enjin supaya kalau enjin tukar takrif
// "lewat", sisi ni ikut sekali. Ujian All time akan menangkap kalau ia lari.
const AWAITING_KAT = "belum_remit";
export const NOT_COLLECTED_KATS = [...AGED, AWAITING_KAT];

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const cp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Bahan mentah satu stream, PENUH (tiada cap, tiada agregat). Diambil sekali,
// ditapis berkali kali.
export interface UncollectedRowBundle {
  streamKey: string;
  courier: string;
  notCollected: NotCollectedRow[];  // hilang_lewat + belum_remit
  ghost: GhostRow[];                // duit_hantu
}

export interface RangedUncollectedStream extends UncollectedStream {
  range: DateRange;
  totalRows: number;          // semua baris (belum kutip + ghost) sebelum tapis
  filteredRows: number;       // baris yang lulus tapis
  undatedRows: number;        // antara yang lulus: baris TANPA tarikh order
  undatedNotCollected: number; // pecahan: order yang feednya tiada tarikh
  undatedGhost: number;        // pecahan: baris bil tanpa order (semua ghost)
}

// ORDER BY order_date ASC , Postgres letak NULL di HUJUNG. Array.sort V8 stabil,
// jadi seri kekal ikut susunan asal baris (susunan yang DB pulangkan).
function byDateAsc(a: NotCollectedRow, b: NotCollectedRow): number {
  if (a.order_date === b.order_date) return 0;
  if (a.order_date == null) return 1;
  if (b.order_date == null) return -1;
  return cp(a.order_date, b.order_date);
}

// "Overdue" = kategori lewat ikut takrif enjin (AGED). Awaiting remit = baki.
const isOverdue = (r: NotCollectedRow) => AGED.includes(r.kategori);

// Baris "tiada tarikh order" = order yang tarikhnya kosong/rosak dalam feed.
function hasDate(v: string | null | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}/.test(v.trim());
}

// ====================================================================
// TERAS: agregat semula dari baris tertapis. FUNGSI TULEN , tiada DB, tiada
// masa, boleh diuji dengan bundle sintetik.
// ====================================================================
export function aggregateUncollected(
  b: UncollectedRowBundle, range: DateRange,
): RangedUncollectedStream {
  // Baris belum kutip ditapis ikut tarikh ORDER. Baris tanpa tarikh kekal
  // (rowInRange pulang true untuk null), sama peraturan macam page stream.
  const kept = b.notCollected.filter((r) => rowInRange(r.order_date, range));

  // Kiraan + nilai dikira dari SEMUA baris yang lulus (bukan dari senarai yang
  // dicap), sama macam enjin: rows dicap untuk paparan, kiraan kekal penuh.
  let overdueN = 0, overdueValue = 0, awaitingN = 0, awaitingValue = 0;
  for (const r of kept) {
    if (isOverdue(r)) { overdueN += 1; overdueValue += num(r.selling_price); }
    else if (r.kategori === AWAITING_KAT) { awaitingN += 1; awaitingValue += num(r.selling_price); }
  }

  // Mirror `ORDER BY m.order_date LIMIT EXC_CAP` enjin: cap dikenakan pada set
  // GABUNGAN dua kategori, baru dipecah ikut kategori.
  const shown = [...kept].sort(byDateAsc).slice(0, EXC_CAP);

  // Ghost: TIADA tarikh order, jadi tak pernah ditapis (lihat nota keputusan di
  // kepala fail). Susunan datang siap dari SQL bundle.
  const ghostN = b.ghost.length;
  const ghostValue = b.ghost.reduce((a, g) => a + num(g.cod_amount), 0);
  const ghostRows = b.ghost.slice(0, EXC_CAP);

  const undatedNotCollected = kept.reduce((a, r) => a + (hasDate(r.order_date) ? 0 : 1), 0);

  return {
    streamKey: b.streamKey, courier: b.courier,
    overdueRows: shown.filter(isOverdue),
    overdueN, overdueValue,
    awaitingRows: shown.filter((r) => r.kategori === AWAITING_KAT),
    awaitingN, awaitingValue,
    ghostRows, ghostN, ghostValue,
    capped: overdueN + awaitingN > EXC_CAP || ghostN > EXC_CAP,
    range,
    totalRows: b.notCollected.length + ghostN,
    filteredRows: kept.length + ghostN,
    undatedRows: undatedNotCollected + ghostN,
    undatedNotCollected,
    undatedGhost: ghostN,
  };
}

// ====================================================================
// Pengambilan bahan mentah. SQL sama isi macam uncollectedCourier/ghostPrepaid,
// TOLAK LIMIT (kita cap sendiri selepas tapis) dan tolak kuari agregat (kita
// kira sendiri dari baris).
// ====================================================================
function mapNotColl(
  rows: Record<string, unknown>[], key: string, courier: string,
): NotCollectedRow[] {
  return rows.map((r) => ({
    order_id: (r.order_id as string | null) ?? null,
    order_date: (r.order_date as string | null) ?? null,
    seller_name: (r.seller_name as string | null) ?? null,
    tracking: (r.tracking as string | null) ?? null,
    kategori: r.kategori as string,
    selling_price: r.selling_price == null ? null : Number(r.selling_price),
    umur_hari: umurHari((r.order_date as string | null) ?? null),
    courier, streamKey: key,
    source_file: (r.source_file as string | null) ?? null,
  }));
}

function mapGhost(
  rows: Record<string, unknown>[], key: string, courier: string,
): GhostRow[] {
  return rows.map((r) => ({
    awb: (r.awb as string | null) ?? null,
    cod_amount: r.cod_amount == null ? null : Number(r.cod_amount),
    bill_id: (r.bill_id as string | null) ?? null,
    settlement_date: (r.settlement_date as string | null) ?? null,
    source_file: (r.source_file as string | null) ?? null,
    courier, streamKey: key,
  }));
}

export async function uncollectedRowBundle(
  key: StreamKey, pendingDays: number = REMIT_PENDING_DAYS,
): Promise<UncollectedRowBundle> {
  const cfg = COURIERS[key];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await buildTmpM(client, key, pendingDays);
    const notColl = await client.query(`
      SELECT m.order_id, m.order_date, m.seller_name, m.tracking, m.kategori,
             m.selling_price, o.source_file
      FROM tmp_m m
      LEFT JOIN orders o ON o.order_id = m.order_id
      WHERE m.kategori = ANY($1)
      ORDER BY m.order_date`, [NOT_COLLECTED_KATS]);
    const ghost = await client.query(`
      SELECT m.awb, m.cod_amount, m.bill_id,
             COALESCE(b.settlement_date, m.delivered_date) AS settlement_date,
             b.source_file
      FROM tmp_m m
      LEFT JOIN cod_bills b ON b.bill_id = m.bill_id
      WHERE m.kategori = 'duit_hantu'
      ORDER BY settlement_date DESC NULLS LAST, m.awb`);
    await client.query("ROLLBACK");
    return {
      streamKey: key, courier: cfg.courierLabel,
      notCollected: mapNotColl(notColl.rows, key, cfg.courierLabel),
      ghost: mapGhost(ghost.rows, key, cfg.courierLabel),
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Gateway prepaid (CHIP): tiada aging, jadi tiada baris belum kutip. Cuma ghost.
export async function ghostPrepaidRowBundle(
  key: PrepaidKey,
): Promise<UncollectedRowBundle> {
  const cfg = PREPAID[key];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await buildTmpMPrepaid(client, key);
    const ghost = await client.query(`
      SELECT m.awb, m.cod_amount, m.bill_id,
             COALESCE(p.paid_on, m.delivered_date) AS settlement_date,
             p.source_file
      FROM tmp_m m
      LEFT JOIN prepaid_payments p ON p.order_ref = m.awb AND p.gateway = $1
      WHERE m.kategori = 'duit_hantu'
      ORDER BY settlement_date DESC NULLS LAST, m.awb`, [key]);
    await client.query("ROLLBACK");
    return {
      streamKey: key, courier: cfg.name,
      notCollected: [],
      ghost: mapGhost(ghost.rows, key, cfg.name),
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ====================================================================
// Pembungkus untuk page. TAK di-cache: hasil bergantung julat (per-arg) dan
// aging reconToday(), sama alasan macam uncollectedCourier.
// ====================================================================
export async function uncollectedCourierRanged(
  key: StreamKey, pendingDays: number, range: DateRange,
): Promise<RangedUncollectedStream> {
  return aggregateUncollected(await uncollectedRowBundle(key, pendingDays), range);
}

export async function ghostPrepaidRanged(
  key: PrepaidKey, range: DateRange,
): Promise<RangedUncollectedStream> {
  return aggregateUncollected(await ghostPrepaidRowBundle(key), range);
}
