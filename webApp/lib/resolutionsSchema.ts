// Jamin jadual lapisan Resolution wujud sebelum baca/tulis (cermin giftsSchema /
// billConflictsSchema / bank.ts). Idempotent, sekali per proses.
//
// KENAPA jadual sendiri, bukan lajur dalam jadual recon: lapisan Resolution ialah
// rekod KEPUTUSAN MANUSIA di ATAS output recon. Ia tak pernah menyentuh duit.
// Kalau statusnya ditulis balik ke `orders` / `cod_bill_lines`, enjin recon akan
// nampak fakta berubah dan angka duit boleh bergerak. Diasingkan = mustahil.
//
// Dua jadual:
//   recon_resolutions        , keadaan SEMASA satu kes (satu baris per kes)
//   recon_resolution_events  , jejak APPEND ONLY setiap transisi (tiada UPDATE,
//                              tiada DELETE, ini bukti maker checker sebenar)
import { getPool } from "./db";

let ensured = false;

export async function ensureResolutionTables(): Promise<void> {
  if (ensured) return;
  const p = getPool();

  // subject_type + subject_id = dua paksi identiti stabil dalam sistem ni:
  //   'order' -> orders.order_id (PK global, stabil merentas re-upload)
  //   'awb'   -> baris DUIT, berprefiks ruang nama ('cod:...' / 'chip:...')
  //              sebab awb COD dan order_ref CHIP kedua dua duduk dalam lajur
  //              awb tmp_m dan boleh berlanggar.
  // Kategori dan stream SENGAJA cuma disimpan sebagai *_snapshot (bukan kunci):
  // kategori boleh bertukar sendiri bila hari berganti (belum_remit ->
  // hilang_lewat) dan stream boleh berpindah bila fail Fighter baru ditimpa.
  await p.query(`
    CREATE TABLE IF NOT EXISTS recon_resolutions (
      resolution_id     TEXT PRIMARY KEY,
      subject_type      TEXT,
      subject_id        TEXT,
      stream_snapshot   TEXT,
      category_snapshot TEXT,
      amount_snapshot   DOUBLE PRECISION,
      expected_snapshot DOUBLE PRECISION,
      fingerprint       TEXT,
      reason            TEXT,
      note              TEXT,
      adjust_amount     DOUBLE PRECISION DEFAULT 0,
      counterparty      TEXT,
      duplicate_ref     TEXT,
      expires_on        TEXT,
      batch_id          TEXT,
      state             TEXT,
      proposed_by       TEXT,
      proposed_at       TEXT,
      decided_by        TEXT,
      decided_at        TEXT,
      decision_note     TEXT,
      supersedes        TEXT
    )`);

  // INDEX UNIK SEPARA = penguat kuasa "satu kes HIDUP sahaja per subjek", di
  // peringkat DB bukan JS. Kes yang dah rejected/withdrawn/voided tak dikira,
  // jadi subjek yang sama boleh dicadang semula kemudian (sejarah kekal).
  await p.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recon_res_live
      ON recon_resolutions (subject_type, subject_id)
      WHERE state IN ('proposed', 'approved')`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_recon_res_state ON recon_resolutions(state)`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_recon_res_batch ON recon_resolutions(batch_id)`);

  // Jejak APPEND ONLY. payload menyimpan fakta yang pemutus NAMPAK masa dia buat
  // keputusan (fingerprint + amaun), supaya kemudian hari kita boleh jawab
  // "dia lulus berdasarkan angka apa", bukan sekadar "dia lulus".
  await p.query(`
    CREATE TABLE IF NOT EXISTS recon_resolution_events (
      event_id      TEXT PRIMARY KEY,
      resolution_id TEXT,
      event         TEXT,
      actor         TEXT,
      at            TEXT,
      payload       JSONB
    )`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_recon_res_ev_rid
       ON recon_resolution_events(resolution_id)`);

  ensured = true;
}
