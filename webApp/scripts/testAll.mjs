// Runner satu-tekan semua suite webApp atas dev PG embedded (localhost:5433).
// Prasyarat: dev DB hidup -> `node scripts/devDb.mjs` (biar jalan di terminal lain).
//
// Guna:  npm test   (atau: node scripts/testAll.mjs)
//
// Aliran:
//   0. Gate murah tanpa dev PG: check:engine + dua suite Python (fixture sendiri).
//   1. Restore bersih (loadDevDb) supaya mula dari data kenal.
//   2. Jana rujukan parity (parityDump -> scripts/parityPython.json).
//   3. Suite tak-memadam: parityCheck, testStockistDetail, testBank,
//      testReconEdgeCases.ts + testGifts (suntik+buang perangkap sendiri).
//   4. Suite memadam: restore, testMutations, restore, testUploads, restore,
//      testResolutions, restore akhir.
//   5. Ringkasan PASS/FAIL; exit 1 kalau mana mana suite ATAU restore gagal.
//
// NOTA restore (deviasi dari resipi asal): restore = loadDevDb.py SAHAJA.
// backfillAutoSkus.py SENGAJA tak dijalankan , snapshot backup semasa ada 16 SKU
// belum-map, jadi backfill naikkan sku_bottles 9 -> 25 dan pecahkan baseline
// testMutations (jangka 9). Tiada suite perlukan backfill untuk betul (parity
// banding TS lwn PY atas DB SAMA, jadi map SKU tak kesan persetujuan enjin).
import { spawnSync } from "node:child_process";
import { existsSync, openSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, "..");

// Lapisan guard tambahan: paksa DATABASE_URL ke dev PG lokal untuk SEMUA child.
// Guard localhost dalam tiap suite kekal sebagai pertahanan kedua.
const DEV_DB = "postgresql://dev:dev@localhost:5433/dicci";
// RECON_TODAY kunci tarikh aging enjin Python (db.py default = tarikh SEBENAR hari
// ini) supaya selari dengan recon.ts yang pin TODAY = 2026-06-18. Tanpa ni,
// parityDump jana rujukan aging beza dan parityCheck GAGAL palsu.
const childEnv = { ...process.env, DATABASE_URL: DEV_DB, RECON_TODAY: "2026-06-18" };

const parityRef = join(here, "parityPython.json");
const loadDev = join(here, "loadDevDb.py");

// Sahkan skrip restore wujud sebelum bergantung padanya.
if (!existsSync(loadDev)) {
  console.error(`SETUP GAGAL: loadDevDb.py tak dijumpai di ${loadDev}`);
  process.exit(1);
}

// Jalankan satu command; pulang true kalau exit 0. `outFile` (optional) tangkap stdout.
// `opts.env` (optional) = medan tambahan yang menang atas childEnv untuk langkah ni sahaja.
function run(label, cmd, args, opts = {}) {
  console.log(`\n>>> ${label}`);
  const stdout = opts.outFile ? openSync(opts.outFile, "w") : "inherit";
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? webApp,
    env: opts.env ? { ...childEnv, ...opts.env } : childEnv,
    stdio: ["inherit", stdout, "inherit"],
  });
  if (opts.outFile) closeSync(stdout);
  const ok = res.status === 0;
  if (res.error) console.error(`  ralat spawn: ${res.error.message}`);
  console.log(ok ? `<<< ${label}: OK` : `<<< ${label}: GAGAL (exit ${res.status})`);
  return ok;
}

// Restore bersih = loadDevDb.py sahaja (lihat NOTA restore di atas).
function restore(tag) {
  return run(`restore (${tag}) , loadDevDb`, "python3", ["scripts/loadDevDb.py"]);
}

const results = [];
const record = (name, ok) => { results.push({ name, ok }); return ok; };

async function main() {
  // 0) Gate drift enjin (tanpa DB, murah): salinan api/engine mesti identik
  //    dengan rujukan root. Tangkap kes lupa selaras SEBELUM suite lain jalan.
  record("check:engine", run("check:engine", "node", ["scripts/checkEngineSync.mjs"]));

  // 0a) Gate drift KONSTAN recon merentas 3 enjin (tanpa DB, murah): konstan
  //     kategori di recon.ts (salinan) mesti sama nilai dengan sumber kebenaran
  //     Python (db.py / reconcile.py / theme.py), dan senarai status prepaid SQL
  //     di reconSql + recon.ts mesti sama db.PREPAID_SUCCESS_STATUS. Tangkap kes
  //     satu enjin ubah konstan tanpa yang lain.
  record("checkReconConstants", run("checkReconConstants",
    "node", ["scripts/checkReconConstants.mjs"]));

  // 0a2) Ratchet titik query mentah (tanpa DB, murah): bilangan `.query(` dalam
  //      webApp/lib TAK boleh membesar melebihi baseline, dan app/** mesti kekal
  //      SIFAR. Injap sehala sebelum wrapper withCompany (tangga 4) wujud , tiap
  //      query mentah baru = hutang migrasi + risiko bocor isolasi tenant.
  record("checkRawQueryRatchet", run("checkRawQueryRatchet",
    "node", ["scripts/checkRawQueryRatchet.mjs"]));

  // 0b) Suite Python murni (fixture sendiri, TAK sentuh dev PG walaupun
  //     DATABASE_URL dipaksa di atas , dua duanya bina engine sqlite sendiri).
  //     testReconEdgeCases banding reconcile.py (RUJUKAN KEBENARAN) lawan
  //     reconSql.py baris demi baris atas kes tepi duit; ia satu satunya gate
  //     yang menyentuh reconcile.py, jadi ia jalan AWAL.
  record("testReconEdgeCases.py", run("testReconEdgeCases.py (E1 lwn E2)",
    "python3", ["api/engine/tests/testReconEdgeCases.py"]));
  record("testIngestParsers.py", run("testIngestParsers.py (parser + guard)",
    "python3", ["api/engine/tests/testIngestParsers.py"]));

  // 1) Restore awal.
  record("restore (awal)", restore("awal"));

  // 2) Jana rujukan parity (stdout -> parityPython.json).
  record("parityDump", run("parityDump -> parityPython.json", "python3",
    ["scripts/parityDump.py"], { outFile: parityRef }));

  // 3) Suite tak-memadam.
  record("parityCheck", run("parityCheck", "npx", ["tsx", "scripts/parityCheck.ts"]));
  record("testStockistDetail", run("testStockistDetail", "npx", ["tsx", "scripts/testStockistDetail.ts"]));
  record("testBank", run("testBank", "npx", ["tsx", "scripts/testBank.ts"]));
  // Lapisan tapis julat tarikh (read-only): ujian tulen + bukti All time = output
  // enjin. Tak menulis apa apa ke DB.
  record("testDateRange", run("testDateRange", "npx", ["tsx", "scripts/testDateRange.ts"]));
  // Lapisan tapis julat tarikh untuk page Not collected (read-only, sama corak).
  record("testUncollectedRange", run("testUncollectedRange",
    "npx", ["tsx", "scripts/testUncollectedRange.ts"]));

  // 3b) Kes tepi enjin TS: suntik baris perangkap, semak kategori, buang balik.
  //     Ia bersihkan sendiri, tapi kita restore selepasnya sebagai jaring.
  record("testReconEdgeCases.ts", run("testReconEdgeCases.ts (E3 kes tepi)",
    "npx", ["tsx", "scripts/testReconEdgeCases.ts"]));

  // 3c) Invariant free gift: sifar fan-out botol + kos derive lawan oracle bebas.
  //     Ia MENULIS (backfill sku_bottles bertanda, seed sku_gifts, satu baris
  //     cod_bill_lines sintetik) tapi pulih sendiri dalam finally dan mengesahkan
  //     pemulihan tu dengan assert. Duduk di sini, sebelum restore (pra-mutations),
  //     supaya restore tu jadi jaring , penting sebab testMutations pin
  //     `sku_bottles jangka 9`.
  record("testGifts", run("testGifts", "npx", ["tsx", "scripts/testGifts.ts"]));

  // 4) Suite memadam , restore sebelum & selepas.
  record("restore (pra-mutations)", restore("pra-mutations"));
  record("testMutations", run("testMutations", "npx", ["tsx", "scripts/testMutations.ts"]));
  record("restore (pra-uploads)", restore("pra-uploads"));
  record("testUploads", run("testUploads", "npx", ["tsx", "scripts/testUploads.ts"]));
  // Lapisan Resolution: menulis ke recon_resolutions dan mengubah SEMENTARA satu
  // selling_price (untuk buktikan kes jadi stale), jadi ia duduk dalam kumpulan
  // memadam dengan restore sebelum dan selepas.
  record("restore (pra-resolutions)", restore("pra-resolutions"));
  record("testResolutions", run("testResolutions", "npx", ["tsx", "scripts/testResolutions.ts"]));
  record("restore (akhir)", restore("akhir"));

  // 4b) Parity 3 enjin , LANGKAH AKHIR sengaja.
  //     Ni gate paling BERAT dalam suite: ia bina db Postgres BERASINGAN
  //     (parity_tapak), muat fixture, jana mirror recon.ts, lepas tu dump E1
  //     (reconcile.py sqlite) + E2 sqlite + E2 postgres + E3 (recon.ts) dan
  //     banding kategori tiap order baris demi baris. Sebab ia komposit (banyak
  //     proses anak) ia makan masa lebih dari langkah lain, jadi diletak PALING
  //     akhir dan masa lariannya dicatat.
  //
  //     RECON_TODAY dipaksa DI SINI (bukan harap env luaran). jalan.sh ada
  //     default sama, ni jaring kedua supaya langkah tetap deterministik walau
  //     dipanggil dari persekitaran yang berbeza.
  //
  //     Data fixture (parityHarness/data/fixture.db) dan baseline suci
  //     (data/baselineRecon.db) dua duanya GITIGNORED sebab mengandungi order
  //     SEBENAR (repo public). Pada mesin baru clone ia TIADA. Bila tiada,
  //     langkah ni GAGAL KUAT dengan arahan pulih , BUKAN skip senyap dan BUKAN
  //     lulus senyap , supaya penggera parity tak boleh mati diam diam.
  {
    const root = join(webApp, "..");
    const fixture = join(root, "parityHarness", "data", "fixture.db");
    const baseline = join(root, "data", "baselineRecon.db");
    const missing = [];
    if (!existsSync(fixture)) missing.push(fixture);
    if (!existsSync(baseline)) missing.push(baseline);
    if (missing.length) {
      console.log("\n>>> parityHarness (3 enjin)");
      console.error(
        "SETUP GAGAL: data harness parity tiada (GITIGNORED, order sebenar):\n" +
        missing.map((m) => `  , ${m}`).join("\n") +
        "\nCara pulih (rujuk parityHarness/README.md seksyen \"Fixture datang dari mana\"):\n" +
        "  1. data/baselineRecon.db : pulih dari backup projek, atau python3 syncFromNeon.py\n" +
        "  2. parityHarness/data/fixture.db : cp data/baselineRecon.db parityHarness/data/fixture.db\n" +
        "Langkah ni SENGAJA dikira GAGAL (bukan skip) supaya penggera parity 3 enjin tak senyap.");
      console.log("<<< parityHarness (3 enjin): GAGAL (data setup tiada)");
      record("parityHarness", false);
    } else {
      const t0 = Date.now();
      const ok = run("parityHarness (3 enjin)", "bash", ["parityHarness/jalan.sh"],
        { cwd: root, env: { RECON_TODAY: "2026-06-18" } });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`    (parityHarness masa larian: ${secs}s)`);
      record("parityHarness", ok);
    }
  }

  // 5) Ringkasan.
  console.log("\n========== RINGKASAN ==========");
  let failed = 0;
  for (const { name, ok } of results) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }
  console.log("===============================");
  console.log(failed ? `${failed} langkah GAGAL` : "SEMUA LULUS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
