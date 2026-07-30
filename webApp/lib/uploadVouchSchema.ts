// Jamin jadual vouch wallet_uploads + prepaid_uploads wujud sebelum deleteUpload
// baca/tulis (cermin orderUploadsSchema.ts). db.py SCHEMA = source of truth; ini
// jaring supaya deleteUpload di Neon tak pecah walaupun belum ada ingest
// Wallet/CHIP yang jalankan init_db lepas deploy. Idempotent, sekali per proses.
//
// NOTA migrasi: kedua dua jadual BERMULA KOSONG di prod. Baris wallet_txns /
// prepaid_payments sedia ada (sebelum fix F05) tiada pasangan di sini = "legacy".
// deleteUpload sengaja TAK padam baris legacy (tiada jejak untuk sahkan ia
// eksklusif fail itu, dan baris tu duit). Bila fail berkenaan di-upload semula,
// ingest isi pasangan dan jejak jadi lengkap untuk baris itu.
import { getPool } from "./db";

let ensured = false;

export async function ensureUploadVouchTables(): Promise<void> {
  if (ensured) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS wallet_uploads (
      txn_id      TEXT,
      source_file TEXT,
      ingested_at TEXT,
      PRIMARY KEY (txn_id, source_file)
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_wallet_uploads_file ON wallet_uploads(source_file)`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_wallet_uploads_txn ON wallet_uploads(txn_id)`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS prepaid_uploads (
      gateway     TEXT,
      order_ref   TEXT,
      source_file TEXT,
      ingested_at TEXT,
      PRIMARY KEY (gateway, order_ref, source_file)
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_prepaid_uploads_file ON prepaid_uploads(source_file)`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_prepaid_uploads_ref ON prepaid_uploads(gateway, order_ref)`);
  ensured = true;
}
