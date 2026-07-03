// Sambungan Postgres (Neon di produksi, embedded PG di dev).
// Pool tunggal per proses; Neon pooler friendly (lihat recon.ts: kerja tmp table
// sentiasa dalam SATU transaksi atas SATU client).
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _dicciPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!global._dicciPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL tidak diset");
    global._dicciPool = new Pool({
      connectionString: url,
      max: 5,
      ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return global._dicciPool;
}
