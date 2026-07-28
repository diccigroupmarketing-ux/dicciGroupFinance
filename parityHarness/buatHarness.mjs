// Jana salinan harness parity RASMI (webApp/scripts/parityDump.py + parityCheck.ts)
// yang hormat env DATABASE_URL, supaya boleh jalan atas SEBARANG db fixture,
// bukan terkunci pada db dev `dicci`. Repo TIDAK disentuh.
//
// Setiap gantian disahkan berlaku; kalau sumber berubah dan corak tak jumpa,
// skrip MATI (jangan senyap jalan atas harness separuh betul).
import { readFileSync, writeFileSync } from "node:fs";

const WEBAPP = "/Users/adizaini/dicciGroupFinance/webApp";
const OUT = process.argv[2]; // folder output (biasanya parityHarness/ sendiri)

function sub(src, pairs, label) {
  let s = src;
  for (const [re, to] of pairs) {
    if (!re.test(s)) { console.error(`GAGAL: corak tak jumpa dalam ${label}: ${re}`); process.exit(1); }
    s = s.replace(re, to);
  }
  return s;
}

// ---- parityDump.py --------------------------------------------------------
let py = readFileSync(`${WEBAPP}/scripts/parityDump.py`, "utf8");
py = sub(py, [
  [/^ROOT = .*$/m, `ROOT = Path("/Users/adizaini/dicciGroupFinance")`],
  [/^os\.environ\["DATABASE_URL"\] = (".*")$/m,
   `os.environ.setdefault("DATABASE_URL", $1)`],
], "parityDump.py");
writeFileSync(`${OUT}/parityDumpAny.py`, py);

// ---- parityCheck.ts -------------------------------------------------------
let ts = readFileSync(`${WEBAPP}/scripts/parityCheck.ts`, "utf8");
ts = sub(ts, [
  [/^process\.env\.DATABASE_URL = (".*");$/m, `process.env.DATABASE_URL ??= $1;`],
  [/^import "\.\/reconEnv";$/m, `import "${WEBAPP}/scripts/reconEnv";`],
  [/from "\.\.\/lib\/recon";/, `from "${WEBAPP}/lib/recon";`],
  // import.meta tak sah dalam output CJS tsx; ganti dengan laluan dari env.
  [/^const here = dirname\(fileURLToPath\(import\.meta\.url\)\);$/m,
   `const here = process.env.PARITY_REF_DIR!;`],
], "parityCheck.ts");
writeFileSync(`${OUT}/parityCheckAny.ts`, ts);

console.log("harness dijana: parityDumpAny.py + parityCheckAny.ts");
