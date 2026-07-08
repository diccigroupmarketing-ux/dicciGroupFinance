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
    const dup = await client.query(
      "SELECT 1 FROM sku_bottles WHERE UPPER(TRIM(sku)) = UPPER(TRIM($1))", [sku]);
    if (dup.rowCount) throw new Error(`SKU '${sku}' sudah wujud`);
    await client.query(
      "INSERT INTO sku_bottles (sku, product_name, paid, free) VALUES ($1, $2, $3, $4)",
      [sku, pn, paid, free]);
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

// Admin = email dalam allowlist ADMIN_EMAILS (koma). Tak diset -> tiada admin
// (selamat by default; reset kekal terkunci sampai env diisi).
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
