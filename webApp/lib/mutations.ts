// Tulis ke DB (bukan bacaan recon). Port SETIA dari db.py:
//   saveSkuMap  <- save_sku_map  (ganti penuh jadual sku_bottles)
//   resetStore  <- reset_db      (padam data transaksi, KEKAL sku_bottles)
// Bacaan recon kekal di recon.ts; mutasi diasingkan supaya recon.ts tetap
// cermin murni reconSql.py.
import { getPool } from "./db";

export interface SkuInput {
  sku: string;
  product_name?: string | null;
  paid?: number | null;
  free?: number | null;
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
    .map((r) => ({
      sku: String(r.sku ?? "").trim(),
      pn: r.product_name == null ? "" : String(r.product_name),
      paid: nonNegInt(r.paid),
      free: nonNegInt(r.free),
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
