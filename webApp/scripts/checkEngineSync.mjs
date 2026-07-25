// Semak drift enjin: salinan api/engine/*.py mesti IDENTIK dengan rujukan di root.
// syncEngine.mjs salin ../db.py ../ingest.py -> api/engine/ secara AUTOMATIK
// (prebuild). Kalau salinan basi, webApp guna parser lama secara senyap. Skrip ni
// tangkap keadaan tu supaya boleh dijadikan gate (exit != 0 = drift).
//
// Guna:  node scripts/checkEngineSync.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Path diselesaikan dari lokasi fail ni (cermin corak parityCheck.ts), BUKAN cwd.
const here = dirname(fileURLToPath(import.meta.url));
const webApp = join(here, "..");
const root = join(webApp, "..");

// { rujukan di root  ->  salinan yang dijana }
const PAIRS = [
  { name: "db.py", ref: join(root, "db.py"), copy: join(webApp, "api", "engine", "db.py") },
  { name: "ingest.py", ref: join(root, "ingest.py"), copy: join(webApp, "api", "engine", "ingest.py") },
];

const drifted = [];
let skippedNoRoot = false;
for (const { name, ref, copy } of PAIRS) {
  let a, b;
  try {
    a = readFileSync(ref, "utf8");
  } catch (e) {
    // Rujukan root TIADA = konteks build tanpa root repo (cth Vercel muat naik
    // folder webApp sahaja). Tak boleh banding, jadi SKIP (bukan drift) supaya
    // build jauh tak pecah. Gate ni bermakna hanya bila root hadir (lokal/CI).
    console.log(`  SKIP  rujukan root tak hadir (${ref}) , tak boleh banding.`);
    skippedNoRoot = true;
    continue;
  }
  try {
    b = readFileSync(copy, "utf8");
  } catch (e) {
    // Salinan commit HILANG = masalah sebenar (function Vercel akan pecah).
    console.error(`  MISSING  salinan tak dijumpai: ${copy}`);
    drifted.push(name);
    continue;
  }
  if (a !== b) drifted.push(name);
}

if (drifted.length) {
  console.error("engine drift dikesan (jalankan: npm run sync:engine):");
  for (const f of drifted) console.error(`  DRIFT  ${f}`);
  process.exit(1);
}

if (skippedNoRoot) {
  console.log("engine check dilangkau (root repo tak hadir dalam konteks ni).");
  process.exit(0);
}
console.log("engine in sync , api/engine identik dengan rujukan root (db.py, ingest.py)");
process.exit(0);
