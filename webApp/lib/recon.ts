// Recon dikira DALAM database , port setia dari reconSql.py (Postgres sahaja).
//
// PERATURAN (dari HANDOVER): logik kategori = salinan SETIA reconcile.py
// (rujukan kebenaran). Kalau logik recon berubah: ubah reconcile.py dulu,
// lulus parity, sync reconSql.py, BARU sync fail ini. parityCheck
// (webApp/scripts) banding output fail ini dengan reconSql.py.
//
// Corak: tmp table dalam SATU transaksi atas SATU client, rollback di akhir.
// Selamat dengan Neon pooler (pgbouncer transaction mode).
import { PoolClient } from "pg";
import { unstable_cache } from "next/cache";
import { getPool } from "./db";
import { ensureGiftTable } from "./giftsSchema";

export const REMIT_PENDING_DAYS = 14;
// Tarikh rujukan aging (baseline enjin Python; nanti jadi "hari ini" bila
// keputusan baseline dibuka semula bersama Adi).
export const TODAY = new Date("2026-06-18T00:00:00");

const COD_VALUES = ["COD"];
const EXC_CAP = 5000;
const AUDIT_PREVIEW = 8;

export const INTEGRITY_EXC = [
  "duit_hantu", "amount_mismatch", "duit_masuk_order_returned",
  "duit_masuk_order_rejected", "in_bil_tapi_intransit", "takde_awb_jnt",
  "takde_tracking", "match_luar_skop",
];
export const AGED = ["hilang_lewat"];

export const KAT_LABEL: Record<string, string> = {
  tally: "Tally",
  amount_mismatch: "Amount mismatch",
  duit_hantu: "Ghost money",
  duit_masuk_order_returned: "Paid, order returned",
  duit_masuk_order_rejected: "Paid, order rejected",
  in_bil_tapi_intransit: "In bill, in-transit",
  takde_awb_jnt: "No J&T AWB",
  takde_tracking: "No tracking",
  match_luar_skop: "Out-of-scope match",
  hilang_lewat: "Overdue / missing",
  belum_remit: "Awaiting remit",
  belum_bayar: "Awaiting payment",
  returned: "Returned",
  rejected: "Rejected",
  pending: "Pending",
};

export type StreamKey = "jnt" | "dhl" | "ninja";

export const COURIERS: Record<StreamKey, {
  name: string; provider: string[]; courierLabel: string;
  awbValid: "digits" | "present"; noAwbCat: string;
}> = {
  jnt: { name: "J&T COD", provider: ["J&T Express"], courierLabel: "J&T Express",
         awbValid: "digits", noAwbCat: "takde_awb_jnt" },
  dhl: { name: "DHL", provider: ["DHL eCommerce"], courierLabel: "DHL eCommerce",
         awbValid: "present", noAwbCat: "takde_tracking" },
  ninja: { name: "Ninja Van", provider: ["Ninja Van"], courierLabel: "Ninja Van",
           awbValid: "present", noAwbCat: "takde_tracking" },
};

export interface ExcRow {
  order_id: string | null; seller_name: string | null; tracking: string | null;
  awb: string | null; kategori: string; selling_price: number | null;
  cod_amount: number | null; umur_hari: number | null;
}

export interface DailyRow {
  day: string; parcel: number; cod_dikutip: number; fee: number;
  tally: number; exception: number; botol: number; botol_free: number;
}

export interface StreamSummary {
  katN: Record<string, number>;
  katCod: Record<string, number>;
  daily: DailyRow[];
  integ: ExcRow[]; integN: number; integRisk: number;
  aged: ExcRow[]; agedN: number;
  perBill: { bill_id: string; parcel: number; cod: number; fee: number; tally: number; exc: number }[];
  bills: { bill_id: string; settlement_date: string | null; source_file: string | null }[];
  linesN: number; linesCod: number; linesFee: number;
  tallyN: number; tallyCod: number;
  auditPreview: ExcRow[];
  scopedOrders: number;
  stokisKat: { seller: string; kategori: string; n: number }[];
  otherCouriers: { courier: string; orders: number; value: number }[];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function cutoff(pendingDays: number): string {
  const d = new Date(TODAY.getTime() - (pendingDays + 1) * 86400_000);
  return iso(d);
}

function umurHari(orderDate: string | null): number | null {
  if (!orderDate) return null;
  const d = new Date(orderDate.replace(" ", "T"));
  if (isNaN(d.getTime())) return null;
  return Math.floor((TODAY.getTime() - d.getTime()) / 86400_000);
}

const R2 = (x: string) => `ROUND(CAST(${x} AS numeric), 2)`;

// Salinan setia _m_sql_courier (cabang postgresql) dari reconSql.py.
function mSqlCourier(key: StreamKey): string {
  const cfg = COURIERS[key];
  const awbOk = cfg.awbValid === "digits"
    ? `s.tracking ~ '^[0-9]{10,}$'`
    : `(TRIM(COALESCE(s.tracking, '')) <> '' AND UPPER(TRIM(s.tracking)) <> 'NAN')`;
  return `
    SELECT s.order_id, s.order_date, s.status, s.seller_name, s.tracking,
           s.selling_price,
           l.awb, l.bill_id, l.cod_amount, l.fee, l.delivered_date,
           l.cod_amount - l.fee AS remit,
           CASE
             WHEN l.awb IS NOT NULL THEN
               CASE
                 WHEN s.status = 'Completed' THEN
                   CASE WHEN ${R2("s.selling_price")} = ${R2("l.cod_amount")}
                        THEN 'tally' ELSE 'amount_mismatch' END
                 WHEN s.status = 'Returned' THEN 'duit_masuk_order_returned'
                 WHEN s.status = 'Rejected' THEN 'duit_masuk_order_rejected'
                 ELSE 'in_bil_tapi_intransit'
               END
             ELSE
               CASE
                 WHEN s.status = 'Completed' THEN
                   CASE
                     WHEN s.tracking IS NULL THEN $1
                     WHEN NOT ${awbOk} THEN $1
                     WHEN s.order_date <= $2 THEN 'hilang_lewat'
                     ELSE 'belum_remit'
                   END
                 WHEN s.status = 'Returned' THEN 'returned'
                 WHEN s.status = 'Rejected' THEN 'rejected'
                 ELSE 'pending'
               END
           END AS kategori
    FROM orders s
    LEFT JOIN tmp_lines l ON l.awb = s.tracking
    WHERE s.payment_method = ANY($3) AND s.shipping_provider = ANY($4)

    UNION ALL

    SELECT NULL, NULL, NULL, NULL, NULL, NULL,
           l.awb, l.bill_id, l.cod_amount, l.fee, l.delivered_date,
           l.cod_amount - l.fee,
           CASE WHEN EXISTS (SELECT 1 FROM orders ao WHERE ao.tracking = l.awb)
                THEN 'match_luar_skop' ELSE 'duit_hantu' END
    FROM tmp_lines l
    WHERE NOT EXISTS (SELECT 1 FROM orders s WHERE s.tracking = l.awb
                      AND s.payment_method = ANY($3)
                      AND s.shipping_provider = ANY($4))
  `;
}

async function buildTmpM(c: PoolClient, key: StreamKey, pendingDays: number) {
  const cfg = COURIERS[key];
  await c.query(`
    CREATE TEMPORARY TABLE tmp_lines ON COMMIT DROP AS
    SELECT li.awb, li.bill_id, li.cod_amount, li.fee, li.delivered_date
    FROM cod_bill_lines li
    JOIN cod_bills b ON b.bill_id = li.bill_id
    WHERE b.courier = $1`, [cfg.courierLabel]);
  await c.query(`CREATE INDEX idx_tmp_lines_awb ON tmp_lines(awb)`);
  await c.query(`
    CREATE TEMPORARY TABLE tmp_m (
      order_id TEXT, order_date TEXT, status TEXT, seller_name TEXT,
      tracking TEXT, selling_price DOUBLE PRECISION,
      awb TEXT, bill_id TEXT, cod_amount DOUBLE PRECISION,
      fee DOUBLE PRECISION, delivered_date TEXT,
      remit DOUBLE PRECISION, kategori TEXT
    ) ON COMMIT DROP`);
  await c.query(
    `INSERT INTO tmp_m ${mSqlCourier(key)}`,
    [cfg.noAwbCat, cutoff(pendingDays), COD_VALUES, cfg.provider],
  );
  await c.query(`CREATE INDEX idx_tmp_m_oid ON tmp_m(order_id)`);
  await c.query(`CREATE INDEX idx_tmp_m_bill ON tmp_m(bill_id)`);
  await c.query(`CREATE INDEX idx_tmp_m_kat ON tmp_m(kategori)`);
}

function toNum(v: unknown): number {
  return v == null ? 0 : Number(v);
}

function excRows(rows: Record<string, unknown>[]): ExcRow[] {
  return rows.map((r) => ({
    order_id: r.order_id as string | null,
    seller_name: r.seller_name as string | null,
    tracking: r.tracking as string | null,
    awb: r.awb as string | null,
    kategori: r.kategori as string,
    selling_price: r.selling_price == null ? null : Number(r.selling_price),
    cod_amount: r.cod_amount == null ? null : Number(r.cod_amount),
    umur_hari: umurHari(r.order_date as string | null),
  }));
}

// Port setia bill_parcels dari reconSql.py: baris parcel SATU bil (dikategorikan).
// Guna tmp_m yang sama (kategori sudah lulus parity), cuma ditapis ke satu bil.
export interface BillParcel {
  awb: string | null; order_id: string | null; seller_name: string | null;
  kategori: string; katLabel: string; katTone: "pos" | "cau" | "dan" | "mut";
  selling_price: number | null; cod_amount: number | null;
  fee: number | null; remit: number | null;
}

const BILL_CAP = 20_000;

// Nada + label kategori dikira di server (KAT_LABEL/INTEGRITY_EXC/AGED ada di
// recon.ts) supaya komponen client tak perlu import recon.ts (yang tarik `pg`).
function katToneOf(kat: string): "pos" | "cau" | "dan" | "mut" {
  if (kat === "tally") return "pos";
  if (INTEGRITY_EXC.includes(kat)) return "dan";
  if (AGED.includes(kat)) return "cau";
  return "mut";
}

export async function billParcels(
  key: StreamKey, billId: string, pendingDays: number = REMIT_PENDING_DAYS,
): Promise<BillParcel[]> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await buildTmpM(client, key, pendingDays);
    const res = await client.query(
      `SELECT awb, order_id, seller_name, kategori, selling_price, cod_amount,
              fee, remit
       FROM tmp_m WHERE bill_id = $1 ORDER BY awb LIMIT $2`, [billId, BILL_CAP]);
    await client.query("ROLLBACK");
    return res.rows.map((r) => ({
      awb: r.awb, order_id: r.order_id, seller_name: r.seller_name,
      kategori: r.kategori, katLabel: KAT_LABEL[r.kategori] ?? r.kategori,
      katTone: katToneOf(r.kategori),
      selling_price: r.selling_price == null ? null : toNum(r.selling_price),
      cod_amount: r.cod_amount == null ? null : toNum(r.cod_amount),
      fee: r.fee == null ? null : toNum(r.fee),
      remit: r.remit == null ? null : toNum(r.remit),
    }));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function streamSummaryImpl(
  key: StreamKey, pendingDays: number = REMIT_PENDING_DAYS,
): Promise<StreamSummary> {
  const cfg = COURIERS[key];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await buildTmpM(client, key, pendingDays);

    const kat = await client.query(`
      SELECT kategori, COUNT(*) AS n, SUM(cod_amount) AS cod_sum
      FROM tmp_m GROUP BY kategori`);
    const katN: Record<string, number> = {};
    const katCod: Record<string, number> = {};
    for (const r of kat.rows) {
      katN[r.kategori] = Number(r.n);
      katCod[r.kategori] = toNum(r.cod_sum);
    }

    const daily = await client.query(`
      SELECT SUBSTR(m.delivered_date, 1, 10) AS day,
             COUNT(*) AS parcel,
             SUM(m.cod_amount) AS cod_dikutip,
             SUM(m.fee) AS fee,
             SUM(CASE WHEN m.kategori = 'tally' THEN 1 ELSE 0 END) AS tally,
             SUM(CASE WHEN m.kategori = ANY($1) THEN 1 ELSE 0 END) AS exception
      FROM tmp_m m
      WHERE m.bill_id IS NOT NULL AND m.delivered_date IS NOT NULL
      GROUP BY 1 ORDER BY 1`, [INTEGRITY_EXC]);
    const dailyB = await client.query(`
      SELECT SUBSTR(m.delivered_date, 1, 10) AS day,
             SUM(os.qty * (COALESCE(sb.paid, 0) + COALESCE(sb.free, 0))) AS botol,
             SUM(os.qty * COALESCE(sb.free, 0)) AS botol_free
      FROM tmp_m m
      JOIN order_skus os ON os.order_id = m.order_id
      LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
      WHERE m.bill_id IS NOT NULL AND m.delivered_date IS NOT NULL
      GROUP BY 1`);
    const botolByDay = new Map<string, { b: number; f: number }>(
      dailyB.rows.map((r) => [r.day as string, { b: toNum(r.botol), f: toNum(r.botol_free) }]),
    );
    const dailyRows: DailyRow[] = daily.rows.map((r) => ({
      day: r.day as string,
      parcel: Number(r.parcel),
      cod_dikutip: toNum(r.cod_dikutip),
      fee: toNum(r.fee),
      tally: Number(r.tally),
      exception: Number(r.exception),
      botol: botolByDay.get(r.day as string)?.b ?? 0,
      botol_free: botolByDay.get(r.day as string)?.f ?? 0,
    }));

    const integ = await client.query(`
      SELECT order_id, seller_name, tracking, awb, kategori, selling_price,
             cod_amount, order_date
      FROM tmp_m WHERE kategori = ANY($1)
      ORDER BY order_date LIMIT $2`, [INTEGRITY_EXC, EXC_CAP]);
    const aged = await client.query(`
      SELECT order_id, seller_name, tracking, awb, kategori, selling_price,
             cod_amount, order_date
      FROM tmp_m WHERE kategori = ANY($1)
      ORDER BY order_date LIMIT $2`, [AGED, EXC_CAP]);

    const perBill = await client.query(`
      SELECT bill_id, COUNT(*) AS parcel, SUM(cod_amount) AS cod, SUM(fee) AS fee,
             SUM(CASE WHEN kategori = 'tally' THEN 1 ELSE 0 END) AS tally,
             SUM(CASE WHEN kategori = ANY($1) THEN 1 ELSE 0 END) AS exc
      FROM tmp_m WHERE bill_id IS NOT NULL
      GROUP BY bill_id ORDER BY bill_id`, [INTEGRITY_EXC]);

    const audit = await client.query(`
      SELECT order_id, seller_name, tracking, awb, kategori, selling_price,
             cod_amount, order_date
      FROM tmp_m WHERE order_id IS NOT NULL
      ORDER BY order_date DESC LIMIT $1`, [AUDIT_PREVIEW]);

    const scoped = await client.query(`
      SELECT COUNT(*) AS n FROM tmp_m WHERE order_id IS NOT NULL`);

    // Cross-tab stokis x kategori (port setia stokis_kat dari reconSql.py). Guna
    // tmp_m, jadi WAJIB dibaca sebelum ROLLBACK.
    const stokisKat = await client.query(`
      SELECT COALESCE(seller_name, '(no order)') AS seller, kategori, COUNT(*) AS n
      FROM tmp_m GROUP BY 1, 2`);

    await client.query("ROLLBACK");

    // Bahagian luar tmp_m (baca terus, tiada transaksi perlu).
    const linesTotal = await client.query(`
      SELECT COUNT(*) AS n, SUM(l.cod_amount) AS cod, SUM(l.fee) AS fee
      FROM cod_bill_lines l JOIN cod_bills b ON b.bill_id = l.bill_id
      WHERE b.courier = $1`, [cfg.courierLabel]);
    const bills = await client.query(`
      SELECT bill_id, settlement_date, source_file FROM cod_bills
      WHERE courier = $1
      ORDER BY settlement_date IS NULL, settlement_date, bill_id`, [cfg.courierLabel]);

    // Order COD yang naik courier LAIN dari stream ni (luar skop Fasa 1). Port
    // setia other_courier dari reconSql.py. shipping_provider NULL disingkir oleh
    // <> ALL (NULL), sama macam NOT IN Python.
    const other = await client.query(`
      SELECT shipping_provider, COUNT(*) AS n, SUM(selling_price) AS nilai
      FROM orders
      WHERE payment_method = ANY($1) AND shipping_provider <> ALL($2)
      GROUP BY shipping_provider`, [COD_VALUES, cfg.provider]);

    const integN = INTEGRITY_EXC.reduce((a, k) => a + (katN[k] ?? 0), 0);
    const agedN = AGED.reduce((a, k) => a + (katN[k] ?? 0), 0);
    const lt = linesTotal.rows[0];

    return {
      katN, katCod,
      daily: dailyRows,
      integ: excRows(integ.rows), integN,
      integRisk: INTEGRITY_EXC.reduce((a, k) => a + (katCod[k] ?? 0), 0),
      aged: excRows(aged.rows), agedN,
      perBill: perBill.rows.map((r) => ({
        bill_id: r.bill_id, parcel: Number(r.parcel), cod: toNum(r.cod),
        fee: toNum(r.fee), tally: Number(r.tally), exc: Number(r.exc),
      })),
      bills: bills.rows,
      linesN: Number(lt.n ?? 0), linesCod: toNum(lt.cod), linesFee: toNum(lt.fee),
      tallyN: katN["tally"] ?? 0, tallyCod: katCod["tally"] ?? 0,
      auditPreview: excRows(audit.rows),
      scopedOrders: Number(scoped.rows[0].n),
      stokisKat: stokisKat.rows.map((r) => ({
        seller: r.seller as string, kategori: r.kategori as string, n: Number(r.n),
      })),
      otherCouriers: other.rows.map((r) => ({
        courier: r.shipping_provider as string, orders: Number(r.n), value: toNum(r.nilai),
      })),
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function storeCountsImpl(): Promise<{ orders: number; billLines: number; wallet: number }> {
  const p = getPool();
  const [o, l, w] = await Promise.all([
    p.query("SELECT COUNT(*) AS n FROM orders"),
    p.query("SELECT COUNT(*) AS n FROM cod_bill_lines"),
    p.query("SELECT COUNT(*) AS n FROM wallet_txns"),
  ]);
  return {
    orders: Number(o.rows[0].n),
    billLines: Number(l.rows[0].n),
    wallet: Number(w.rows[0].n),
  };
}

// ingested_at disimpan "YYYY-MM-DD HH:MM:SS" (perbandingan string = kronologi),
// jadi MAX merentas feed = masa upload terkini. Untuk penunjuk kesegaran data.
export async function lastIngestImpl(): Promise<string | null> {
  const res = await getPool().query(`
    SELECT MAX(m) AS m FROM (
      SELECT MAX(ingested_at) m FROM orders
      UNION ALL SELECT MAX(ingested_at) FROM cod_bills
      UNION ALL SELECT MAX(ingested_at) FROM cod_bill_lines
      UNION ALL SELECT MAX(ingested_at) FROM wallet_txns
      UNION ALL SELECT MAX(ingested_at) FROM prepaid_payments
    ) t`);
  return res.rows[0]?.m ?? null;
}

// Cari order ikut order_id atau tracking, tunjuk status settlement (bil COD /
// prepaid). Bukan mengira kategori recon (elak duplikat logik) , ia jawab soalan
// penyiasat: "order ni wujud? dah settle? bil mana? jumlah berapa?".
export interface SearchResult {
  order_id: string | null; order_date: string | null; seller_name: string | null;
  tracking: string | null; shipping_provider: string | null; status: string | null;
  payment_method: string | null; selling_price: number | null;
  bill_id: string | null; cod_amount: number | null; fee: number | null;
  delivered_date: string | null; courier: string | null; settlement_date: string | null;
  prepaid_gateway: string | null; prepaid_amount: number | null; prepaid_status: string | null;
}

export async function searchOrders(q: string): Promise<SearchResult[]> {
  const term = (q ?? "").trim();
  if (term.length < 2) return [];
  // Escape wildcard LIKE supaya %/_ dalam query dilayan literal.
  const like = "%" + term.replace(/[%_\\]/g, "\\$&") + "%";
  const res = await getPool().query(
    `SELECT o.order_id, o.order_date, o.seller_name, o.tracking, o.shipping_provider,
            o.status, o.payment_method, o.selling_price,
            l.bill_id, l.cod_amount, l.fee, l.delivered_date,
            b.courier, b.settlement_date,
            p.gateway AS prepaid_gateway, p.amount AS prepaid_amount, p.status AS prepaid_status
     FROM orders o
     LEFT JOIN cod_bill_lines l ON l.awb = o.tracking
     LEFT JOIN cod_bills b ON b.bill_id = l.bill_id
     LEFT JOIN prepaid_payments p ON p.order_ref = o.order_id
     WHERE o.order_id ILIKE $1 ESCAPE '\\' OR o.tracking ILIKE $1 ESCAPE '\\'
     ORDER BY o.ingested_at DESC
     LIMIT 50`, [like]);
  return res.rows.map((r) => ({
    order_id: r.order_id, order_date: r.order_date, seller_name: r.seller_name,
    tracking: r.tracking, shipping_provider: r.shipping_provider, status: r.status,
    payment_method: r.payment_method,
    selling_price: r.selling_price == null ? null : toNum(r.selling_price),
    bill_id: r.bill_id,
    cod_amount: r.cod_amount == null ? null : toNum(r.cod_amount),
    fee: r.fee == null ? null : toNum(r.fee),
    delivered_date: r.delivered_date, courier: r.courier, settlement_date: r.settlement_date,
    prepaid_gateway: r.prepaid_gateway,
    prepaid_amount: r.prepaid_amount == null ? null : toNum(r.prepaid_amount),
    prepaid_status: r.prepaid_status,
  }));
}

// ====================================================================
// Botol per stokis (semua courier + payment; confirmed via feed duit).
// Salinan setia stockist_bottles / stockist_orders dari reconSql.py.
// ====================================================================
const CONF_SQL = `
  CASE WHEN EXISTS (SELECT 1 FROM cod_bill_lines cl WHERE cl.awb = o.tracking)
         OR EXISTS (SELECT 1 FROM prepaid_payments pp WHERE pp.order_ref = o.order_id)
       THEN 1 ELSE 0 END
`;

const DRILL_CAP = 10_000;

export interface StockistRow {
  stockist: string; confirmed_orders: number; paid_bottles: number;
  free_bottles: number; total_bottles: number; unconfirmed_bottles: number;
}

export async function stockistBottlesImpl(): Promise<StockistRow[]> {
  const res = await getPool().query(`
    SELECT stockist,
           COUNT(DISTINCT CASE WHEN conf = 1 THEN order_id END) AS confirmed_orders,
           SUM(CASE WHEN conf = 1 THEN bp ELSE 0 END) AS paid_bottles,
           SUM(CASE WHEN conf = 1 THEN bf ELSE 0 END) AS free_bottles,
           SUM(CASE WHEN conf = 1 THEN bp + bf ELSE 0 END) AS total_bottles,
           SUM(CASE WHEN conf = 0 THEN bp + bf ELSE 0 END) AS unconfirmed_bottles
    FROM (SELECT o.order_id,
                 COALESCE(o.seller_name, '(no stockist)') AS stockist,
                 COALESCE(os.qty * COALESCE(sb.paid, 0), 0) AS bp,
                 COALESCE(os.qty * COALESCE(sb.free, 0), 0) AS bf,
                 ${CONF_SQL} AS conf
          FROM orders o
          LEFT JOIN order_skus os ON os.order_id = o.order_id
          LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
          WHERE o.status = 'Completed') x
    GROUP BY stockist
    ORDER BY total_bottles DESC, stockist`);
  return res.rows.map((r) => ({
    stockist: r.stockist,
    confirmed_orders: toNum(r.confirmed_orders),
    paid_bottles: toNum(r.paid_bottles),
    free_bottles: toNum(r.free_bottles),
    total_bottles: toNum(r.total_bottles),
    unconfirmed_bottles: toNum(r.unconfirmed_bottles),
  }));
}

export interface StockistOrder {
  order_id: string; order_date: string | null; status: string | null;
  payment_method: string | null; shipping_provider: string | null;
  tracking: string | null; botol_paid: number; botol_free: number;
  botol_total: number; duit: "confirmed" | "unconfirmed";
  expected: number | null; net_remit: number | null;
}

// Enrich: tambah RM (expected = selling_price, net_remit = cod_amount - fee dari
// bil courier) + penapis tarikh OPTIONAL (order_date, prefix 10 char supaya immune
// pada bahagian masa). from/to null = semua masa (backward-compat dgn pemanggil lama).
export async function stockistOrders(
  seller: string, cap: number = DRILL_CAP,
  from?: string, to?: string,
): Promise<{ rows: StockistOrder[]; total: number }> {
  const p = getPool();
  const scoped = Boolean(from && to);
  const listDate = scoped ? "AND LEFT(order_date, 10) BETWEEN $3 AND $4" : "";
  const listParams = scoped ? [seller, cap, from, to] : [seller, cap];
  const res = await p.query(`
    SELECT o.order_id, o.order_date, o.status, o.payment_method,
           o.shipping_provider, o.tracking, o.selling_price,
           (SELECT cl.cod_amount - COALESCE(cl.fee, 0) FROM cod_bill_lines cl
            WHERE cl.awb = o.tracking LIMIT 1) AS net_remit,
           COALESCE((SELECT SUM(os.qty * COALESCE(sb.paid, 0))
                     FROM order_skus os
                     LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
                     WHERE os.order_id = o.order_id), 0) AS botol_paid,
           COALESCE((SELECT SUM(os.qty * COALESCE(sb.free, 0))
                     FROM order_skus os
                     LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
                     WHERE os.order_id = o.order_id), 0) AS botol_free,
           CASE WHEN ${CONF_SQL.trim()} = 1 THEN 'confirmed'
                ELSE 'unconfirmed' END AS duit
    FROM (SELECT * FROM orders
          WHERE COALESCE(seller_name, '(no stockist)') = $1 ${listDate}
          ORDER BY order_date DESC LIMIT $2) o
    ORDER BY o.order_date DESC`, listParams);
  const totDate = scoped ? "AND LEFT(order_date, 10) BETWEEN $2 AND $3" : "";
  const totParams = scoped ? [seller, from, to] : [seller];
  const tot = await p.query(
    `SELECT COUNT(*) AS n FROM orders
     WHERE COALESCE(seller_name, '(no stockist)') = $1 ${totDate}`, totParams);
  return {
    rows: res.rows.map((r) => ({
      order_id: r.order_id, order_date: r.order_date, status: r.status,
      payment_method: r.payment_method, shipping_provider: r.shipping_provider,
      tracking: r.tracking,
      botol_paid: toNum(r.botol_paid), botol_free: toNum(r.botol_free),
      botol_total: toNum(r.botol_paid) + toNum(r.botol_free),
      duit: r.duit,
      expected: r.selling_price == null ? null : toNum(r.selling_price),
      net_remit: r.net_remit == null ? null : toNum(r.net_remit),
    })),
    total: Number(tot.rows[0].n),
  };
}

export interface SkuRow {
  sku: string; product_name: string | null; paid: number; free: number;
}

export async function skuMapImpl(): Promise<SkuRow[]> {
  const res = await getPool().query(
    `SELECT sku, product_name, paid, free FROM sku_bottles ORDER BY sku`);
  return res.rows.map((r) => ({
    sku: r.sku, product_name: r.product_name,
    paid: toNum(r.paid), free: toNum(r.free),
  }));
}

// SKU dalam order tapi tiada dalam sku_bottles = dikira 0 botol. Amaran finance
// (port ringan unmapped_skus dari reconSql.py, versi global merentas semua feed).
export async function unmappedSkusImpl(): Promise<string[]> {
  const res = await getPool().query(`
    SELECT DISTINCT os.sku_raw FROM order_skus os
    WHERE os.sku NOT IN (SELECT UPPER(TRIM(sku)) FROM sku_bottles WHERE sku IS NOT NULL)
      AND os.sku_raw IS NOT NULL
    ORDER BY os.sku_raw`);
  return res.rows.map((r) => r.sku_raw as string);
}

export interface CommissionRow {
  seller_name: string; level: string; earned: number; paid: number; balance: number;
}

// Salinan setia commission_summary dari reconSql.py.
export async function commissionSummaryImpl(): Promise<CommissionRow[]> {
  const res = await getPool().query(`
    SELECT seller_name, MIN(seller_role) AS level,
           SUM(CASE WHEN status = 'Approved' AND txn_type = 'IN'
                    THEN amount ELSE 0 END) AS earned,
           SUM(CASE WHEN status = 'Approved' AND txn_type = 'OUT'
                         AND source = 'Withdraw'
                    THEN amount ELSE 0 END) AS paid
    FROM wallet_txns
    WHERE seller_name IS NOT NULL
    GROUP BY seller_name
    HAVING SUM(CASE WHEN status = 'Approved'
                         AND (txn_type = 'IN'
                              OR (txn_type = 'OUT' AND source = 'Withdraw'))
                    THEN 1 ELSE 0 END) > 0
    ORDER BY 3 DESC`);
  return res.rows.map((r) => {
    const earned = toNum(r.earned);
    const paid = toNum(r.paid);
    return {
      seller_name: r.seller_name,
      level: r.level ?? "",
      earned, paid,
      balance: Math.round((earned - paid) * 100) / 100,
    };
  });
}

// Port setia commission_breakdown dari reconSql.py: pecahan ikut sumber +
// transaksi penuh untuk satu stokis (drill).
export interface CommissionBySource { source: string; txn_type: string; count: number; total: number; }
export interface CommissionTxn {
  txn_date: string | null; order_id: string | null; source: string | null;
  txn_type: string | null; status: string | null; amount: number;
}
export interface CommissionDetail {
  bySrc: CommissionBySource[]; detail: CommissionTxn[]; total: number;
}

export async function commissionBreakdown(seller: string): Promise<CommissionDetail> {
  const p = getPool();
  const [bySrc, det, tot] = await Promise.all([
    p.query(`
      SELECT source, txn_type, COUNT(*) AS count, SUM(amount) AS total
      FROM wallet_txns
      WHERE seller_name = $1 AND status = 'Approved'
      GROUP BY source, txn_type ORDER BY source, txn_type`, [seller]),
    p.query(`
      SELECT txn_date, order_id, source, txn_type, status, amount
      FROM wallet_txns WHERE seller_name = $1
      ORDER BY txn_date LIMIT $2`, [seller, DRILL_CAP]),
    p.query(`SELECT COUNT(*) AS n FROM wallet_txns WHERE seller_name = $1`, [seller]),
  ]);
  return {
    bySrc: bySrc.rows.map((r) => ({
      source: r.source ?? "—", txn_type: r.txn_type ?? "—",
      count: Number(r.count), total: Math.round(toNum(r.total) * 100) / 100,
    })),
    detail: det.rows.map((r) => ({
      txn_date: r.txn_date, order_id: r.order_id, source: r.source,
      txn_type: r.txn_type, status: r.status, amount: toNum(r.amount),
    })),
    total: Number(tot.rows[0].n),
  };
}

// ====================================================================
// Free gift (giveaway) , terikat SKU (sku_gifts). Kos derive = order_skus.qty x
// sku_gifts.qty x unit_cost, corak SAMA botol. SEMUA query di sini query SENDIRI
// (tak join ke query botol) supaya N gift per SKU tak fan-out kiraan botol.
// Sifar kesan parity/recon (lapisan kos, bukan kategori duit).
// ====================================================================
export interface SkuGiftItem { gift_name: string; unit_cost: number; qty: number; }
export interface SkuGifts {
  sku: string; product_name: string | null; gifts: SkuGiftItem[]; costPerUnit: number;
}

// Senarai SKU (dari sku_bottles = katalog SKU) + gift masing-masing. SKU tanpa
// gift tetap muncul (gifts kosong) supaya finance boleh tambah.
export async function skuGiftsListImpl(): Promise<SkuGifts[]> {
  await ensureGiftTable();
  const res = await getPool().query(`
    SELECT sb.sku, sb.product_name, sg.gift_name, sg.unit_cost, sg.qty
    FROM sku_bottles sb
    LEFT JOIN sku_gifts sg ON UPPER(TRIM(sg.sku)) = UPPER(TRIM(sb.sku))
    ORDER BY sb.sku, sg.gift_name`);
  const map = new Map<string, SkuGifts>();
  for (const r of res.rows) {
    let e = map.get(r.sku as string);
    if (!e) {
      e = { sku: r.sku, product_name: r.product_name, gifts: [], costPerUnit: 0 };
      map.set(r.sku as string, e);
    }
    if (r.gift_name != null) {
      const uc = toNum(r.unit_cost), q = toNum(r.qty);
      e.gifts.push({ gift_name: r.gift_name, unit_cost: uc, qty: q });
      e.costPerUnit += uc * q;
    }
  }
  return [...map.values()];
}

export interface GiftCostSummary {
  confirmedCost: number;   // gift atas order Completed + duit disahkan
  atRiskCost: number;      // gift atas order Returned/Rejected atau Completed tapi duit tak masuk = bocor
  giftsGiven: number;      // unit gift (confirmed)
  giftTypes: number;       // bilangan jenis gift dalam katalog
  skusWithGifts: number;   // bilangan SKU yang ada gift
  skuCount: number;        // jumlah SKU dalam katalog
  byGiftType: { gift_name: string; qty: number; cost: number }[]; // confirmed
}

export async function giftCostSummaryImpl(): Promise<GiftCostSummary> {
  await ensureGiftTable();
  const p = getPool();
  const agg = await p.query(`
    WITH og AS (
      SELECT o.order_id, o.status,
             SUM(os.qty * sg.qty * COALESCE(sg.unit_cost, 0)) AS gift_cost,
             MAX(${CONF_SQL}) AS conf
      FROM orders o
      JOIN order_skus os ON os.order_id = o.order_id
      JOIN sku_gifts sg ON UPPER(TRIM(sg.sku)) = os.sku
      GROUP BY o.order_id, o.status
    )
    SELECT
      COALESCE(SUM(CASE WHEN status = 'Completed' AND conf = 1 THEN gift_cost END), 0) AS confirmed_cost,
      COALESCE(SUM(CASE WHEN status IN ('Returned', 'Rejected')
                          OR (status = 'Completed' AND conf = 0)
                        THEN gift_cost END), 0) AS atrisk_cost
    FROM og`);
  const byType = await p.query(`
    SELECT sg.gift_name,
           SUM(os.qty * sg.qty) AS qty,
           SUM(os.qty * sg.qty * COALESCE(sg.unit_cost, 0)) AS cost
    FROM orders o
    JOIN order_skus os ON os.order_id = o.order_id
    JOIN sku_gifts sg ON UPPER(TRIM(sg.sku)) = os.sku
    WHERE o.status = 'Completed' AND (${CONF_SQL}) = 1
    GROUP BY sg.gift_name ORDER BY cost DESC, sg.gift_name`);
  const counts = await p.query(`
    SELECT
      (SELECT COUNT(*) FROM sku_bottles) AS sku_count,
      (SELECT COUNT(DISTINCT UPPER(TRIM(sku))) FROM sku_gifts) AS skus_with_gifts,
      (SELECT COUNT(DISTINCT gift_name) FROM sku_gifts) AS gift_types`);
  const c = counts.rows[0];
  return {
    confirmedCost: toNum(agg.rows[0].confirmed_cost),
    atRiskCost: toNum(agg.rows[0].atrisk_cost),
    giftsGiven: byType.rows.reduce((a, r) => a + toNum(r.qty), 0),
    giftTypes: Number(c.gift_types),
    skusWithGifts: Number(c.skus_with_gifts),
    skuCount: Number(c.sku_count),
    byGiftType: byType.rows.map((r) => ({
      gift_name: r.gift_name as string, qty: toNum(r.qty), cost: toNum(r.cost),
    })),
  };
}

export interface StockistGift { stockist: string; gift_name: string; qty: number; cost: number; }

// Gift per stokis (confirmed sahaja, selaras botol confirmed). Page stokis
// kumpul ikut stokis jadi chip + total kos.
export async function stockistGiftsImpl(): Promise<StockistGift[]> {
  await ensureGiftTable();
  const res = await getPool().query(`
    SELECT COALESCE(o.seller_name, '(no stockist)') AS stockist,
           sg.gift_name,
           SUM(os.qty * sg.qty) AS qty,
           SUM(os.qty * sg.qty * COALESCE(sg.unit_cost, 0)) AS cost
    FROM orders o
    JOIN order_skus os ON os.order_id = o.order_id
    JOIN sku_gifts sg ON UPPER(TRIM(sg.sku)) = os.sku
    WHERE o.status = 'Completed' AND (${CONF_SQL}) = 1
    GROUP BY 1, 2 ORDER BY 1, cost DESC`);
  return res.rows.map((r) => ({
    stockist: r.stockist as string, gift_name: r.gift_name as string,
    qty: toNum(r.qty), cost: toNum(r.cost),
  }));
}

// ====================================================================
// Stockist mini page (drill modal): potret satu stokis, berpenapis tarikh.
// SEMUA additive + read-only, guna semula CONF_SQL. TIDAK sentuh
// stockistBottlesImpl / streamSummary / CONF_SQL (yang dalam harness parity).
// Tarikh: order-based blok ikut order_date; komisen ikut txn_date. Prefix 10
// char (LEFT(...,10)) supaya immune pada bahagian masa; NULL tarikh terkecuali.
// Bukan di-cache (per-arg + perlu segar, selari drill/search sedia ada).
// ====================================================================
export interface StockistDetail {
  stockist: string; from: string; to: string;
  money: {
    expected: number; confirmedNet: number; awaiting: number;
    ordersTotal: number; ordersWithFeed: number;
    collectedOnReturned: number; returnedWithMoney: number;
  };
  bottles: { total: number; paid: number; free: number; confirmed: number; unconfirmed: number };
  status: {
    completed: number; returned: number; rejected: number; other: number;
    total: number; returnRate: number; returnedBottles: number; rejectedBottles: number;
  };
  commission: {
    level: string; earned: number; paid: number; balance: number;
    leakAmount: number; leakOrders: number;
  };
  products: { sku: string; product_name: string | null; bottles: number }[];
  gifts: {
    confirmed: { gift_name: string; qty: number; cost: number }[];
    confirmedCost: number; atRiskCost: number;
  };
  orders: { rows: StockistOrder[]; total: number };
  unmappedSkus: string[];
}

export async function stockistDetail(
  seller: string, from: string, to: string,
): Promise<StockistDetail> {
  await ensureGiftTable();
  const p = getPool();
  const A = [seller, from, to]; // param set sama untuk semua query order-based

  const [money, bottles, statusCounts, lossBottles, comm, commLeak,
         products, giftsConf, giftsRisk, orders, unmapped] = await Promise.all([
    // MONEY
    p.query(`
      WITH ord AS (
        SELECT o.status, o.selling_price,
               ${CONF_SQL} AS conf,
               (SELECT cl.cod_amount FROM cod_bill_lines cl WHERE cl.awb = o.tracking LIMIT 1) AS cod_amt,
               (SELECT cl.fee FROM cod_bill_lines cl WHERE cl.awb = o.tracking LIMIT 1) AS cod_fee,
               (SELECT COALESCE(SUM(pp.amount - COALESCE(pp.fee, 0)), 0)
                FROM prepaid_payments pp WHERE pp.order_ref = o.order_id) AS prepaid_net
        FROM orders o
        WHERE COALESCE(o.seller_name, '(no stockist)') = $1
          AND LEFT(o.order_date, 10) BETWEEN $2 AND $3
      )
      SELECT
        COALESCE(SUM(selling_price), 0) AS expected,
        COALESCE(SUM(CASE WHEN conf = 1
          THEN COALESCE(cod_amt, 0) - COALESCE(cod_fee, 0) + COALESCE(prepaid_net, 0) END), 0) AS confirmed_net,
        COALESCE(SUM(CASE WHEN conf = 0 THEN selling_price END), 0) AS awaiting,
        COUNT(*) AS orders_total,
        COALESCE(SUM(CASE WHEN conf = 1 THEN 1 ELSE 0 END), 0) AS orders_with_feed,
        COALESCE(SUM(CASE WHEN status = 'Returned' AND cod_amt IS NOT NULL THEN cod_amt END), 0) AS collected_on_returned,
        COALESCE(SUM(CASE WHEN status = 'Returned' AND cod_amt IS NOT NULL THEN 1 ELSE 0 END), 0) AS returned_with_money
      FROM ord`, A),
    // BOTTLES (Completed sahaja = botol bergerak; split paid/free + confirmed/unconfirmed)
    p.query(`
      SELECT
        COALESCE(SUM(bp + bf), 0) AS total,
        COALESCE(SUM(bp), 0) AS paid,
        COALESCE(SUM(bf), 0) AS free,
        COALESCE(SUM(CASE WHEN conf = 1 THEN bp + bf END), 0) AS confirmed,
        COALESCE(SUM(CASE WHEN conf = 0 THEN bp + bf END), 0) AS unconfirmed
      FROM (SELECT COALESCE(os.qty * COALESCE(sb.paid, 0), 0) AS bp,
                   COALESCE(os.qty * COALESCE(sb.free, 0), 0) AS bf,
                   ${CONF_SQL} AS conf
            FROM orders o
            LEFT JOIN order_skus os ON os.order_id = o.order_id
            LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
            WHERE o.status = 'Completed'
              AND COALESCE(o.seller_name, '(no stockist)') = $1
              AND LEFT(o.order_date, 10) BETWEEN $2 AND $3) x`, A),
    // STATUS counts
    p.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN status = 'Returned' THEN 1 ELSE 0 END), 0) AS returned,
        COALESCE(SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejected,
        COALESCE(SUM(CASE WHEN status IS NULL OR status NOT IN ('Completed','Returned','Rejected') THEN 1 ELSE 0 END), 0) AS other,
        COUNT(*) AS total
      FROM orders o
      WHERE COALESCE(o.seller_name, '(no stockist)') = $1
        AND LEFT(o.order_date, 10) BETWEEN $2 AND $3`, A),
    // LOSS bottles (Returned / Rejected)
    p.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'Returned' THEN bqty END), 0) AS returned_bottles,
        COALESCE(SUM(CASE WHEN status = 'Rejected' THEN bqty END), 0) AS rejected_bottles
      FROM (SELECT o.status,
                   COALESCE(SUM(os.qty * (COALESCE(sb.paid, 0) + COALESCE(sb.free, 0))), 0) AS bqty
            FROM orders o
            LEFT JOIN order_skus os ON os.order_id = o.order_id
            LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
            WHERE COALESCE(o.seller_name, '(no stockist)') = $1
              AND LEFT(o.order_date, 10) BETWEEN $2 AND $3
              AND o.status IN ('Returned', 'Rejected')
            GROUP BY o.order_id, o.status) t`, A),
    // COMMISSION summary (ikut txn_date)
    p.query(`
      SELECT MIN(seller_role) AS level,
             SUM(CASE WHEN status = 'Approved' AND txn_type = 'IN' THEN amount ELSE 0 END) AS earned,
             SUM(CASE WHEN status = 'Approved' AND txn_type = 'OUT' AND source = 'Withdraw' THEN amount ELSE 0 END) AS paid
      FROM wallet_txns w
      WHERE seller_name = $1 AND LEFT(w.txn_date, 10) BETWEEN $2 AND $3`, A),
    // COMMISSION leak: komisen IN Approved atas order BUKAN confirmed-paid
    p.query(`
      SELECT COALESCE(SUM(w.amount), 0) AS leak_amount, COUNT(*) AS leak_orders
      FROM wallet_txns w
      JOIN orders o ON o.order_id = w.order_id
      WHERE w.seller_name = $1 AND w.status = 'Approved' AND w.txn_type = 'IN'
        AND LEFT(w.txn_date, 10) BETWEEN $2 AND $3
        AND (${CONF_SQL}) = 0`, A),
    // PRODUCTS: top SKU ikut botol (Completed)
    p.query(`
      SELECT os.sku AS sku, MAX(sb.product_name) AS product_name,
             COALESCE(SUM(os.qty * (COALESCE(sb.paid, 0) + COALESCE(sb.free, 0))), 0) AS bottles
      FROM orders o
      JOIN order_skus os ON os.order_id = o.order_id
      LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
      WHERE o.status = 'Completed'
        AND COALESCE(o.seller_name, '(no stockist)') = $1
        AND LEFT(o.order_date, 10) BETWEEN $2 AND $3
      GROUP BY os.sku
      HAVING SUM(os.qty * (COALESCE(sb.paid, 0) + COALESCE(sb.free, 0))) > 0
      ORDER BY bottles DESC, os.sku LIMIT 8`, A),
    // GIFTS confirmed (Completed + duit disahkan)
    p.query(`
      SELECT sg.gift_name, SUM(os.qty * sg.qty) AS qty,
             SUM(os.qty * sg.qty * COALESCE(sg.unit_cost, 0)) AS cost
      FROM orders o
      JOIN order_skus os ON os.order_id = o.order_id
      JOIN sku_gifts sg ON UPPER(TRIM(sg.sku)) = os.sku
      WHERE o.status = 'Completed' AND (${CONF_SQL}) = 1
        AND COALESCE(o.seller_name, '(no stockist)') = $1
        AND LEFT(o.order_date, 10) BETWEEN $2 AND $3
      GROUP BY sg.gift_name ORDER BY cost DESC, sg.gift_name`, A),
    // GIFTS at-risk vs confirmed cost
    p.query(`
      WITH og AS (
        SELECT o.order_id, o.status, ${CONF_SQL} AS conf,
               SUM(os.qty * sg.qty * COALESCE(sg.unit_cost, 0)) AS gc
        FROM orders o
        JOIN order_skus os ON os.order_id = o.order_id
        JOIN sku_gifts sg ON UPPER(TRIM(sg.sku)) = os.sku
        WHERE COALESCE(o.seller_name, '(no stockist)') = $1
          AND LEFT(o.order_date, 10) BETWEEN $2 AND $3
        GROUP BY o.order_id, o.status, o.tracking
      )
      SELECT
        COALESCE(SUM(CASE WHEN status = 'Completed' AND conf = 1 THEN gc END), 0) AS confirmed_cost,
        COALESCE(SUM(CASE WHEN status IN ('Returned','Rejected') OR (status = 'Completed' AND conf = 0) THEN gc END), 0) AS atrisk_cost
      FROM og`, A),
    // ORDERS (enriched + scoped)
    stockistOrders(seller, DRILL_CAP, from, to),
    // SKU unmapped stokis+tempoh ni: dikira 0 botol, punca klasik "botol kosong"
    p.query(`
      SELECT DISTINCT os.sku
      FROM orders o
      JOIN order_skus os ON os.order_id = o.order_id
      WHERE COALESCE(o.seller_name, '(no stockist)') = $1
        AND LEFT(o.order_date, 10) BETWEEN $2 AND $3
        AND os.sku NOT IN (SELECT UPPER(TRIM(sku)) FROM sku_bottles WHERE sku IS NOT NULL)
      ORDER BY os.sku`, A),
  ]);

  const m = money.rows[0], b = bottles.rows[0], sc = statusCounts.rows[0];
  const lb = lossBottles.rows[0], cm = comm.rows[0], cl = commLeak.rows[0];
  const gr = giftsRisk.rows[0];
  const returned = toNum(sc.returned), rejected = toNum(sc.rejected), total = toNum(sc.total);
  const earned = toNum(cm.earned), paid = toNum(cm.paid);

  return {
    stockist: seller, from, to,
    money: {
      expected: toNum(m.expected), confirmedNet: toNum(m.confirmed_net),
      awaiting: toNum(m.awaiting), ordersTotal: toNum(m.orders_total),
      ordersWithFeed: toNum(m.orders_with_feed),
      collectedOnReturned: toNum(m.collected_on_returned),
      returnedWithMoney: toNum(m.returned_with_money),
    },
    bottles: {
      total: toNum(b.total), paid: toNum(b.paid), free: toNum(b.free),
      confirmed: toNum(b.confirmed), unconfirmed: toNum(b.unconfirmed),
    },
    status: {
      completed: toNum(sc.completed), returned, rejected, other: toNum(sc.other),
      total, returnRate: total > 0 ? (returned + rejected) / total : 0,
      returnedBottles: toNum(lb.returned_bottles), rejectedBottles: toNum(lb.rejected_bottles),
    },
    commission: {
      level: cm.level ?? "", earned, paid,
      balance: Math.round((earned - paid) * 100) / 100,
      leakAmount: toNum(cl.leak_amount), leakOrders: Number(cl.leak_orders),
    },
    products: products.rows.map((r) => ({
      sku: r.sku, product_name: r.product_name, bottles: toNum(r.bottles),
    })),
    gifts: {
      confirmed: giftsConf.rows.map((r) => ({
        gift_name: r.gift_name, qty: toNum(r.qty), cost: toNum(r.cost),
      })),
      confirmedCost: toNum(gr.confirmed_cost), atRiskCost: toNum(gr.atrisk_cost),
    },
    orders,
    unmappedSkus: unmapped.rows.map((r) => r.sku as string),
  };
}

// ====================================================================
// Fail upload: dikesan dari source_file setiap jadual transaksi. Satu fail
// biasanya satu jenis feed; kalau fail sama isi >1 jadual, keluar >1 baris.
// TAK di-cache: page uploads force-dynamic, mesti segar sejurus lepas delete.
// ====================================================================
export interface UploadedFile {
  file: string; kind: string; rows: number; lastAt: string | null;
}

export async function uploadedFiles(): Promise<UploadedFile[]> {
  const res = await getPool().query(`
    SELECT source_file AS file, kind, COUNT(*) AS n_rows, MAX(ingested_at) AS last_at
    FROM (
      SELECT source_file, 'orders' AS kind, ingested_at FROM orders WHERE source_file IS NOT NULL
      UNION ALL
      SELECT source_file, 'cod', ingested_at FROM cod_bill_lines WHERE source_file IS NOT NULL
      UNION ALL
      SELECT source_file, 'prepaid', ingested_at FROM prepaid_payments WHERE source_file IS NOT NULL
      UNION ALL
      SELECT source_file, 'wallet', ingested_at FROM wallet_txns WHERE source_file IS NOT NULL
    ) t
    GROUP BY source_file, kind
    ORDER BY MAX(ingested_at) DESC, source_file`);
  return res.rows.map((r) => ({
    file: r.file, kind: r.kind, rows: toNum(r.n_rows), lastAt: r.last_at,
  }));
}

// ====================================================================
// Cache lapisan data: agregat berat di-cache dgn tag "recon", dibatalkan
// (revalidateTag "recon") masa upload / simpan SKU / reset. revalidate 3600s =
// jaring keselamatan kalau ada tulisan terlepas invalidate. Drill/search/bank
// SENGAJA tak di-cache (perlu segar / per-arg). Halaman kekal force-dynamic;
// unstable_cache ni cache DATA (merentas request), bukan cache route.
// ====================================================================
const RECON_CACHE = { tags: ["recon"], revalidate: 3600 };

export const streamSummary = unstable_cache(streamSummaryImpl, ["streamSummary"], RECON_CACHE);
export const storeCounts = unstable_cache(storeCountsImpl, ["storeCounts"], RECON_CACHE);
export const lastIngest = unstable_cache(lastIngestImpl, ["lastIngest"], RECON_CACHE);
export const stockistBottles = unstable_cache(stockistBottlesImpl, ["stockistBottles"], RECON_CACHE);
export const skuMap = unstable_cache(skuMapImpl, ["skuMap"], RECON_CACHE);
export const unmappedSkus = unstable_cache(unmappedSkusImpl, ["unmappedSkus"], RECON_CACHE);
export const commissionSummary = unstable_cache(commissionSummaryImpl, ["commissionSummary"], RECON_CACHE);
export const skuGiftsList = unstable_cache(skuGiftsListImpl, ["skuGiftsList"], RECON_CACHE);
export const giftCostSummary = unstable_cache(giftCostSummaryImpl, ["giftCostSummary"], RECON_CACHE);
export const stockistGifts = unstable_cache(stockistGiftsImpl, ["stockistGifts"], RECON_CACHE);
