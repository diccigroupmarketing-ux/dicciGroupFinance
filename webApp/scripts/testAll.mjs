// Runner satu-tekan semua suite webApp atas dev PG embedded (localhost:5433).
// Prasyarat: dev DB hidup -> `node scripts/devDb.mjs` (biar jalan di terminal lain).
//
// Guna:  npm test   (atau: node scripts/testAll.mjs)
//
// Aliran:
//   1. Restore bersih (loadDevDb) supaya mula dari data kenal.
//   2. Jana rujukan parity (parityDump -> scripts/parityPython.json).
//   3. Suite tak-memadam: parityCheck, testStockistDetail, testBank.
//   4. Suite memadam: restore, testMutations, restore, testUploads, restore akhir.
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
function run(label, cmd, args, opts = {}) {
  console.log(`\n>>> ${label}`);
  const stdout = opts.outFile ? openSync(opts.outFile, "w") : "inherit";
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? webApp,
    env: childEnv,
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
  // 1) Restore awal.
  record("restore (awal)", restore("awal"));

  // 2) Jana rujukan parity (stdout -> parityPython.json).
  record("parityDump", run("parityDump -> parityPython.json", "python3",
    ["scripts/parityDump.py"], { outFile: parityRef }));

  // 3) Suite tak-memadam.
  record("parityCheck", run("parityCheck", "npx", ["tsx", "scripts/parityCheck.ts"]));
  record("testStockistDetail", run("testStockistDetail", "npx", ["tsx", "scripts/testStockistDetail.ts"]));
  record("testBank", run("testBank", "npx", ["tsx", "scripts/testBank.ts"]));

  // 4) Suite memadam , restore sebelum & selepas.
  record("restore (pra-mutations)", restore("pra-mutations"));
  record("testMutations", run("testMutations", "npx", ["tsx", "scripts/testMutations.ts"]));
  record("restore (pra-uploads)", restore("pra-uploads"));
  record("testUploads", run("testUploads", "npx", ["tsx", "scripts/testUploads.ts"]));
  record("restore (akhir)", restore("akhir"));

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
