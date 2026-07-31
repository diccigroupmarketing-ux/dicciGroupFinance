// Penjana konstan kategori recon: baca sumber kebenaran Python (db.py,
// reconcile.py, theme.py) dan TULIS webApp/lib/reconConstants.ts.
//
// "Apa maksudnya": dulu recon.ts simpan SALINAN literal konstan kategori (senarai
// COD, senarai exception, label, status prepaid). Salinan boleh lari senyap dari
// Python tanpa sesiapa perasan , checkReconConstants.mjs cuma MENJERIT bila drift.
// Sekarang kita naik satu tangga: konstan TS DIJANA dari Python, recon.ts IMPORT
// dari fail dijana, jadi ia mustahil lari (jana semula = derive balik dari Python).
//
// Corak sama macam syncEngine.mjs: dipanggil sebagai `prebuild`. Bila root TIADA
// (build Vercel muat naik folder webApp sahaja), SKIP dengan jujur dan biar
// salinan yang sudah commit dipakai. checkReconConstants.mjs (guard) yang tangkap
// kalau salinan commit itu basi (banding byte lawan render segar dari Python).
//
// Guna:  node scripts/genReconConstants.mjs
//
// Fail ni juga EKSPOT `PATHS` + `renderFromPython()` supaya checkReconConstants.mjs
// guna LOGIK PARSE + RENDER yang SAMA (satu sumber, tiada dua salinan parser yang
// boleh sendiri lari). Bila dijalankan terus (bukan diimport) ia menulis fail.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, "..");
const root = join(webApp, "..");

export const PATHS = {
  db: join(root, "db.py"),
  reconcile: join(root, "reconcile.py"),
  theme: join(root, "theme.py"),
  reconSql: join(root, "reconSql.py"),
  reconTs: join(webApp, "lib", "recon.ts"),
  generated: join(webApp, "lib", "reconConstants.ts"),
};

// Rujukan Python yang WAJIB hadir untuk jana. Kalau salah satu hilang = konteks
// tanpa root, penjana SKIP (bukan gagal).
const PY_REFS = [PATHS.db, PATHS.reconcile, PATHS.theme];

export function rootPresent() {
  return PY_REFS.every((p) => existsSync(p));
}

// ====================================================================
// Pengekstrak robust (cermin checkReconConstants). Semua GAGAL KUAT (throw)
// kalau format lari , lulus senyap atas parse gagal = penggera mati.
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

// Konstan senarai/set/array: NAME [: type] = { ... } | [ ... ] | ( ... ).
// Pulang token dalam petik ikut SUSUNAN SUMBER (susunan penting untuk render).
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

// Peta label { key: "Label", ... } ikut SUSUNAN SUMBER (insertion order kekal).
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

// Ekstrak semua konstan kategori dari teks sumber Python.
export function extractConstants(SRC) {
  return {
    COD_VALUES: listTokens(SRC.db, "COD_VALUES", "db.py"),
    INTEGRITY_EXC: listTokens(SRC.reconcile, "INTEGRITY_EXC", "reconcile.py"),
    AGED: listTokens(SRC.reconcile, "AGED", "reconcile.py"),
    PREPAID_SUCCESS_STATUS: listTokens(SRC.db, "PREPAID_SUCCESS_STATUS", "db.py"),
    KAT_LABEL: pairMap(SRC.theme, "KAT_LABEL_EN", "theme.py"),
  };
}

// ====================================================================
// Render: hasilkan kandungan reconConstants.ts secara DETERMINISTIK. checker
// render semula lalu banding BYTE lawan fail commit (macam checkEngineSync).
// ====================================================================
const HEADER = `// ============================================================================
// FAIL DIJANA , JANGAN EDIT TANGAN.
// ============================================================================
// Sumber kebenaran konstan kategori recon ialah Python:
//   COD_VALUES, PREPAID_SUCCESS_STATUS  <-  db.py
//   INTEGRITY_EXC, AGED                 <-  reconcile.py
//   KAT_LABEL (dari KAT_LABEL_EN)       <-  theme.py
//
// Dijana oleh scripts/genReconConstants.mjs (dipanggil sebagai prebuild, sama
// corak dengan syncEngine.mjs). Jana semula:
//   node scripts/genReconConstants.mjs
// Guard freshness (banding byte lawan Python): scripts/checkReconConstants.mjs,
// satu langkah dalam \`npm test\`.
//
// Kenapa dijana, bukan tulis tangan: recon.ts dulu simpan SALINAN literal konstan
// ni dan ia boleh lari senyap dari Python. Sekarang recon.ts import dari sini dan
// fail ni terikat pada Python secara mekanikal, jadi mustahil lari. Nak tukar
// nilai? Tukar di Python, jana semula fail ni.
/* eslint-disable */
`;

export function renderTs(c) {
  const arr = (name, items) => `export const ${name}: string[] = ${JSON.stringify(items, null, 2)};`;
  const obj = (name, o) => `export const ${name}: Record<string, string> = ${JSON.stringify(o, null, 2)};`;
  return [
    HEADER,
    arr("COD_VALUES", c.COD_VALUES),
    arr("INTEGRITY_EXC", c.INTEGRITY_EXC),
    arr("AGED", c.AGED),
    arr("PREPAID_SUCCESS_STATUS", c.PREPAID_SUCCESS_STATUS),
    obj("KAT_LABEL", c.KAT_LABEL),
  ].join("\n") + "\n";
}

// Baca Python + render satu langkah. Dipakai penjana DAN guard.
export function renderFromPython() {
  const SRC = {
    db: readFileSync(PATHS.db, "utf8"),
    reconcile: readFileSync(PATHS.reconcile, "utf8"),
    theme: readFileSync(PATHS.theme, "utf8"),
  };
  return renderTs(extractConstants(SRC));
}

// ---- Bila dijalankan terus (bukan diimport): tulis fail. ----
const runDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (runDirect) {
  if (!rootPresent()) {
    console.log(
      "genReconConstants: rujukan root (db.py/reconcile.py/theme.py) tak hadir, " +
      "guna reconConstants.ts yang sudah commit , skip auto-jana.");
    process.exit(0);
  }
  const content = renderFromPython();
  const before = existsSync(PATHS.generated) ? readFileSync(PATHS.generated, "utf8") : null;
  if (before === content) {
    console.log("genReconConstants: lib/reconConstants.ts sudah segar (tiada perubahan).");
  } else {
    writeFileSync(PATHS.generated, content);
    console.log("genReconConstants: lib/reconConstants.ts dijana semula dari Python.");
  }
  process.exit(0);
}
