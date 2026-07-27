// Lapisan TAPIS JULAT TARIKH atas output recon , READ-ONLY, additive.
//
// PERATURAN BESAR: enjin recon TIDAK diubah. Kategori setiap baris tetap datang
// dari tmp_m yang SAMA (buildTmpM / buildTmpMPrepaid dalam recon.ts, yang lulus
// harness parity lawan reconSql.py). Fail ni cuma:
//   1. tarik baris tmp_m mentah (belum diagregat),
//   2. buang baris yang tarikh ORDER dia di luar julat,
//   3. kira semula agregat KPI dari baris yang tinggal.
// Corak sama macam uncollectedCourier/ghostPrepaid: guna semula tmp_m, tiada
// laluan kategori kedua.
//
// KENAPA kira semula di TypeScript, bukan tambah WHERE dalam SQL: supaya lapisan
// tapis boleh diuji sebagai fungsi TULEN (aggregateStream) tanpa DB, dan supaya
// SQL enjin kekal tak bersentuh langsung.
//
// JAMINAN "sifar kejutan": bila tiada param julat, page LANGSUNG tak masuk sini,
// dia panggil streamSummary() lama macam biasa. Ujian scripts/testDateRange.ts
// pula membuktikan aggregateStream(bundle, ALL_TIME) === streamSummaryImpl()
// medan demi medan, jadi lapisan ni memang restriction yang setia.
import type { PoolClient } from "pg";
import { getPool } from "./db";
import {
  AGED, AUDIT_PREVIEW, COD_VALUES, COURIERS, EXC_CAP, INTEGRITY_EXC,
  PrepaidKey, REMIT_PENDING_DAYS, StreamKey, buildTmpM, buildTmpMPrepaid,
  umurHari, type DailyRow, type ExcRow, type StreamSummary,
} from "./recon";
import { isAllTime, rowInRange, type DateRange } from "./dateRange";

// Satu baris tmp_m yang sudah dikategorikan enjin (bentuk sama untuk courier &
// prepaid). Ini "hasil stream penuh" sebelum diagregat.
export interface TmpMRow {
  order_id: string | null;
  order_date: string | null;
  status: string | null;
  seller_name: string | null;
  tracking: string | null;
  selling_price: number | null;
  awb: string | null;
  bill_id: string | null;
  cod_amount: number | null;
  fee: number | null;
  delivered_date: string | null;
  kategori: string;
}

// Botol per order (untuk medan daily.botol). Dipisahkan dari baris tmp_m sebab
// satu order boleh ada banyak SKU; enjin join tmp_m x order_skus, jadi nilai per
// BARIS tmp_m = jumlah botol order itu (baris berganda memang berganda, sama
// macam enjin).
export interface OrderBottles { botol: number; botolFree: number }

// Kiraan order COD kurier LAIN, dipecah ikut hari supaya boleh ditapis di TS.
export interface OtherCourierDay {
  courier: string; day: string | null; orders: number; value: number;
}

// Semua bahan mentah satu stream. Diambil sekali, ditapis berkali kali.
export interface StreamRowBundle {
  rows: TmpMRow[];
  bills: { bill_id: string; settlement_date: string | null; source_file: string | null }[];
  bottlesByOrder: Record<string, OrderBottles>;
  otherCourierDays: OtherCourierDay[];
}

export interface RangedStreamSummary extends StreamSummary {
  range: DateRange;
  totalRows: number;      // baris tmp_m sebelum tapis
  filteredRows: number;   // baris yang lulus tapis
  undatedRows: number;    // antara yang lulus: baris TANPA tarikh order (sentiasa dipapar)
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// Perbandingan code-point (padan ORDER BY teks Postgres pada data ASCII kita),
// bukan localeCompare.
const cp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ORDER BY order_date ASC , Postgres letak NULL di HUJUNG. Array.sort V8 stabil,
// jadi seri kekal ikut susunan asal baris.
function byDateAsc(a: TmpMRow, b: TmpMRow): number {
  if (a.order_date === b.order_date) return 0;
  if (a.order_date == null) return 1;
  if (b.order_date == null) return -1;
  return cp(a.order_date, b.order_date);
}

// ORDER BY order_date DESC , Postgres letak NULL di HADAPAN.
function byDateDesc(a: TmpMRow, b: TmpMRow): number {
  if (a.order_date === b.order_date) return 0;
  if (a.order_date == null) return -1;
  if (b.order_date == null) return 1;
  return cp(b.order_date, a.order_date);
}

function toExcRow(r: TmpMRow): ExcRow {
  return {
    order_id: r.order_id, seller_name: r.seller_name, tracking: r.tracking,
    awb: r.awb, kategori: r.kategori,
    selling_price: r.selling_price == null ? null : Number(r.selling_price),
    cod_amount: r.cod_amount == null ? null : Number(r.cod_amount),
    umur_hari: umurHari(r.order_date),
  };
}

// ====================================================================
// TERAS: agregat semula dari baris tertapis. FUNGSI TULEN , tiada DB, tiada
// masa, boleh diuji dengan bundle sintetik.
// ====================================================================
export function aggregateStream(
  bundle: StreamRowBundle, range: DateRange,
): RangedStreamSummary {
  const kept = bundle.rows.filter((r) => rowInRange(r.order_date, range));

  // katN / katCod (mirror: GROUP BY kategori, COUNT(*), SUM(cod_amount)).
  const katN: Record<string, number> = {};
  const katCod: Record<string, number> = {};
  for (const r of kept) {
    katN[r.kategori] = (katN[r.kategori] ?? 0) + 1;
    katCod[r.kategori] = (katCod[r.kategori] ?? 0) + num(r.cod_amount);
  }

  // daily (mirror: baris yang ADA bill_id + delivered_date, kumpul ikut 10 aksara
  // pertama delivered_date). botol datang dari peta order (join order_skus enjin).
  const dayAcc = new Map<string, DailyRow>();
  for (const r of kept) {
    if (r.bill_id == null || r.delivered_date == null) continue;
    const day = r.delivered_date.slice(0, 10);
    let d = dayAcc.get(day);
    if (!d) {
      d = { day, parcel: 0, cod_dikutip: 0, fee: 0, tally: 0, exception: 0, botol: 0, botol_free: 0 };
      dayAcc.set(day, d);
    }
    d.parcel += 1;
    d.cod_dikutip += num(r.cod_amount);
    d.fee += num(r.fee);
    if (r.kategori === "tally") d.tally += 1;
    if (INTEGRITY_EXC.includes(r.kategori)) d.exception += 1;
    if (r.order_id != null) {
      const b = bundle.bottlesByOrder[r.order_id];
      if (b) { d.botol += b.botol; d.botol_free += b.botolFree; }
    }
  }
  const daily = [...dayAcc.values()].sort((a, b) => cp(a.day, b.day));

  // Senarai pengecualian (mirror: WHERE kategori = ANY(...) ORDER BY order_date LIMIT cap).
  const integ = kept.filter((r) => INTEGRITY_EXC.includes(r.kategori))
    .sort(byDateAsc).slice(0, EXC_CAP).map(toExcRow);
  const aged = kept.filter((r) => AGED.includes(r.kategori))
    .sort(byDateAsc).slice(0, EXC_CAP).map(toExcRow);

  // perBill (mirror: GROUP BY bill_id ORDER BY bill_id).
  const billAcc = new Map<string, { bill_id: string; parcel: number; cod: number; fee: number; tally: number; exc: number }>();
  for (const r of kept) {
    if (r.bill_id == null) continue;
    let b = billAcc.get(r.bill_id);
    if (!b) { b = { bill_id: r.bill_id, parcel: 0, cod: 0, fee: 0, tally: 0, exc: 0 }; billAcc.set(r.bill_id, b); }
    b.parcel += 1;
    b.cod += num(r.cod_amount);
    b.fee += num(r.fee);
    if (r.kategori === "tally") b.tally += 1;
    if (INTEGRITY_EXC.includes(r.kategori)) b.exc += 1;
  }
  const perBill = [...billAcc.values()].sort((a, b) => cp(a.bill_id, b.bill_id));

  // Jumlah baris BIL (COD collected / fee / bilangan parcel dalam bil). Satu baris
  // bil boleh muncul >1 kali dalam tmp_m bila beberapa order kongsi tracking yang
  // sama, jadi kita nyahduplikat ikut AWB (PK cod_bill_lines = awb; prepaid PK =
  // gateway+order_ref) supaya duit tak dikira dua kali.
  const seenLine = new Set<string>();
  let linesN = 0, linesCod = 0, linesFee = 0;
  for (const r of kept) {
    if (r.bill_id == null) continue;
    const k = r.awb ?? `\u0000bill:${r.bill_id}`;
    if (seenLine.has(k)) continue;
    seenLine.add(k);
    linesN += 1;
    linesCod += num(r.cod_amount);
    linesFee += num(r.fee);
  }

  // auditPreview (mirror: WHERE order_id IS NOT NULL ORDER BY order_date DESC LIMIT 8).
  const auditPreview = kept.filter((r) => r.order_id != null)
    .sort(byDateDesc).slice(0, AUDIT_PREVIEW).map(toExcRow);

  const scopedOrders = kept.reduce((a, r) => a + (r.order_id != null ? 1 : 0), 0);

  // stokisKat (mirror: COALESCE(seller_name, '(no order)') x kategori).
  const skAcc = new Map<string, { seller: string; kategori: string; n: number }>();
  for (const r of kept) {
    const seller = r.seller_name ?? "(no order)";
    const k = `${seller}\u0000${r.kategori}`;
    const e = skAcc.get(k);
    if (e) e.n += 1;
    else skAcc.set(k, { seller, kategori: r.kategori, n: 1 });
  }

  // Order COD kurier lain (luar skop Fasa 1), ditapis ikut hari order yang sama.
  const ocAcc = new Map<string, { courier: string; orders: number; value: number }>();
  for (const o of bundle.otherCourierDays) {
    if (!rowInRange(o.day, range)) continue;
    const e = ocAcc.get(o.courier);
    if (e) { e.orders += o.orders; e.value += o.value; }
    else ocAcc.set(o.courier, { courier: o.courier, orders: o.orders, value: o.value });
  }

  // Senarai bil: bila julat aktif, tunjuk HANYA bil yang masih ada parcel dalam
  // julat (kalau tidak, jadual bil papar baris kosong yang mengelirukan). Bila
  // All time, senarai kekal 100% macam enjin (termasuk bil yang tiada baris).
  const bills = isAllTime(range)
    ? bundle.bills
    : bundle.bills.filter((b) => billAcc.has(b.bill_id));

  const integN = INTEGRITY_EXC.reduce((a, k) => a + (katN[k] ?? 0), 0);
  const agedN = AGED.reduce((a, k) => a + (katN[k] ?? 0), 0);

  return {
    katN, katCod, daily,
    integ, integN,
    integRisk: INTEGRITY_EXC.reduce((a, k) => a + (katCod[k] ?? 0), 0),
    aged, agedN,
    perBill, bills,
    linesN, linesCod, linesFee,
    tallyN: katN["tally"] ?? 0, tallyCod: katCod["tally"] ?? 0,
    auditPreview, scopedOrders,
    stokisKat: [...skAcc.values()],
    otherCouriers: [...ocAcc.values()].sort((a, b) => cp(a.courier, b.courier)),
    range,
    totalRows: bundle.rows.length,
    filteredRows: kept.length,
    undatedRows: kept.reduce((a, r) => a + (rowHasDate(r) ? 0 : 1), 0),
  };
}

// Baris "tiada tarikh order" = baris bil tanpa order padan (duit hantu /
// match_luar_skop) atau order yang tarikhnya kosong dalam feed.
function rowHasDate(r: TmpMRow): boolean {
  const v = r.order_date;
  return !!v && /^\d{4}-\d{2}-\d{2}/.test(v.trim());
}

// ====================================================================
// Pengambilan bahan mentah. SQL di sini cuma SELECT (tiada CASE kategori, tiada
// logik recon) , kategori datang siap dari tmp_m enjin.
// ====================================================================
const ROWS_SQL = `
  SELECT order_id, order_date, status, seller_name, tracking, selling_price,
         awb, bill_id, cod_amount, fee, delivered_date, kategori
  FROM tmp_m`;

const BOTTLES_SQL = `
  SELECT os.order_id,
         SUM(os.qty * (COALESCE(sb.paid, 0) + COALESCE(sb.free, 0))) AS botol,
         SUM(os.qty * COALESCE(sb.free, 0)) AS botol_free
  FROM order_skus os
  LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
  WHERE os.order_id IN (SELECT order_id FROM tmp_m WHERE order_id IS NOT NULL)
  GROUP BY os.order_id`;

function mapRows(rows: Record<string, unknown>[]): TmpMRow[] {
  return rows.map((r) => ({
    order_id: (r.order_id as string | null) ?? null,
    order_date: (r.order_date as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    seller_name: (r.seller_name as string | null) ?? null,
    tracking: (r.tracking as string | null) ?? null,
    selling_price: r.selling_price == null ? null : Number(r.selling_price),
    awb: (r.awb as string | null) ?? null,
    bill_id: (r.bill_id as string | null) ?? null,
    cod_amount: r.cod_amount == null ? null : Number(r.cod_amount),
    fee: r.fee == null ? null : Number(r.fee),
    delivered_date: (r.delivered_date as string | null) ?? null,
    kategori: r.kategori as string,
  }));
}

async function readBottles(c: PoolClient): Promise<Record<string, OrderBottles>> {
  const res = await c.query(BOTTLES_SQL);
  const out: Record<string, OrderBottles> = {};
  for (const r of res.rows) {
    out[r.order_id as string] = { botol: num(r.botol), botolFree: num(r.botol_free) };
  }
  return out;
}

export async function streamRowBundle(
  key: StreamKey, pendingDays: number = REMIT_PENDING_DAYS,
): Promise<StreamRowBundle> {
  const cfg = COURIERS[key];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await buildTmpM(client, key, pendingDays);
    const rows = await client.query(ROWS_SQL);
    const bottles = await readBottles(client);
    // Senarai bil = metadata (bukan kiraan); susunan sama macam streamSummaryImpl.
    const bills = await client.query(`
      SELECT bill_id, settlement_date, source_file FROM cod_bills
      WHERE courier = $1
      ORDER BY settlement_date IS NULL, settlement_date, bill_id`, [cfg.courierLabel]);
    // Kurier lain dipecah ikut hari order supaya tapisan berlaku di TS.
    const other = await client.query(`
      SELECT shipping_provider, LEFT(order_date, 10) AS day,
             COUNT(*) AS n, SUM(selling_price) AS nilai
      FROM orders
      WHERE payment_method = ANY($1) AND shipping_provider <> ALL($2)
      GROUP BY 1, 2`, [COD_VALUES, cfg.provider]);
    await client.query("ROLLBACK");
    return {
      rows: mapRows(rows.rows),
      bills: bills.rows,
      bottlesByOrder: bottles,
      otherCourierDays: other.rows.map((r) => ({
        courier: r.shipping_provider as string,
        day: (r.day as string | null) ?? null,
        orders: Number(r.n), value: num(r.nilai),
      })),
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function prepaidRowBundle(key: PrepaidKey): Promise<StreamRowBundle> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await buildTmpMPrepaid(client, key);
    const rows = await client.query(ROWS_SQL);
    const bottles = await readBottles(client);
    const bills = await client.query(`
      SELECT statement_id AS bill_id, MIN(paid_on) AS settlement_date,
             MIN(source_file) AS source_file
      FROM prepaid_payments
      WHERE gateway = $1 AND statement_id IS NOT NULL
      GROUP BY statement_id
      ORDER BY MIN(paid_on) IS NULL, MIN(paid_on), statement_id`, [key]);
    await client.query("ROLLBACK");
    return {
      rows: mapRows(rows.rows),
      bills: bills.rows,
      bottlesByOrder: bottles,
      otherCourierDays: [],   // gateway prepaid tiada konsep kurier lain
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
export async function streamSummaryRanged(
  key: StreamKey, pendingDays: number, range: DateRange,
): Promise<RangedStreamSummary> {
  return aggregateStream(await streamRowBundle(key, pendingDays), range);
}

export async function streamPrepaidSummaryRanged(
  key: PrepaidKey, range: DateRange,
): Promise<RangedStreamSummary> {
  return aggregateStream(await prepaidRowBundle(key), range);
}
