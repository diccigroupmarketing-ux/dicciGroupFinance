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
import { streamSummaryImpl, CONF_SQL, type ExcRow } from "../lib/recon";
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

// Tarikh order lalai: 8 hari sebelum reconToday (2026-06-18) = masih "muda".
const DATE_MUDA = "2026-06-10 10:00:00";
// Jauh melepasi ambang 14 hari = jatuh baldi aging (hilang_lewat).
const DATE_TUA = "2026-04-01 10:00:00";

// (order_id, provider, tracking, selling_price, order_date) , semua COD, Completed.
const ORDERS: [string, string, string, number, string][] = [
  // Order LUAR SKOP jnt (naik DHL). Tracking 'none' huruf kecil: reconcile.py
  // buang sentinel ikut padanan LITERAL sahaja, jadi 'none' KEKAL dikenali.
  ["TESTEDGE-LUARSKOP-SENTINEL", "DHL eCommerce", "none", 100.0, DATE_MUDA],
  // 'NONE' huruf BESAR = sentinel literal, memang dibuang semua enjin.
  ["TESTEDGE-LUARSKOP-NONEBESAR", "DHL eCommerce", "NONE", 100.0, DATE_MUDA],
  // Kawalan: tracking digit biasa, luar skop.
  ["TESTEDGE-LUARSKOP-DIGIT", "DHL eCommerce", "7730000001", 100.0, DATE_MUDA],
  // Seri separuh sen, dalam skop jnt.
  ["TESTEDGE-BUNDAR-A", "J&T Express", "7720000001", 100.125, DATE_MUDA],
  ["TESTEDGE-BUNDAR-B", "J&T Express", "7720000002", 100.125, DATE_MUDA],
  // Baris bil RM0 (contoh caj Returned to Sender Ninja Van) BUKAN bukti duit
  // masuk. Order TUA supaya jawapan betulnya jatuh dalam baldi aging, iaitu
  // tepat baldi yang bug lama sorokkan. Sebelum fix: 'amount_mismatch'.
  ["TESTEDGE-RM0-TUA", "J&T Express", "7770000002", 150.0, DATE_TUA],
  // Kawalan arah bertentangan: 1 sen tetap duit, mesti kekal tally.
  ["TESTEDGE-RM0-KAWALAN-SEN", "J&T Express", "7770000008", 0.01, DATE_TUA],
];

// (awb, cod_amount)
const LINES: [string, number][] = [
  ["none", 100.0],
  ["NONE", 100.0],
  ["7730000001", 100.0],
  ["7720000001", 100.13],
  ["7720000002", 100.12],
  ["7730000009", 100.0],   // tiada order langsung
  ["7770000002", 0.0],     // RM0 = sifar duit masuk
  ["7770000008", 0.01],    // kawalan
];

// Kategori dijangka untuk stream jnt, dikunci pada AWB.
const JANGKA: Record<string, string> = {
  "none": "match_luar_skop",
  "NONE": "duit_hantu",
  "7730000001": "match_luar_skop",
  "7720000001": "tally",
  "7720000002": "amount_mismatch",
  "7730000009": "duit_hantu",
  // Order jatuh BALIK ke kategori ikut aging, sama macam order tanpa bil.
  "7770000002": "hilang_lewat",
  "7770000008": "tally",
};

// order_id -> adakah CONF_SQL (titik "duit disahkan" untuk botol + baldi
// confirmed) sepatutnya kira order ni sebagai duit masuk.
const JANGKA_CONF: Record<string, boolean> = {
  "TESTEDGE-RM0-TUA": false,
  "TESTEDGE-RM0-KAWALAN-SEN": true,
  "TESTEDGE-BUNDAR-A": true,
};

async function seed() {
  const p = getPool();
  await p.query(
    `INSERT INTO cod_bills (bill_id, courier, settlement_date, source_file, ingested_at)
     VALUES ($1, 'J&T Express', '2026-06-12', $2, $3)
     ON CONFLICT (bill_id) DO NOTHING`, [BILL, FILE, STAMP]);
  for (const [oid, prov, trk, price, odate] of ORDERS) {
    await p.query(
      `INSERT INTO orders (order_id, order_date, status, seller_name, payment_method,
                           shipping_provider, tracking, selling_price, sales_commission,
                           item_count, source_file, ingested_at)
       VALUES ($1, $7, 'Completed', 'TESTEDGE STOKIS', 'COD',
               $2, $3, $4, 0, 1, $5, $6)
       ON CONFLICT (order_id) DO NOTHING`, [oid, prov, trk, price, FILE, STAMP, odate]);
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

    // CONF_SQL = titik "duit disahkan" (botol dikira, baldi confirmed). Baris
    // bil RM0 tak boleh mengesahkan order , kalau ia boleh, botol order yang
    // duitnya tak pernah masuk akan dikira sebagai jualan sah.
    console.log("== duit disahkan (CONF_SQL) ==");
    const conf = await getPool().query(
      `SELECT o.order_id, ${CONF_SQL.trim()} AS conf FROM orders o WHERE o.source_file = $1`,
      [FILE]);
    const confBy = new Map<string, number>(
      conf.rows.map((r) => [r.order_id as string, Number(r.conf)]));
    for (const [oid, jangka] of Object.entries(JANGKA_CONF)) {
      const got = confBy.get(oid);
      ok(got === (jangka ? 1 : 0),
        `order ${oid}: duit disahkan jangka ${jangka}, dapat ${got === 1}`);
    }
  } finally {
    await cleanup();
    await getPool().end();
  }
  console.log(fail ? `\n${fail} semakan GAGAL` : "\nSEMUA LULUS");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
