// Parity check: lib/recon.ts (TS) lawan reconSql.py (Python, rujukan).
// Guna:  python3 scripts/parityDump.py > scripts/parityPython.json
//        npx tsx scripts/parityCheck.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL = "postgresql://dev:dev@localhost:5433/dicci";

import { streamSummary, StreamKey } from "../lib/recon";

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, "parityPython.json"), "utf8"));

const r2 = (x: number) => Math.round(x * 100) / 100;

async function main() {
  let fail = 0;
  for (const key of ["jnt", "dhl", "ninja"] as StreamKey[]) {
    const s = await streamSummary(key);
    const mine = {
      katN: Object.fromEntries(Object.entries(s.katN).sort()),
      linesN: s.linesN, linesCod: r2(s.linesCod), linesFee: r2(s.linesFee),
      integN: s.integN, agedN: s.agedN,
      tallyN: s.tallyN, tallyCod: r2(s.tallyCod),
      daily: s.daily.map((d) => ({
        day: d.day, parcel: d.parcel, cod: r2(d.cod_dikutip), fee: r2(d.fee),
        tally: d.tally, exception: d.exception, botol: d.botol,
        botol_free: d.botol_free,
      })),
      perBill: [...s.perBill]
        .sort((a, b) => a.bill_id.localeCompare(b.bill_id))
        .map((b) => ({ bill_id: b.bill_id, parcel: b.parcel, cod: r2(b.cod),
                       fee: r2(b.fee), tally: b.tally, exc: b.exc })),
    };
    const a = JSON.stringify(mine, Object.keys(mine).sort());
    const b = JSON.stringify(ref[key], Object.keys(ref[key]).sort());
    if (a === b) {
      console.log(`[${key}] PADAN  (kat=${JSON.stringify(mine.katN)})`);
    } else {
      fail++;
      console.log(`[${key}] TAK PADAN`);
      for (const f of Object.keys(mine) as (keyof typeof mine)[]) {
        const x = JSON.stringify(mine[f]);
        const y = JSON.stringify(ref[key][f]);
        if (x !== y) console.log(`  medan ${f}:\n    TS : ${x}\n    PY : ${y}`);
      }
    }
  }
  console.log(fail ? "\nPARITY GAGAL" : "\nPARITY LULUS , laluan TS setia pada enjin Python");
  process.exit(fail ? 1 : 0);
}

main();
