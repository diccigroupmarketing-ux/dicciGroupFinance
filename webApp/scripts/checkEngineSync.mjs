// Semak drift enjin: salinan api/engine/*.py mesti IDENTIK dengan rujukan di root.
// syncEngine.sh salin ../db.py ../ingest.py -> api/engine/ secara MANUAL. Kalau
// lupa run, api/engine basi dan webApp guna parser lama secara senyap. Skrip ni
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
for (const { name, ref, copy } of PAIRS) {
  let a, b;
  try {
    a = readFileSync(ref, "utf8");
  } catch (e) {
    console.error(`  MISSING  rujukan tak dijumpai: ${ref}`);
    drifted.push(name);
    continue;
  }
  try {
    b = readFileSync(copy, "utf8");
  } catch (e) {
    console.error(`  MISSING  salinan tak dijumpai: ${copy}`);
    drifted.push(name);
    continue;
  }
  if (a !== b) drifted.push(name);
}

if (drifted.length) {
  console.error("engine drift dikesan (jalankan: bash scripts/syncEngine.sh):");
  for (const f of drifted) console.error(`  DRIFT  ${f}`);
  process.exit(1);
}

console.log("engine in sync , api/engine identik dengan rujukan root (db.py, ingest.py)");
process.exit(0);
