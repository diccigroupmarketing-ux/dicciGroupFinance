// Jana "mirror" lib/recon.ts dalam parityHarness/data supaya fungsi DALAMAN
// (buildTmpM / buildTmpMPrepaid) boleh dipanggil harness tanpa MENYENTUH repo.
//
// Mirror dijana SEMULA setiap run terus dari sumber sebenar, jadi mustahil basi.
// Hanya 2 jenis perubahan mekanikal dibenarkan:
//   1. import relatif ("./db" dll) -> laluan ABSOLUT ke fail repo yang SAMA
//   2. satu baris `export { buildTmpM, buildTmpMPrepaid }` ditambah di hujung,
//      DAN ia ditambah HANYA kalau sumber belum export fungsi tu sendiri
//      (sejak 27 Jul recon.ts dah export dua duanya, jadi biasanya 0 baris tambah)
// Skrip cetak bilangan baris berubah supaya boleh disahkan minimal.
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/Users/adizaini/dicciGroupFinance/webApp/lib/recon.ts";
const LIB = "/Users/adizaini/dicciGroupFinance/webApp/lib";
const OUT = process.argv[2];

const src = readFileSync(SRC, "utf8");
let out = src.replace(/from "\.\/([A-Za-z0-9_]+)"/g, `from "${LIB}/$1"`);
const nRewrite = (src.match(/from "\.\/[A-Za-z0-9_]+"/g) || []).length;
// Fungsi yang harness perlu. Tambah re-export HANYA untuk yang belum diexport
// sumber, kalau tidak esbuild mati "Multiple exports with the same name".
const NEED = ["buildTmpM", "buildTmpMPrepaid", "REMIT_PENDING_DAYS"];
const missing = NEED.filter(
  (n) => !new RegExp(`^export (async function|function|const) ${n}\\b`, "m").test(src));
if (missing.length) {
  out += `\n// ditambah harness parity (fail jana, gitignored):\n`
    + `export { ${missing.join(", ")} };\n`;
}
writeFileSync(OUT, out);

const a = src.split("\n"), b = out.split("\n");
let changed = 0;
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
console.log(`mirror dijana: ${OUT}`);
console.log(`  import relatif ditulis semula : ${nRewrite}`);
console.log(`  baris asal berubah            : ${changed} (mesti == ${nRewrite})`);
console.log(`  re-export ditambah            : ${missing.length ? missing.join(", ") : "tiada (sumber dah export)"}`);
console.log(`  baris ditambah di hujung      : ${b.length - a.length}`);
if (changed !== nRewrite) { console.error("MIRROR TIDAK MINIMAL, berhenti."); process.exit(1); }
