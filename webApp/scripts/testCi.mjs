// Runner SUBSET untuk CI (GitHub Actions). Jalankan HANYA langkah yang 100%
// sintetik, iaitu langkah yang boleh hidup atas runner awam tanpa data sebenar.
//
// Guna:  node scripts/testCi.mjs
//        (DATABASE_URL mesti tunjuk Postgres localhost yang SUDAH ada schema
//         db.init_db(); RECON_TODAY dikunci 2026-06-18 kalau tak diset.)
//
// KENAPA ADA RUNNER BERASINGAN (bukan flag pada testAll.mjs):
//   testAll.mjs ialah gate PENUH 21 langkah, banyak antaranya perlu snapshot
//   data SEBENAR (backups/ + parityHarness/data/ + data/baselineRecon.db) yang
//   SEMUA gitignored sebab repo ni PUBLIC. Kita SENGAJA tak sentuh testAll.mjs
//   supaya gate penuh lokal kekal utuh (satu sumber kebenaran, sifar risiko
//   pecah). Runner ni cuma pilih subset sintetik + cetak LEJAR JUJUR langkah
//   yang dilangkau, supaya hijau CI TIDAK boleh disalah baca sebagai "semua
//   ujian lulus". Kalau awak tambah/ubah langkah di testAll.mjs, semak sama ada
//   ia sintetik dan kemas kini senarai bawah.
//
// KEJUJURAN: langkah data-sebenar TIDAK dijalankan-lalu-lulus, ia disenaraikan
// sebagai SKIPPED dengan SEBAB tercetak terang. Bilangan run vs skip dicetak.
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
// sangka CI menguji segala galanya.
const SKIPPED = [
  ["restore (loadDevDb)", "perlu snapshot backups/ (data sebenar, gitignored)"],
  ["parityDump", "perlu snapshot backups/ (jana rujukan parity dari data sebenar)"],
  ["parityCheck", "perlu snapshot backups/ (banding E2 lwn E3 atas data sebenar)"],
  ["testStockistDetail", "perlu snapshot backups/ (order stokis sebenar)"],
  ["testBank", "perlu snapshot backups/ (deposit bank sebenar)"],
  ["testDateRange", "perlu snapshot backups/ (julat tarikh atas data sebenar)"],
  ["testUncollectedRange", "perlu snapshot backups/ (page Not collected atas data sebenar)"],
  ["testGifts", "perlu snapshot backups/ (order confirmed > 0 untuk cabang byGiftType bergigi)"],
  ["testMutations", "perlu snapshot backups/ + memadam (pin sku_bottles jangka 9)"],
  ["testUploads", "perlu snapshot backups/ + memadam (aliran upload atas data sebenar)"],
  ["testResolutions", "perlu snapshot backups/ + memadam (lapisan Resolution atas data sebenar)"],
  ["parityHarness (3 enjin)", "perlu parityHarness/data/fixture.db + data/baselineRecon.db (order sebenar, gitignored)"],
];

async function main() {
  console.log("=== SUBSET CI (langkah sintetik sahaja) ===");

  // --- Langkah TANPA DB (pure sintetik) ---
  record("check:engine", run("check:engine (salinan api/engine == root)",
    "node", ["scripts/checkEngineSync.mjs"]));
  record("checkReconConstants", run("checkReconConstants (konstan 3 enjin selaras)",
    "node", ["scripts/checkReconConstants.mjs"]));
  record("testReconEdgeCases.py", run("testReconEdgeCases.py (E1 lwn E2, fixture sqlite sendiri)",
    "python3", ["api/engine/tests/testReconEdgeCases.py"]));
  record("testIngestParsers.py", run("testIngestParsers.py (parser + guard, fixture sintetik)",
    "python3", ["api/engine/tests/testIngestParsers.py"]));

  // --- Langkah PERLU Postgres tapi SEED DATA SENDIRI (sintetik) ---
  // testReconEdgeCases.ts suntik baris perangkap sendiri dan buang balik; ia
  // cuma perlu SCHEMA (db.init_db) + Postgres kosong, BUKAN snapshot sebenar.
  record("testReconEdgeCases.ts", run("testReconEdgeCases.ts (E3 kes tepi, seed sendiri)",
    "npx", ["tsx", "scripts/testReconEdgeCases.ts"]));

  // --- Ringkasan JUJUR ---
  console.log("\n========== RINGKASAN CI ==========");
  let failed = 0;
  for (const { name, ok } of results) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`  ${results.length} langkah DIJALANKAN (sintetik)`);
  console.log("\n  DILANGKAU (perlu data sebenar, TIDAK diuji di CI):");
  for (const [name, why] of SKIPPED) {
    console.log(`  SKIP  ${name} , ${why}`);
  }
  console.log(`  ${SKIPPED.length} langkah DILANGKAU`);
  console.log("==================================");
  console.log(
    "PENTING: hijau CI = subset sintetik lulus, BUKAN suite penuh. Gate penuh " +
    "(npm test 21 langkah + parity 3 enjin + baseline) kekal manual di mesin " +
    "yang ada snapshot data sebenar.");
  console.log(failed ? `\n${failed} langkah CI GAGAL` : "\nSUBSET CI LULUS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
