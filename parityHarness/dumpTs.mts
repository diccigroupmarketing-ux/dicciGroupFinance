// E3: dump kategori PER ORDER dari enjin TypeScript (webApp/lib/recon.ts),
// bentuk output IDENTIK dengan dumpPy.py supaya boleh banding terus.
//
// Sambung ke DATABASE_URL (dev PG 5433 sahaja). RECON_TODAY dikunci sebelum
// modul recon dinilai (sama corak scripts/reconEnv.ts).
import { writeFileSync } from "node:fs";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("set DATABASE_URL");
if (/neon/i.test(process.env.DATABASE_URL)) throw new Error("HARAM sentuh Neon");
process.env.RECON_TODAY ??= "2026-06-18";

const MIRROR = process.env.RECON_MIRROR!;
const OUT = process.env.RECON_OUT!;

const {
  buildTmpM, buildTmpMPrepaid, REMIT_PENDING_DAYS,
} = await import(MIRROR);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

async function dump(kind: "courier" | "prepaid", key: string): Promise<string[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (kind === "courier") await buildTmpM(c, key, REMIT_PENDING_DAYS);
    else await buildTmpMPrepaid(c, key);
    const r = await c.query(
      "SELECT order_id, awb, bill_id, kategori FROM tmp_m");
    await c.query("ROLLBACK");
    return r.rows
      .map((x) => `${s(x.order_id)}|${s(x.awb)}|${s(x.bill_id)}|${s(x.kategori)}`)
      .sort();
  } finally {
    c.release();
  }
}

const out: Record<string, string[]> = {};
for (const k of ["jnt", "dhl", "ninja"]) out[k] = await dump("courier", k);
for (const k of ["chip"]) out[k] = await dump("prepaid", k);
writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log(Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(" "));
await pool.end();
