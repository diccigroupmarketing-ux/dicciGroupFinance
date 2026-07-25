// Auto-sync enjin (versi node, cross-platform) , ganti keperluan "manusia ingat
// jalankan sync manual". Dipanggil AUTOMATIK sebagai `prebuild` (jalan sebelum
// tiap `npm run build`), jadi salinan api/engine/ SENTIASA segar dari rujukan di
// root repo tanpa langkah manual.
//
// "Apa maksudnya": fail parser sebenar (db.py, ingest.py) duduk di root repo.
// Function Python Vercel (api/pyIngest.py) guna SALINAN dalam api/engine/. Dulu
// kena ingat salin manual; kalau lupa, webApp guna parser LAMA secara senyap.
// Skrip ni buat salinan tu automatik setiap build.
//
// Bila root TIADA (cth build Vercel yang cuma muat naik folder webApp), skrip
// SKIP dengan jujur dan biar salinan yang sudah commit dipakai , bukan gagalkan
// build. checkEngineSync.mjs (gate) yang tangkap kalau salinan commit itu basi.
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, "..");
const root = join(webApp, "..");
const engineDir = join(webApp, "api", "engine");

const FILES = ["db.py", "ingest.py"];

const refsPresent = FILES.every((f) => existsSync(join(root, f)));
if (!refsPresent) {
  console.log(
    "syncEngine: rujukan root tak hadir (build tanpa root repo), " +
    "guna salinan api/engine yang sudah commit , skip auto-sync.");
  process.exit(0);
}

let changed = 0;
for (const f of FILES) {
  const ref = join(root, f);
  const copy = join(engineDir, f);
  const before = existsSync(copy) ? readFileSync(copy, "utf8") : null;
  const after = readFileSync(ref, "utf8");
  if (before !== after) {
    copyFileSync(ref, copy);
    changed++;
    console.log(`syncEngine: kemas kini api/engine/${f}`);
  }
}
console.log(
  changed
    ? `syncEngine: ${changed} fail diselaraskan dari root -> api/engine/`
    : "syncEngine: api/engine sudah segar (tiada perubahan)");
process.exit(0);
