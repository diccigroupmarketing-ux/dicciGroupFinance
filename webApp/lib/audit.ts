// Jejak audit tindakan pengguna (multi-user Clerk). Best-effort: logEvent TAK
// PERNAH melempar, supaya kegagalan log tak pecahkan tindakan utama. Additive.
import { randomUUID } from "node:crypto";
import { getPool } from "./db";

let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS app_events (
      event_id TEXT PRIMARY KEY,
      ts       TEXT,
      actor    TEXT,
      action   TEXT,
      detail   TEXT
    )`);
  ensured = true;
}

export async function logEvent(actor: string, action: string, detail: string): Promise<void> {
  try {
    await ensureTable();
    await getPool().query(
      `INSERT INTO app_events (event_id, ts, actor, action, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), new Date().toISOString(), actor || "unknown",
       action, detail.slice(0, 500)],
    );
  } catch (e) {
    console.error("audit logEvent gagal", e);
  }
}

export interface AppEvent {
  ts: string | null; actor: string | null; action: string | null; detail: string | null;
}

export async function getRecentEvents(limit = 60): Promise<AppEvent[]> {
  await ensureTable();
  const res = await getPool().query(
    `SELECT ts, actor, action, detail FROM app_events
     ORDER BY ts DESC LIMIT $1`, [limit]);
  return res.rows;
}
