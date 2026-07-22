// Jamin jadual bill_line_conflicts wujud sebelum baca (cermin orderUploadsSchema
// / giftsSchema). db.py SCHEMA = source of truth; ini jaring supaya page Uploads
// di Neon tak pecah walaupun belum ada ingest bil yang jalankan init_db lepas
// deploy. Idempotent, sekali per proses.
import { getPool } from "./db";

let ensured = false;

export async function ensureBillConflictsTable(): Promise<void> {
  if (ensured) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS bill_line_conflicts (
      awb              TEXT,
      bill_id_new      TEXT,
      bill_id_existing TEXT,
      cod_new          DOUBLE PRECISION,
      cod_existing     DOUBLE PRECISION,
      fee_new          DOUBLE PRECISION,
      delivered_date   TEXT,
      source_file      TEXT,
      detected_at      TEXT,
      PRIMARY KEY (awb, bill_id_new)
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_bill_conflicts_awb ON bill_line_conflicts(awb)`);
  ensured = true;
}
