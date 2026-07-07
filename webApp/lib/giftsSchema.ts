// Jamin jadual sku_gifts wujud sebelum baca/tulis (cermin audit.ts ensureTable).
// db.py SCHEMA = source of truth; ini jaring supaya webApp tak pecah di Neon
// walaupun belum ada ingest yang jalankan init_db. Idempotent, sekali per proses.
import { getPool } from "./db";

let ensured = false;

export async function ensureGiftTable(): Promise<void> {
  if (ensured) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS sku_gifts (
      sku       TEXT,
      gift_name TEXT,
      unit_cost DOUBLE PRECISION DEFAULT 0,
      qty       INTEGER DEFAULT 1,
      PRIMARY KEY (sku, gift_name)
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_sku_gifts_sku ON sku_gifts(sku)`);
  ensured = true;
}
