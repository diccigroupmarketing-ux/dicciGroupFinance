// Penggera kes tepi enjin recon TypeScript (E3 = lib/recon.ts) atas dev PG 5433.
//   npx tsx scripts/testReconEdgeCases.ts
//
// KENAPA WUJUD: parityCheck.ts banding E3 lawan reconSql.py atas data dev
// SEBENAR, dan data tu TIADA kes tepi. Jadi perubahan kategori pada kes jarang
// (AWB dikenali tapi order luar skop, seri separuh sen) boleh lepas tanpa
// dikesan. Skrip ni suntik baris perangkap SINTETIK, semak kategori E3, lepas
// tu buang balik baris tu.
//
// Pasangan Python: api/engine/tests/testReconEdgeCases.py (E1 lawan E2).
// Kalau awak ubah salah satu, ubah dua duanya.
import "./reconEnv";
import { streamSummaryImpl, type ExcRow } from "../lib/recon";
import { getPool } from "../lib/db";

// GUARD: skrip ni TULIS dan PADAM baris. Refuse selain dev PG lokal.
if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost). Skrip ni menulis data.");
  process.exit(1);
}

let fail = 0;
function ok(cond: boolean, label: string) {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) fail++;
}

const BILL = "TESTEDGE-BILL";
const FILE = "testReconEdgeCases.ts";
const STAMP = "2026-06-18 00:00:00";

// (order_id, provider, tracking, selling_price) , semua COD, Completed.
const ORDERS: [string, string, string, number][] = [
  // Order LUAR SKOP jnt (naik DHL). Tracking 'none' huruf kecil: reconcile.py
  // buang sentinel ikut padanan LITERAL sahaja, jadi 'none' KEKAL dikenali.
  ["TESTEDGE-LUARSKOP-SENTINEL", "DHL eCommerce", "none", 100.0],
  // 'NONE' huruf BESAR = sentinel literal, memang dibuang semua enjin.
  ["TESTEDGE-LUARSKOP-NONEBESAR", "DHL eCommerce", "NONE", 100.0],
  // Kawalan: tracking digit biasa, luar skop.
  ["TESTEDGE-LUARSKOP-DIGIT", "DHL eCommerce", "7730000001", 100.0],
  // Seri separuh sen, dalam skop jnt.
  ["TESTEDGE-BUNDAR-A", "J&T Express", "7720000001", 100.125],
  ["TESTEDGE-BUNDAR-B", "J&T Express", "7720000002", 100.125],
];

// (awb, cod_amount)
const LINES: [string, number][] = [
  ["none", 100.0],
  ["NONE", 100.0],
  ["7730000001", 100.0],
  ["7720000001", 100.13],
  ["7720000002", 100.12],
  ["7730000009", 100.0],   // tiada order langsung
];

// Kategori dijangka untuk stream jnt, dikunci pada AWB.
const JANGKA: Record<string, string> = {
  "none": "match_luar_skop",
  "NONE": "duit_hantu",
  "7730000001": "match_luar_skop",
  "7720000001": "tally",
  "7720000002": "amount_mismatch",
  "7730000009": "duit_hantu",
};

async function seed() {
  const p = getPool();
  await p.query(
    `INSERT INTO cod_bills (bill_id, courier, settlement_date, source_file, ingested_at)
     VALUES ($1, 'J&T Express', '2026-06-12', $2, $3)
     ON CONFLICT (bill_id) DO NOTHING`, [BILL, FILE, STAMP]);
  for (const [oid, prov, trk, price] of ORDERS) {
    await p.query(
      `INSERT INTO orders (order_id, order_date, status, seller_name, payment_method,
                           shipping_provider, tracking, selling_price, sales_commission,
                           item_count, source_file, ingested_at)
       VALUES ($1, '2026-06-10 10:00:00', 'Completed', 'TESTEDGE STOKIS', 'COD',
               $2, $3, $4, 0, 1, $5, $6)
       ON CONFLICT (order_id) DO NOTHING`, [oid, prov, trk, price, FILE, STAMP]);
  }
  for (const [awb, cod] of LINES) {
    await p.query(
      `INSERT INTO cod_bill_lines (awb, bill_id, cod_amount, fee, delivered_date,
                                   source_file, ingested_at)
       VALUES ($1, $2, $3, 1, '2026-06-11 10:00:00', $4, $5)
       ON CONFLICT (awb) DO NOTHING`, [awb, BILL, cod, FILE, STAMP]);
  }
}

async function cleanup() {
  const p = getPool();
  await p.query(`DELETE FROM cod_bill_lines WHERE source_file = $1`, [FILE]);
  await p.query(`DELETE FROM cod_bills WHERE source_file = $1`, [FILE]);
  await p.query(`DELETE FROM orders WHERE source_file = $1`, [FILE]);
}

async function main() {
  await cleanup();          // sisa run sebelum ni, kalau ada
  await seed();
  try {
    const s = await streamSummaryImpl("jnt");
    const byAwb = new Map<string, ExcRow>();
    for (const r of [...s.integ, ...s.aged]) {
      if (r.awb) byAwb.set(r.awb, r);
    }
    console.log("== kategori baris bil perangkap (stream jnt) ==");
    for (const [awb, jangka] of Object.entries(JANGKA)) {
      const got = byAwb.get(awb)?.kategori
        // 'tally' bukan exception, jadi ia tak keluar dalam integ/aged. Kalau
        // AWB tak muncul di mana mana senarai exception, ia memang tally.
        ?? "tally";
      ok(got === jangka, `awb ${awb}: jangka ${jangka}, dapat ${got}`);
    }
    // Penjaga tambahan: duit hantu mesti TEPAT dua baris perangkap kita
    // ('NONE' + '7730000009'), bukan tiga (bug lama tarik 'none' masuk sini).
    const hantu = [...byAwb.entries()].filter(
      ([, r]) => r.kategori === "duit_hantu" && r.tracking === null
        && ["none", "NONE", "7730000001", "7730000009"].includes(r.awb ?? ""));
    ok(hantu.length === 2, `duit_hantu antara AWB perangkap = 2 (dapat ${hantu.length})`);
  } finally {
    await cleanup();
    await getPool().end();
  }
  console.log(fail ? `\n${fail} semakan GAGAL` : "\nSEMUA LULUS");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
