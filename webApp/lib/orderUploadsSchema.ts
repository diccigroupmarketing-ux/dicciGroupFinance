// Jamin jadual order_uploads wujud sebelum deleteUpload baca/tulis (cermin
// giftsSchema.ts / bank.ts). db.py SCHEMA = source of truth; ini jaring supaya
// deleteUpload di Neon tak pecah walaupun belum ada ingest Fighter yang jalankan
// init_db lepas deploy. Idempotent, sekali per proses.
//
// NOTA migrasi: jadual ni BERMULA KOSONG di prod. Order sedia ada (sebelum fix
// B1) tiada baris di sini = "legacy". deleteUpload sengaja TAK padam order legacy
// (tiada jejak untuk sahkan ia eksklusif fail itu). Bila fail Fighter di-upload
// semula, ingest isi pasangan dan jejak jadi lengkap untuk order itu.
import { getPool } from "./db";

let ensured = false;

export async function ensureOrderUploadsTable(): Promise<void> {
  if (ensured) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS order_uploads (
      order_id    TEXT,
      source_file TEXT,
      ingested_at TEXT,
      PRIMARY KEY (order_id, source_file)
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_order_uploads_file ON order_uploads(source_file)`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_order_uploads_order ON order_uploads(order_id)`);
  ensured = true;
}
