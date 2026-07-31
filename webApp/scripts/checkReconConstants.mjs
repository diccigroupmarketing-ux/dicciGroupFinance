// Guard konstan merentas 3 enjin recon (E1 reconcile.py, E2 reconSql.py, E3
// webApp/lib/recon.ts). Kenapa wujud: konstan kategori duduk di DUA bahasa dan
// TIGA fail. Enjin Python (reconcile.py + reconSql.py) KONGSI satu sumber lewat
// `import`, tapi recon.ts simpan SALINAN SENDIRI (bukan import , beza bahasa).
// Jadi tiap konstan boleh senyap lari antara Python dan TypeScript tanpa ada
// ujian yang perasan. Skrip ni baca sumber kebenaran Python lalu sahkan salinan
// TS (dan salinan SQL untuk senarai status prepaid) SAMA nilai.
//
// Guna:  node scripts/checkReconConstants.mjs
// Exit 0 = semua konstan selaras. Exit != 0 = drift ATAU format tak boleh diparse.
//
// PENTING (kejujuran gate): kalau format sumber berubah sampai parser tak jumpa
// konstan atau ekstrak 0 token, skrip ni GAGAL KUAT (exit 1), BUKAN lulus senyap.
// Lulus senyap atas parse gagal = penggera mati tanpa sesiapa tahu.
//
// Peta sumber kebenaran (bukan semua di db.py , jujur ikut lokasi sebenar):
//   COD_VALUES              -> db.py            (reconSql import; recon.ts salinan array)
//   INTEGRITY_EXC, AGED     -> reconcile.py     (reconSql import; recon.ts salinan array)
//   KAT_LABEL               -> theme.py KAT_LABEL_EN (recon.ts salinan objek)
//   PREPAID_SUCCESS_STATUS  -> db.py            (reconSql _PREPAID_OK + recon.ts PREPAID_OK, senarai SQL)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, "..");
const root = join(webApp, "..");

const PATHS = {
  db: join(root, "db.py"),
  reconcile: join(root, "reconcile.py"),
  theme: join(root, "theme.py"),
  reconSql: join(root, "reconSql.py"),
  reconTs: join(webApp, "lib", "recon.ts"),
};

// ---- baca fail; kalau root tiada (konteks build webApp sahaja) SKIP, bukan drift.
const SRC = {};
let skippedNoRoot = false;
for (const [k, p] of Object.entries(PATHS)) {
  try {
    SRC[k] = readFileSync(p, "utf8");
  } catch {
    // recon.ts dalam webApp; kalau IA hilang itu masalah sebenar. Tapi fail ROOT
    // (db/reconcile/theme/reconSql) hilang = konteks tanpa root, skip macam
    // checkEngineSync.mjs supaya build jauh tak pecah.
    if (k === "reconTs") {
      console.error(`MISSING  recon.ts tak dijumpai: ${p}`);
      process.exit(1);
    }
    skippedNoRoot = true;
  }
}
if (skippedNoRoot) {
  console.log("check konstan dilangkau (root repo tak hadir dalam konteks ni).");
  process.exit(0);
}

// ====================================================================
// Pengekstrak robust. Semua GAGAL KUAT (throw) kalau format lari.
// ====================================================================

// Tangkap rantau seimbang bermula pada pembuka (open) sampai penutup padanan.
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

// Konstan berbentuk senarai/set/array: NAME [: type] = { ... } | [ ... ] | ( ... ).
// Pulang semua token dalam petik (single ATAU double).
function listTokens(src, name, label) {
  const m = new RegExp(`\\b${name}\\b[^=\\n]*=\\s*([\\[{(])`).exec(src);
  if (!m) throw new Error(`${label}: konstan '${name}' tak dijumpai (format berubah?)`);
  const open = m[1];
  const close = { "[": "]", "{": "}", "(": ")" }[open];
  const openIdx = m.index + m[0].length - 1;
  const region = balancedFrom(src, openIdx, open, close);
  const toks = [...region.matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
  if (!toks.length) throw new Error(`${label}: 0 token diekstrak dari '${name}' (format berubah?)`);
  return toks;
}

// Peta label: { key: "Label", ... }. Kunci boleh dipetik (Python) atau tidak (TS).
function pairMap(src, name, label) {
  const m = new RegExp(`\\b${name}\\b[^=\\n]*=\\s*{`).exec(src);
  if (!m) throw new Error(`${label}: peta '${name}' tak dijumpai (format berubah?)`);
  const openIdx = m.index + m[0].length - 1;
  const region = balancedFrom(src, openIdx, "{", "}");
  const re = /(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*:\s*(['"])([^'"]*)\3/g;
  const out = {};
  let mm;
  while ((mm = re.exec(region))) out[mm[2]] = mm[4];
  if (!Object.keys(out).length) throw new Error(`${label}: 0 pasangan dari '${name}' (format berubah?)`);
  return out;
}

// Senarai status SQL dalam rentetan: ambil semua token petik-tunggal dalam takrif.
// endMode 'paren' = Python (takrif dibungkus '( ... )'), 'semicolon' = TypeScript.
function sqlStatuses(src, name, endMode, label) {
  const m = new RegExp(`\\b${name}\\s*=`).exec(src);
  if (!m) throw new Error(`${label}: '${name}' tak dijumpai (format berubah?)`);
  let region;
  if (endMode === "paren") {
    const openIdx = src.indexOf("(", m.index);
    if (openIdx < 0) throw new Error(`${label}: '(' tak dijumpai selepas '${name}'`);
    region = balancedFrom(src, openIdx, "(", ")");
  } else {
    const end = src.indexOf(";", m.index);
    if (end < 0) throw new Error(`${label}: ';' tak dijumpai selepas '${name}'`);
    region = src.slice(m.index, end);
  }
  const toks = [...region.matchAll(/'([^']*)'/g)].map((x) => x[1]);
  if (!toks.length) throw new Error(`${label}: 0 status token dari '${name}' (format berubah?)`);
  return toks;
}

// ====================================================================
// Pembanding: bandingkan sebagai SET (susunan tak penting untuk keahlian).
// ====================================================================
function sameSet(a, b) {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}
function samePairs(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || !ka.every((k, i) => k === kb[i])) return false;
  return ka.every((k) => a[k] === b[k]);
}

let fail = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "OK  " : "DRIFT"}  ${label}`);
  if (!ok) {
    fail++;
    if (detail) console.error(`         ${detail}`);
  }
}

// Bungkus ekstrak: kalau parse GAGAL, itu kegagalan gate (bukan lulus senyap).
function must(fn, label) {
  try {
    return fn();
  } catch (e) {
    console.error(`  GAGAL PARSE  ${label}: ${e.message}`);
    fail++;
    return null;
  }
}

console.log("Guard konstan recon 3 enjin:");

// --- 1. COD_VALUES: db.py (kebenaran) vs recon.ts salinan array ---
{
  const py = must(() => listTokens(SRC.db, "COD_VALUES", "db.py"), "COD_VALUES py");
  const ts = must(() => listTokens(SRC.reconTs, "COD_VALUES", "recon.ts"), "COD_VALUES ts");
  if (py && ts) {
    check("COD_VALUES (db.py == recon.ts)", sameSet(py, ts),
      `py=${JSON.stringify(py.sort())} ts=${JSON.stringify(ts.sort())}`);
  }
  // reconSql import dari db (bukan salinan sendiri).
  check("COD_VALUES (reconSql import dari db)",
    /from\s+db\s+import[^\n]*\bCOD_VALUES\b/.test(SRC.reconSql),
    "reconSql.py sepatutnya import COD_VALUES dari db, bukan takrif salinan sendiri");
}

// --- 2. INTEGRITY_EXC: reconcile.py (kebenaran) vs recon.ts ---
{
  const py = must(() => listTokens(SRC.reconcile, "INTEGRITY_EXC", "reconcile.py"), "INTEGRITY_EXC py");
  const ts = must(() => listTokens(SRC.reconTs, "INTEGRITY_EXC", "recon.ts"), "INTEGRITY_EXC ts");
  if (py && ts) {
    check("INTEGRITY_EXC (reconcile.py == recon.ts)", sameSet(py, ts),
      `py=${JSON.stringify(py.sort())} ts=${JSON.stringify(ts.sort())}`);
  }
  check("INTEGRITY_EXC (reconSql import dari reconcile)",
    /from\s+reconcile\s+import[^\n]*\bINTEGRITY_EXC\b/.test(SRC.reconSql),
    "reconSql.py sepatutnya import INTEGRITY_EXC dari reconcile");
}

// --- 3. AGED: reconcile.py (kebenaran) vs recon.ts ---
{
  const py = must(() => listTokens(SRC.reconcile, "AGED", "reconcile.py"), "AGED py");
  const ts = must(() => listTokens(SRC.reconTs, "AGED", "recon.ts"), "AGED ts");
  if (py && ts) {
    check("AGED (reconcile.py == recon.ts)", sameSet(py, ts),
      `py=${JSON.stringify(py.sort())} ts=${JSON.stringify(ts.sort())}`);
  }
  check("AGED (reconSql import dari reconcile)",
    /from\s+reconcile\s+import[^\n]*\bAGED\b/.test(SRC.reconSql),
    "reconSql.py sepatutnya import AGED dari reconcile");
}

// --- 4. KAT_LABEL: theme.py KAT_LABEL_EN (kebenaran) vs recon.ts KAT_LABEL ---
{
  const py = must(() => pairMap(SRC.theme, "KAT_LABEL_EN", "theme.py"), "KAT_LABEL py");
  const ts = must(() => pairMap(SRC.reconTs, "KAT_LABEL", "recon.ts"), "KAT_LABEL ts");
  if (py && ts) {
    check("KAT_LABEL (theme.py == recon.ts)", samePairs(py, ts),
      `py keys=${JSON.stringify(Object.keys(py).sort())} ts keys=${JSON.stringify(Object.keys(ts).sort())}`);
  }
}

// --- 5. PREPAID status: db.py (kebenaran) vs reconSql _PREPAID_OK vs recon.ts PREPAID_OK ---
{
  const py = must(() => listTokens(SRC.db, "PREPAID_SUCCESS_STATUS", "db.py"), "PREPAID_SUCCESS_STATUS db");
  const e2 = must(() => sqlStatuses(SRC.reconSql, "_PREPAID_OK", "paren", "reconSql.py"), "_PREPAID_OK e2");
  const e3 = must(() => sqlStatuses(SRC.reconTs, "PREPAID_OK", "semicolon", "recon.ts"), "PREPAID_OK e3");
  if (py && e2) {
    check("PREPAID status (db.py == reconSql _PREPAID_OK)", sameSet(py, e2),
      `db=${JSON.stringify(py.sort())} e2=${JSON.stringify(e2.sort())}`);
  }
  if (py && e3) {
    check("PREPAID status (db.py == recon.ts PREPAID_OK)", sameSet(py, e3),
      `db=${JSON.stringify(py.sort())} e3=${JSON.stringify(e3.sort())}`);
  }
}

console.log(fail ? `\n${fail} masalah konstan dikesan.` : "\nSemua konstan recon selaras merentas 3 enjin.");
process.exit(fail ? 1 : 0);
