// checkRawQueryRatchet.mjs , penjaga ratchet titik query mentah dalam webApp/lib.
//
// KENAPA ini wujud
// ----------------
// Keputusan architecture dikunci (satu gudang Neon, tangga 4 = RLS FORCE + wrapper
// withCompany + CI lint larang query mentah pada jadual tenant). Sebelum wrapper
// withCompany wujud, kita nak PAGAR supaya bilangan titik query mentah TAK MEMBESAR.
// Setiap query mentah baru = satu lagi tempat yang nanti kena tukar ke withCompany,
// dan satu lagi lubang bocor isolasi tenant kalau terlupa. Ratchet = injap sehala:
// kiraan boleh turun (bagus, kita ketatkan), tak boleh naik (merah).
//
// DEFINISI "titik query mentah" (deterministik, sengaja mudah)
// ------------------------------------------------------------
// Satu titik = satu kemunculan literal substring `.query(` dalam fail sumber.
// Titik ni ialah cara SEBENAR repo panggil DB: semua akses lalu node-postgres,
// sama ada pool.query(...), client.query(...), getPool().query(...), atau client
// yang dihantar sebagai argumen (c.query(...), p.query(...)). Repo ni TIDAK guna
// sql tagged template langsung (disahkan grep kosong), jadi `.query(` tangkap 100%
// titik DB.
//
// Kenapa kiraan lexical (bukan parse AST):
//   , DETERMINISTIK sepenuhnya, sifar kebergantungan, laju, senang baca dalam diff.
//   , KONSERVATIF: walaupun `.query(` muncul dalam komen atau string, ia tetap
//     dikira. Ini SENGAJA , awak tak boleh "sorok" query dengan komen kreatif,
//     dan kiraan tak pernah terlebih longgar. Kalau satu hari betul betul ada
//     `.query(` dalam komen yang sah, kemaskini baseline dengan sedar (itu memang
//     tujuan mekanisme ni: perubahan mesti disengajakan).
//   , TEGAR terhadap bait pelik. Skrip baca fail sebagai utf8 terus, jadi ia tak
//     terkelabu macam grep/`file` yang layan fail ada bait NUL sebagai "binari"
//     lalu langkau senyap (lihat nota dashboardRange bawah).
//
// Jumlah baseline = 203 titik dalam 14 fail lib. Inventori 31 Jul lapor 199 dalam
// 13 fail; beza 4 = dashboardRange.ts, yang inventori (berasas grep) TERLEPAS.
// Sebabnya: dashboardRange.ts ada SATU bait NUL sengaja (guna sebagai pemisah medan
// dalam template literal composite-key, `bucket` + NUL + `shipping_provider`), jadi
// util `file` klasifikasi fail tu "data" dan grep biasa layan ia binari lalu langkau
// senyap. 4 titik tu tulen (getPool().query + p.query tiga kali). Skrip ni kira
// betul sebab baca utf8. Angka deterministik 203 ni jadi baseline rasmi.
//
// BASELINE disimpan DALAM skrip ni (bukan fail config asing) supaya ia nampak terus
// dalam diff bila seseorang ubah. Fail lib yang TIADA dalam baseline dijangka SIFAR
// titik , kalau ada titik muncul, itu fail baru dengan query mentah = MERAH.
//
// KELAKUAN
//   , kiraan sesuatu fail MELEBIHI baseline  -> MERAH (exit 1), mesej jelas.
//   , fail BARU (tiada dalam baseline) ada titik -> MERAH (exit 1).
//   , kiraan MENGURANG bawah baseline -> HIJAU, tapi cetak NOTA suruh turunkan
//     baseline (ratchet mengetat, injap sehala).
//   , webApp/app/** ada `.query(` -> MERAH. Semua akses DB WAJIB lalu webApp/lib;
//     route dan komponen tak boleh sentuh DB mentah (disahkan kosong 31 Jul).
//
// Cara kemaskini baseline (bila memang perlu, dengan SEDAR): edit objek BASELINE
// bawah ni. Turun = sentiasa okay (dan digalak). Naik = hanya kalau betul betul
// perlu tambah query mentah SEBELUM withCompany siap; fikir dua kali, sebab tiap
// satu jadi hutang migrasi tangga 4.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, "..");
const libDir = join(webApp, "lib");
const appDir = join(webApp, "app");

// ---------------------------------------------------------------------------
// BASELINE , kiraan `.query(` per fail lib pada 2026-07-31 (jumlah 203).
// Fail lib yang tiada di sini dijangka SIFAR. Susun ikut kiraan menurun.
// ---------------------------------------------------------------------------
const BASELINE = {
  "recon.ts": 81,
  "mutations.ts": 41,
  "resolutions.ts": 29,
  "streamRange.ts": 12,
  "uncollectedRange.ts": 9,
  "uploadVouchSchema.ts": 6,
  "resolutionsSchema.ts": 6,
  "dashboardRange.ts": 4,
  "bank.ts": 4,
  "orderUploadsSchema.ts": 3,
  "audit.ts": 3,
  "giftsSchema.ts": 2,
  "billConflictsSchema.ts": 2,
  "closePack.ts": 1,
};

const NEEDLE = ".query(";

// Kira kemunculan literal NEEDLE dalam satu fail (deterministik, tak overlap).
function countPoints(filePath) {
  const text = readFileSync(filePath, "utf8");
  let n = 0;
  let i = text.indexOf(NEEDLE);
  while (i !== -1) {
    n++;
    i = text.indexOf(NEEDLE, i + NEEDLE.length);
  }
  return n;
}

// Senarai fail .ts terus dalam lib (bukan rekursif, lib rata).
function libTsFiles() {
  return readdirSync(libDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
}

// Jalan rekursif kumpul .ts/.tsx dalam app/ (kecuali node_modules, .next).
function walkTsx(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // app/ mungkin tiada dalam sesetengah konteks, layan kosong.
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsx(full, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function main() {
  const problems = []; // mesej MERAH
  const loosenable = []; // nota HIJAU (baseline boleh turun)

  // --- 1) lib/*.ts lawan baseline ---
  const seen = new Set();
  for (const f of libTsFiles()) {
    const count = countPoints(join(libDir, f));
    const base = BASELINE[f] ?? 0;
    seen.add(f);
    if (count > base) {
      if (base === 0) {
        problems.push(
          `  ${f}: ${count} titik query mentah (fail ni TIADA dalam baseline, dijangka 0).\n` +
          `     Query mentah baru dikesan. Guna corak sedia ada dalam lib dulu; wrapper\n` +
          `     withCompany datang di tangga 4. Kalau memang perlu, tambah "${f}": ${count}\n` +
          `     ke BASELINE dalam checkRawQueryRatchet.mjs dengan SEDAR.`,
        );
      } else {
        problems.push(
          `  ${f}: ${count} titik query mentah, baseline ${base} (lebih ${count - base}).\n` +
          `     Query mentah baru dalam ${f}, guna corak sedia ada dulu, wrapper\n` +
          `     withCompany datang di tangga 4. Kalau memang perlu, kemaskini baseline\n` +
          `     dengan SEDAR dalam checkRawQueryRatchet.mjs ("${f}": ${count}).`,
        );
      }
    } else if (count < base) {
      loosenable.push(`  ${f}: ${count} titik (baseline ${base}). Turunkan baseline ke ${count} , ratchet ketat.`);
    }
  }

  // Fail dalam baseline tapi hilang dari lib (rename/padam) , beritahu supaya baseline bersih.
  for (const f of Object.keys(BASELINE)) {
    if (!seen.has(f)) {
      loosenable.push(`  ${f}: tiada lagi dalam lib/ (baseline ${BASELINE[f]}). Buang entri ni dari BASELINE.`);
    }
  }

  // --- 2) app/** mesti SIFAR ---
  const appHits = [];
  for (const file of walkTsx(appDir)) {
    const count = countPoints(file);
    if (count > 0) appHits.push(`${relative(webApp, file)}: ${count} titik`);
  }
  if (appHits.length) {
    problems.push(
      "  Query mentah dikesan DI LUAR lib (app/**), sepatutnya SIFAR:\n" +
      appHits.map((h) => "     " + h).join("\n") +
      "\n     Semua akses DB WAJIB lalu webApp/lib. Pindah query ni ke fungsi dalam lib.",
    );
  }

  // --- 3) Ringkasan ---
  const total = libTsFiles().reduce((s, f) => s + countPoints(join(libDir, f)), 0);
  console.log(`checkRawQueryRatchet: ${total} titik query mentah dalam webApp/lib (baseline jumlah 203).`);

  if (loosenable.length) {
    console.log("\nNOTA (ratchet boleh ketat lagi, kiraan turun bawah baseline):");
    for (const n of loosenable) console.log(n);
    console.log("  Kemaskini BASELINE turun dalam checkRawQueryRatchet.mjs bila senggang.");
  }

  if (problems.length) {
    console.error("\nMERAH , titik query mentah membesar (atau bocor luar lib):");
    for (const p of problems) console.error(p);
    console.error("\nRatchet ialah injap sehala: kiraan tak boleh naik sebelum withCompany siap.");
    process.exit(1);
  }

  console.log("HIJAU , tiada query mentah baru. Ratchet dipegang.");
  process.exit(0);
}

main();
