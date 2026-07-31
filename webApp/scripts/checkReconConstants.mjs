// Guard konstan kategori recon merentas enjin , FASA 2 (dijana, bukan lagi
// "menjerit sahaja").
//
// Sejarah ringkas: dulu recon.ts simpan SALINAN literal konstan kategori dan
// skrip ni cuma MENJERIT bila salinan tu lari dari Python. Sekarang konstan TS
// DIJANA dari Python ke lib/reconConstants.ts (scripts/genReconConstants.mjs) dan
// recon.ts IMPORT dari situ. Peranan guard bertukar jadi TIGA soalan:
//
//   1. FAIL DIJANA SEGAR: lib/reconConstants.ts yang di-commit mesti BYTE IDENTIK
//      dengan render segar dari Python. Kalau db.py/reconcile.py/theme.py berubah
//      tapi fail dijana tak dijana semula + commit, ini MERAH (macam checkEngineSync
//      untuk salinan api/engine).
//   2. recon.ts BENAR-BENAR IMPORT dari ./reconConstants (5 konstan) dan TIADA
//      literal lama tertinggal (tiada `const COD_VALUES = [...]` dsb).
//   3. Enjin Python kedua (reconSql.py, BEKU) masih import konstan dari db/reconcile
//      dan senarai status prepaid SQL-nya (_PREPAID_OK) masih sama db.PREPAID_SUCCESS_STATUS.
//
// Guna:  node scripts/checkReconConstants.mjs
// Exit 0 = selaras. Exit != 0 = drift ATAU format tak boleh diparse (GAGAL KUAT,
// bukan lulus senyap , penggera mati tanpa sesiapa tahu = haram).
//
// Bila root TIADA (konteks build webApp sahaja) skrip SKIP dengan jujur: sumber
// Python + reconSql.py tak hadir untuk dibanding. Fail dijana + recon.ts yang
// di-commit sudah disahkan masa commit (npm test jalankan guard ni dengan root).
import { readFileSync } from "node:fs";
import {
  PATHS, rootPresent, renderFromPython, extractConstants,
} from "./genReconConstants.mjs";

// ---- Skip jujur bila root (sumber Python) tak hadir. ----
if (!rootPresent()) {
  console.log("check konstan dilangkau (root repo tak hadir dalam konteks ni).");
  process.exit(0);
}

let fail = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "OK  " : "DRIFT"}  ${label}`);
  if (!ok) {
    fail++;
    if (detail) console.error(`         ${detail}`);
  }
}
function must(fn, label) {
  try {
    return fn();
  } catch (e) {
    console.error(`  GAGAL PARSE  ${label}: ${e.message}`);
    fail++;
    return null;
  }
}

console.log("Guard konstan recon (fasa 2, dijana):");

// ====================================================================
// 1. Fail dijana SEGAR: render dari Python == fail commit, byte demi byte.
// ====================================================================
{
  const fresh = must(() => renderFromPython(), "render dari Python");
  let onDisk = null;
  try {
    onDisk = readFileSync(PATHS.generated, "utf8");
  } catch {
    console.error(`  MISSING  lib/reconConstants.ts tak dijumpai: ${PATHS.generated}`);
    fail++;
  }
  if (fresh != null && onDisk != null) {
    check("reconConstants.ts segar (byte identik dgn render Python)", fresh === onDisk,
      "jalankan: node scripts/genReconConstants.mjs (lepas tu commit)");
  }
}

// ====================================================================
// 2. recon.ts import dari ./reconConstants + tiada literal lama tertinggal.
// ====================================================================
const NAMES = ["COD_VALUES", "INTEGRITY_EXC", "AGED", "KAT_LABEL", "PREPAID_SUCCESS_STATUS"];
{
  const ts = readFileSync(PATHS.reconTs, "utf8");

  // 2a. Ada blok import { ... } from "./reconConstants" yang bawa SEMUA 5 nama.
  const im = /import\s*{([^}]*)}\s*from\s*["']\.\/reconConstants["']/.exec(ts);
  if (!im) {
    check('recon.ts import dari "./reconConstants"', false,
      'tiada blok `import { ... } from "./reconConstants"` dijumpai');
  } else {
    const imported = new Set(im[1].split(",").map((s) => s.trim()).filter(Boolean));
    for (const n of NAMES) {
      check(`recon.ts import ${n} dari ./reconConstants`, imported.has(n),
        `nama '${n}' tiada dalam blok import ./reconConstants`);
    }
  }

  // 2b. TIADA takrif literal lama tertinggal (const NAME = [ | { | ( ...). Kalau
  //     ada, itu salinan yang boleh lari , tepat masalah yang fasa 2 padam.
  for (const n of NAMES) {
    const leftover = new RegExp(`\\bconst\\s+${n}\\b[^=\\n]*=\\s*[\\[{(]`).test(ts);
    check(`recon.ts TIADA literal lama ${n}`, !leftover,
      `jumpa takrif literal 'const ${n} = ...' , sepatutnya import dari ./reconConstants`);
  }
}

// ====================================================================
// 3. Enjin Python kedua (reconSql.py, BEKU): masih import + status prepaid selaras.
// ====================================================================
function balancedFrom(src, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  throw new Error(`kurungan '${open}' tak seimbang bermula index ${openIdx}`);
}
// Senarai status SQL Python (_PREPAID_OK = ... ( ... )): token petik-tunggal.
function sqlStatusesPy(src, name, label) {
  const m = new RegExp(`\\b${name}\\s*=`).exec(src);
  if (!m) throw new Error(`${label}: '${name}' tak dijumpai (format berubah?)`);
  const openIdx = src.indexOf("(", m.index);
  if (openIdx < 0) throw new Error(`${label}: '(' tak dijumpai selepas '${name}'`);
  const region = balancedFrom(src, openIdx, "(", ")");
  const toks = [...region.matchAll(/'([^']*)'/g)].map((x) => x[1]);
  if (!toks.length) throw new Error(`${label}: 0 status token dari '${name}' (format berubah?)`);
  return toks;
}
function sameSet(a, b) {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}
{
  const reconSql = readFileSync(PATHS.reconSql, "utf8");
  const SRC = {
    db: readFileSync(PATHS.db, "utf8"),
    reconcile: readFileSync(PATHS.reconcile, "utf8"),
    theme: readFileSync(PATHS.theme, "utf8"),
  };
  const pyConst = must(() => extractConstants(SRC), "ekstrak konstan Python");

  check("reconSql import COD_VALUES dari db",
    /from\s+db\s+import[^\n]*\bCOD_VALUES\b/.test(reconSql),
    "reconSql.py sepatutnya import COD_VALUES dari db, bukan salinan sendiri");
  check("reconSql import INTEGRITY_EXC dari reconcile",
    /from\s+reconcile\s+import[^\n]*\bINTEGRITY_EXC\b/.test(reconSql),
    "reconSql.py sepatutnya import INTEGRITY_EXC dari reconcile");
  check("reconSql import AGED dari reconcile",
    /from\s+reconcile\s+import[^\n]*\bAGED\b/.test(reconSql),
    "reconSql.py sepatutnya import AGED dari reconcile");

  const e2 = must(() => sqlStatusesPy(reconSql, "_PREPAID_OK", "reconSql.py"), "_PREPAID_OK e2");
  if (pyConst && e2) {
    check("PREPAID status (db.py == reconSql _PREPAID_OK)",
      sameSet(pyConst.PREPAID_SUCCESS_STATUS, e2),
      `db=${JSON.stringify(pyConst.PREPAID_SUCCESS_STATUS.sort())} e2=${JSON.stringify(e2.sort())}`);
  }
}

console.log(fail ? `\n${fail} masalah konstan dikesan.` : "\nSemua konstan recon selaras (dijana, byte identik dgn Python).");
process.exit(fail ? 1 : 0);
