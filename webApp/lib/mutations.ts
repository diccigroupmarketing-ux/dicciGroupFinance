// Tulis ke DB (bukan bacaan recon). Port SETIA dari db.py:
//   saveSkuMap  <- save_sku_map  (ganti penuh jadual sku_bottles)
//   resetStore  <- reset_db      (padam data transaksi, KEKAL sku_bottles)
// Bacaan recon kekal di recon.ts; mutasi diasingkan supaya recon.ts tetap
// cermin murni reconSql.py.
import { getPool } from "./db";
import { ensureGiftTable } from "./giftsSchema";

export interface SkuInput {
  sku: string;
  product_name?: string | null;
  paid?: number | null;
  free?: number | null;
}

export interface GiftInput {
  gift_name: string;
  unit_cost?: number | null;
  qty?: number | null;
}

// Jadikan integer >= 0 (padan INTEGER DEFAULT 0 dalam skema; buang pecahan & negatif).
function nonNegInt(v: unknown): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Ganti PENUH jadual sku_bottles dengan set baru (sama macam save_sku_map:
// DELETE semua, INSERT semula). Dibungkus SATU transaksi supaya kalau insert
// gagal, DELETE di-rollback (jadual tak tertinggal kosong) , lebih selamat
// dari versi Python tanpa mengubah kelakuan bila berjaya.
export async function saveSkuMap(rows: SkuInput[]): Promise<number> {
  const clean = rows
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      sku: String(r?.sku ?? "").trim(),
      pn: r?.product_name == null ? "" : String(r.product_name),
      paid: nonNegInt(r?.paid),
      free: nonNegInt(r?.free),
    }))
    .filter((r) => r.sku && r.sku.toLowerCase() !== "nan");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM sku_bottles");
    for (const r of clean) {
      await client.query(
        `INSERT INTO sku_bottles (sku, product_name, paid, free)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sku) DO UPDATE SET
           product_name = excluded.product_name,
           paid = excluded.paid, free = excluded.free`,
        [r.sku, r.pn, r.paid, r.free],
      );
    }
    await client.query("COMMIT");
    return clean.length;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Tambah SATU SKU baru ke katalog (sku_bottles) tanpa sentuh SKU lain , berbeza
// dari saveSkuMap yang ganti PENUH. Dipakai dari page Free gift supaya finance
// boleh cipta SKU LENGKAP (terus dengan botol) tanpa loncat ke page SKU. Tolak
// kalau SKU dah wujud (case-insensitive) , join recon guna UPPER(TRIM), jadi dua
// baris case-variant = double count botol. Error "sudah wujud" -> route balas 409.
export async function addSku(row: SkuInput): Promise<void> {
  const sku = String(row?.sku ?? "").trim();
  if (!sku || sku.toLowerCase() === "nan") throw new Error("SKU kosong");
  const pn = row?.product_name == null ? "" : String(row.product_name);
  const paid = nonNegInt(row?.paid);
  const free = nonNegInt(row?.free);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Kunci berasaskan SKU ternormal (UPPER+TRIM) supaya dua permintaan Add SKU
    // serentak untuk varian case sama (cth 'abc-1' vs 'ABC-1') tak lepas check
    // then insert dua dua , tanpa ni kedua dua SELECT dup nampak kosong lalu
    // kedua dua INSERT jaya (PK sku MENTAH berbeza) dan botol tergandakan dalam
    // recon yang join UPPER(TRIM). Lock dilepas automatik hujung transaksi.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext(UPPER(TRIM($1))))", [sku]);
    const dup = await client.query(
      "SELECT 1 FROM sku_bottles WHERE UPPER(TRIM(sku)) = UPPER(TRIM($1))", [sku]);
    if (dup.rowCount) throw new Error(`SKU '${sku}' sudah wujud`);
    await client.query(
      "INSERT INTO sku_bottles (sku, product_name, paid, free) VALUES ($1, $2, $3, $4)",
      [sku, pn, paid, free]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Kos RM >= 0, dua titik perpuluhan (sen). Qty gift integer >= 1.
function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}
function posInt(v: unknown): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Ganti SEMUA free gift untuk SATU SKU (delete where sku, insert baru). Per-SKU
// supaya edit satu SKU tak sentuh SKU lain (selamat concurrent, sepadan modal
// yang edit satu SKU pada satu masa). Dibungkus transaksi.
export async function saveGifts(sku: string, gifts: GiftInput[]): Promise<number> {
  await ensureGiftTable();
  const skuKey = String(sku ?? "").trim();
  if (!skuKey) throw new Error("SKU kosong");
  const clean = (gifts ?? [])
    .filter((g) => g && typeof g === "object")
    .map((g) => ({
      name: String(g?.gift_name ?? "").trim(),
      cost: money(g?.unit_cost),
      qty: posInt(g?.qty),
    }))
    .filter((g) => g.name);
  // Buang nama gift berganda dalam SATU SKU (case-insensitive; PK sku,gift_name).
  const seen = new Set<string>();
  const rows = clean.filter((g) => {
    const k = g.name.toUpperCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM sku_gifts WHERE UPPER(TRIM(sku)) = UPPER(TRIM($1))", [skuKey]);
    for (const g of rows) {
      await client.query(
        `INSERT INTO sku_gifts (sku, gift_name, unit_cost, qty)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sku, gift_name) DO UPDATE SET
           unit_cost = excluded.unit_cost, qty = excluded.qty`,
        [skuKey, g.name, g.cost, g.qty]);
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Padam SEMUA data transaksi yang di-upload. KEKAL sku_bottles (mapping config
// finance) , identik senarai jadual reset_db.
const RESET_TABLES = [
  "orders", "order_skus", "cod_bill_lines", "cod_bills",
  "wallet_txns", "prepaid_payments",
];

export async function resetStore(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const t of RESET_TABLES) {
      await client.query(`DELETE FROM ${t}`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Padam SEMUA baris yang datang dari SATU fail upload (source_file). Untuk
// finance betulkan fail tersalah upload: padam, upload semula versi betul
// (parser idempotent). SATU transaksi supaya tak separuh padam. order_skus
// tiada source_file, jadi ikut order_id fail tu. Bil courier tanpa baris
// tinggal (orphan) turut dibersih supaya tak jadi baki mati.
export interface DeleteUploadResult {
  orders: number; orderSkus: number; billLines: number; bills: number;
  prepaid: number; wallet: number; total: number;
}

export async function deleteUpload(file: string): Promise<DeleteUploadResult> {
  const f = String(file ?? "").trim();
  if (!f) throw new Error("nama fail kosong");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const orderSkus = await client.query(
      `DELETE FROM order_skus WHERE order_id IN
         (SELECT order_id FROM orders WHERE source_file = $1)`, [f]);
    const orders = await client.query(
      "DELETE FROM orders WHERE source_file = $1", [f]);
    // Padam baris bil fail ni, kutip bill_id terkesan (RETURNING) supaya lepas
    // ni kita boleh skop pembersihan header pada bil yang betul betul terjejas.
    const billLines = await client.query(
      "DELETE FROM cod_bill_lines WHERE source_file = $1 RETURNING bill_id", [f]);
    const affectedBills = [
      ...new Set(
        (billLines.rows as { bill_id: string | null }[])
          .map((r) => r.bill_id)
          .filter((b): b is string => b != null),
      ),
    ];
    // Header bil dipadam HANYA kalau tiada baris tinggal (elak orphan: baris fail
    // lain kongsi bill_id sama bila di-upsert source_file, kalau header dipadam
    // membabi buta duitnya lesap senyap dari recon). Skop pada bil fail ni sahaja
    // (header source_file sama, atau bil yang baru kehilangan baris), bukan padam
    // semua bil kosong merentas courier/fail lain.
    const bills = await client.query(
      `DELETE FROM cod_bills c
         WHERE (c.source_file = $1 OR c.bill_id = ANY($2::text[]))
           AND NOT EXISTS (SELECT 1 FROM cod_bill_lines l WHERE l.bill_id = c.bill_id)
         RETURNING c.bill_id`,
      [f, affectedBills]);
    // Pengesahan bank terikat pada bill_id. Bila header bil betul betul dipadam,
    // buang deposit basi supaya ia tak bangkit semula (auto-attach) bila bil sama
    // di-upload semula , kalau tidak variance (isyarat bocor duit) tersembunyi.
    // Guard to_regclass sebab jadual bank_deposits dicipta malas (lib/bank.ts).
    const deletedBillIds = (bills.rows as { bill_id: string | null }[])
      .map((r) => r.bill_id)
      .filter((b): b is string => b != null);
    if (deletedBillIds.length) {
      const hasBank = await client.query(
        "SELECT to_regclass('bank_deposits') AS t");
      if (hasBank.rows[0]?.t) {
        await client.query(
          "DELETE FROM bank_deposits WHERE bill_id = ANY($1::text[])",
          [deletedBillIds]);
      }
    }
    const prepaid = await client.query(
      "DELETE FROM prepaid_payments WHERE source_file = $1", [f]);
    const wallet = await client.query(
      "DELETE FROM wallet_txns WHERE source_file = $1", [f]);
    await client.query("COMMIT");
    const n = (r: { rowCount: number | null }) => r.rowCount ?? 0;
    const out = {
      orders: n(orders), orderSkus: n(orderSkus), billLines: n(billLines),
      bills: n(bills), prepaid: n(prepaid), wallet: n(wallet), total: 0,
    };
    out.total = out.orders + out.billLines + out.prepaid + out.wallet;
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Admin = email dalam allowlist ADMIN_EMAILS (koma). Tak diset -> tiada admin
// (selamat by default; reset kekal terkunci sampai env diisi).
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
