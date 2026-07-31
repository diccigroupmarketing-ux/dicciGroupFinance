// Runner SUBSET untuk CI (GitHub Actions). Jalankan HANYA langkah yang boleh
// hidup atas runner awam TANPA snapshot data sebenar, iaitu sama ada (a) tulen
// sintetik tanpa DB, atau (b) perlu Postgres tapi SEED DATA SENDIRI (fixture
// sintetik / baris perangkap).
//
// Guna:  node scripts/testCi.mjs
//        (DATABASE_URL mesti tunjuk Postgres localhost yang SUDAH ada schema
//         db.init_db(); RECON_TODAY dikunci 2026-06-18 kalau tak diset.)
//
// KENAPA ADA RUNNER BERASINGAN (bukan flag pada testAll.mjs):
//   testAll.mjs ialah gate PENUH 22 langkah, sebahagiannya perlu snapshot data
//   SEBENAR (backups/ + parityHarness/data/ + data/baselineRecon.db) yang SEMUA
//   gitignored sebab repo ni PUBLIC. Kita SENGAJA tak sentuh testAll.mjs supaya
//   gate penuh lokal kekal utuh (satu sumber kebenaran, sifar risiko pecah).
//   Runner ni pilih subset yang boleh disintetikkan + cetak LEJAR JUJUR langkah
//   yang dilangkau, supaya hijau CI TIDAK boleh disalah baca sebagai "semua
//   ujian lulus". Kalau awak tambah/ubah langkah di testAll.mjs, semak sama ada
//   ia boleh disintetikkan dan kemas kini senarai bawah.
//
// SEGI TIGA PARITY DI CI (kenapa E2 vs E3 kini disintetikkan):
//   E1 (reconcile.py) vs E2 (reconSql.py) : testGoldenParity.py (fixture sqlite).
//   E2 (reconSql.py)  vs E3 (recon.ts)    : seedGoldenPg.py muat fixture emas
//     SAMA ke Postgres, lepas tu parityDump + parityCheck banding baris demi baris.
//   Dua duanya guna genGoldenFixture (data rekaan yang cetus SEMUA 15 kategori),
//   jadi enjin recon kini diperiksa hujung ke hujung di CI tanpa data sebenar.
//   Yang KEKAL manual ialah parity 3 enjin atas fixture DATA SEBENAR (parityHarness).
//
// KEJUJURAN: langkah yang betul betul perlu snapshot data sebenar TIDAK
// dijalankan-lalu-lulus, ia disenaraikan sebagai SKIPPED dengan SEBAB tercetak
// terang. Bilangan run vs skip dicetak.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, "..");

const DEV_DB = process.env.DATABASE_URL ?? "postgresql://dev:dev@localhost:5433/dicci";
// RECON_TODAY kunci tarikh aging enjin supaya kes tepi tarikh deterministik
// (sama sebab macam testAll.mjs). Hormat env sedia ada.
const childEnv = { ...process.env, DATABASE_URL: DEV_DB, RECON_TODAY: process.env.RECON_TODAY ?? "2026-06-18" };

// Jalankan satu command; pulang true kalau exit 0.
function run(label, cmd, args) {
  console.log(`\n>>> ${label}`);
  const res = spawnSync(cmd, args, { cwd: webApp, env: childEnv, stdio: "inherit" });
  const ok = res.status === 0;
  if (res.error) console.error(`  ralat spawn: ${res.error.message}`);
  console.log(ok ? `<<< ${label}: OK` : `<<< ${label}: GAGAL (exit ${res.status})`);
  return ok;
}

const results = [];
const record = (name, ok) => { results.push({ name, ok }); return ok; };

// LEJAR langkah testAll.mjs yang TIDAK boleh jalan di CI, dengan sebab. Ini
// bukan dekorasi: ia yang buat hijau CI jujur. Kalau nampak senyap, orang akan
// sangka CI menguji segala galanya. Semua yang tinggal di sini betul betul
// perlu snapshot data SEBENAR (order/deposit/upload sebenar) atau MEMADAM +
// pin nombor yang hanya bermakna atas snapshot tu.
const SKIPPED = [
  ["restore (loadDevDb, backup sebenar)", "CI ganti dengan seedGoldenPg (fixture emas SINTETIK); restore snapshot backup SEBENAR tak dijalankan (gitignored)"],
  ["testGifts", "perlu snapshot backups/ (order confirmed > 0 + SKU dipetakan untuk cabang byGiftType bergigi; golden takde order_skus)"],
  ["testMutations", "perlu snapshot backups/ + memadam (pin sku_bottles jangka 9 atas data sebenar)"],
  ["testUploads", "perlu snapshot backups/ + memadam (aliran upload atas data sebenar)"],
  ["testResolutions", "perlu snapshot backups/ + memadam (lapisan Resolution atas data sebenar)"],
  ["parityHarness (3 enjin, fixture SEBENAR)", "perlu parityHarness/data/fixture.db + data/baselineRecon.db (order sebenar, gitignored). NOTA: parity enjin SUDAH dicover sintetik di CI, E1 vs E2 (testGoldenParity) + E2 vs E3 (parityCheck atas golden); yang tinggal cuma parity atas fixture DATA SEBENAR"],
];

async function main() {
  console.log("=== SUBSET CI (langkah sintetik + seed sendiri) ===");

  // --- Langkah TULEN sintetik (tiada DB) ---
  record("check:engine", run("check:engine (salinan api/engine == root)",
    "node", ["scripts/checkEngineSync.mjs"]));
  record("checkReconConstants", run("checkReconConstants (konstan 3 enjin selaras)",
    "node", ["scripts/checkReconConstants.mjs"]));
  // Ratchet titik query mentah: baca fail sumber webApp/lib sahaja, tiada DB.
  // Injap sehala supaya query mentah tak membiak sebelum wrapper withCompany.
  record("checkRawQueryRatchet", run("checkRawQueryRatchet (injap query mentah, sumber sahaja)",
    "node", ["scripts/checkRawQueryRatchet.mjs"]));
  // Semakan jenis TypeScript penuh (tsc --noEmit). typescript ada dalam
  // devDependencies dan npm ci pasang dev deps secara lalai, jadi ia tersedia
  // di runner. Tulen sintetik: tiada DB, tiada data, cuma analisa statik.
  record("tsc --noEmit", run("tsc --noEmit (semakan jenis TypeScript)",
    "npx", ["tsc", "--noEmit"]));
  record("testReconEdgeCases.py", run("testReconEdgeCases.py (E1 lwn E2, fixture sqlite sendiri)",
    "python3", ["api/engine/tests/testReconEdgeCases.py"]));
  record("testIngestParsers.py", run("testIngestParsers.py (parser + guard, fixture sintetik)",
    "python3", ["api/engine/tests/testIngestParsers.py"]));
  // Mini-parity golden: fixture sintetik yang cetus SEMUA 15 kategori recon,
  // E1 lawan E2 baris demi baris + assert liputan (fixture reput senyap = merah).
  // Bina DB sqlite sendiri dalam tempdir, tiada data sebenar, tiada Postgres.
  record("testGoldenParity.py", run("testGoldenParity.py (E1 lwn E2 + liputan 15 kategori)",
    "python3", ["scripts/testGoldenParity.py"]));

  // --- Langkah PERLU Postgres tapi SEED DATA SENDIRI (sintetik) ---
  // testReconEdgeCases.ts suntik baris perangkap sendiri dan buang balik; ia
  // cuma perlu SCHEMA (db.init_db) + Postgres kosong, BUKAN snapshot sebenar.
  // Dijalankan SEBELUM seed golden supaya ia lihat DB bersih (macam CI asal).
  record("testReconEdgeCases.ts", run("testReconEdgeCases.ts (E3 kes tepi, seed sendiri)",
    "npx", ["tsx", "scripts/testReconEdgeCases.ts"]));

  // --- Blok golden-PG: muat fixture emas SINTETIK ke Postgres, lepas tu jalan
  //     parity E2 vs E3 + smoke enjin/lapisan yang read-only atas data tu.
  //     Seed = DELETE + INSERT (idempotent). Semua langkah bawah baca DB SAMA.
  const seeded = record("seedGoldenPg", run("seedGoldenPg (muat fixture emas ke Postgres)",
    "python3", ["scripts/seedGoldenPg.py"]));
  if (seeded) {
    // parityDump jana rujukan E2 (reconSql.py) -> parityPython.json (gitignored),
    // parityCheck banding E3 (recon.ts) lawan rujukan tu baris demi baris.
    // Bersama = gate parity E2 vs E3 atas data yang cetus SEMUA kategori.
    record("parityDump", run("parityDump -> parityPython.json (E2 golden)",
      "sh", ["-c", "python3 scripts/parityDump.py > scripts/parityPython.json"]));
    record("parityCheck", run("parityCheck (E3 recon.ts lwn E2, golden)",
      "npx", ["tsx", "scripts/parityCheck.ts"]));
    // Smoke + invariant recon.ts drill stokis (read-only atas golden).
    record("testStockistDetail", run("testStockistDetail (invariant drill stokis, golden)",
      "npx", ["tsx", "scripts/testStockistDetail.ts"]));
    // Lapisan bank CRUD (self-clean atas golden: guna bil golden, padam balik).
    record("testBank", run("testBank (lapisan bank, golden)",
      "npx", ["tsx", "scripts/testBank.ts"]));
    // Lapisan tapis julat tarikh: bukti aggregate ALL_TIME == output enjin
    // (invariant, read-only + rollback). Golden cetus overdue/awaiting/ghost.
    record("testDateRange", run("testDateRange (lapisan tapis tarikh, golden)",
      "npx", ["tsx", "scripts/testDateRange.ts"]));
    record("testUncollectedRange", run("testUncollectedRange (tapis tarikh Not collected, golden)",
      "npx", ["tsx", "scripts/testUncollectedRange.ts"]));
  } else {
    // Seed gagal = semua langkah golden-PG bergantung padanya tak boleh dipercayai.
    console.error("  seedGoldenPg GAGAL: langkah golden-PG (parity/smoke) dilangkau, dikira GAGAL.");
    for (const n of ["parityDump", "parityCheck", "testStockistDetail", "testBank",
      "testDateRange", "testUncollectedRange"]) {
      record(n, false);
    }
  }

  // --- Ringkasan JUJUR ---
  console.log("\n========== RINGKASAN CI ==========");
  let failed = 0;
  for (const { name, ok } of results) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`  ${results.length} langkah DIJALANKAN (sintetik + seed sendiri)`);
  console.log("\n  DILANGKAU (perlu data sebenar, TIDAK diuji di CI):");
  for (const [name, why] of SKIPPED) {
    console.log(`  SKIP  ${name} , ${why}`);
  }
  console.log(`  ${SKIPPED.length} langkah DILANGKAU`);
  console.log("==================================");
  console.log(
    "PENTING: hijau CI = subset sintetik lulus, BUKAN suite penuh. Gate penuh " +
    "(npm test 22 langkah + parity 3 enjin atas fixture SEBENAR + baseline) kekal " +
    "manual di mesin yang ada snapshot data sebenar.");
  console.log(failed ? `\n${failed} langkah CI GAGAL` : "\nSUBSET CI LULUS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
