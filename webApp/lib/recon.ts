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
import { getPool } from "./db";

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

export async function streamSummary(
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
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function storeCounts(): Promise<{ orders: number; billLines: number; wallet: number }> {
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
export async function lastIngest(): Promise<string | null> {
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

export async function stockistBottles(): Promise<StockistRow[]> {
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
}

export async function stockistOrders(
  seller: string, cap: number = DRILL_CAP,
): Promise<{ rows: StockistOrder[]; total: number }> {
  const p = getPool();
  const res = await p.query(`
    SELECT o.order_id, o.order_date, o.status, o.payment_method,
           o.shipping_provider, o.tracking,
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
          WHERE COALESCE(seller_name, '(no stockist)') = $1
          ORDER BY order_date DESC LIMIT $2) o
    ORDER BY o.order_date DESC`, [seller, cap]);
  const tot = await p.query(
    `SELECT COUNT(*) AS n FROM orders
     WHERE COALESCE(seller_name, '(no stockist)') = $1`, [seller]);
  return {
    rows: res.rows.map((r) => ({
      order_id: r.order_id, order_date: r.order_date, status: r.status,
      payment_method: r.payment_method, shipping_provider: r.shipping_provider,
      tracking: r.tracking,
      botol_paid: toNum(r.botol_paid), botol_free: toNum(r.botol_free),
      botol_total: toNum(r.botol_paid) + toNum(r.botol_free),
      duit: r.duit,
    })),
    total: Number(tot.rows[0].n),
  };
}

export interface SkuRow {
  sku: string; product_name: string | null; paid: number; free: number;
}

export async function skuMap(): Promise<SkuRow[]> {
  const res = await getPool().query(
    `SELECT sku, product_name, paid, free FROM sku_bottles ORDER BY sku`);
  return res.rows.map((r) => ({
    sku: r.sku, product_name: r.product_name,
    paid: toNum(r.paid), free: toNum(r.free),
  }));
}

export interface CommissionRow {
  seller_name: string; level: string; earned: number; paid: number; balance: number;
}

// Salinan setia commission_summary dari reconSql.py.
export async function commissionSummary(): Promise<CommissionRow[]> {
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
