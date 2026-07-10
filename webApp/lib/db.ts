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
    // DEV GUARD, lapisan kedua pertahanan: dalam mod development, hanya benarkan
    // sambung ke DB tempatan. Kalau fail env rosak dan DATABASE_URL tercuri jadi
    // Neon prod, throw awal supaya proses dev fizikalnya tak boleh sentuh prod.
    if (process.env.NODE_ENV === "development") {
      const host = new URL(url).hostname;
      const localHosts = ["localhost", "127.0.0.1", "::1"];
      if (!localHosts.includes(host)) {
        throw new Error(
          `DEV GUARD: DATABASE_URL menunjuk ke DB bukan localhost (${host}). ` +
            "Dev mode hanya dibenarkan sambung ke DB tempatan. " +
            "Semak webApp/.env.development.local."
        );
      }
    }
    global._dicciPool = new Pool({
      connectionString: url,
      max: 8,
      connectionTimeoutMillis: 10_000,
      ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    // Neon (terutama pooler) tutup sambungan idle. Tanpa listener, error pada
    // client idle jadi uncaught exception yang boleh runtuhkan proses. Tangkap,
    // log, biar pool ganti client.
    global._dicciPool.on("error", (err) => {
      console.error("pg idle client error", err);
    });
  }
  return global._dicciPool;
}
