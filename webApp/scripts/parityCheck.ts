// Parity check: lib/recon.ts (TS) lawan reconSql.py (Python, rujukan).
// Guna:  python3 scripts/parityDump.py > scripts/parityPython.json
//        npx tsx scripts/parityCheck.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL = "postgresql://dev:dev@localhost:5433/dicci";

// Kunci RECON_TODAY SEBELUM recon dinilai (import dihoist; lihat reconEnv.ts).
// Import side-effect ini MESTI kekal di atas import ../lib/recon.
import "./reconEnv";

// Guna versi *Impl (tanpa cache) , unstable_cache perlukan konteks request Next.
import {
  streamSummaryImpl as streamSummary,
  streamPrepaidSummaryImpl as streamPrepaidSummary,
  stockistBottlesImpl as stockistBottles, StreamKey, PrepaidKey,
  type StreamSummary,
} from "../lib/recon";

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, "parityPython.json"), "utf8"));

const r2 = (x: number) => Math.round(x * 100) / 100;
// Perbandingan code-point (padan sort default Python), bukan locale-aware.
const cp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Stringify dengan kunci disusun REKURSIF , perbandingan nested yang sebenar.
// (JSON.stringify dengan replacer array menapis kunci nested secara senyap.)
function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v as object).sort().map((k) =>
      JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k]),
    ).join(",") + "}";
  }
  return JSON.stringify(v);
}

// Bentuk perbandingan satu stream (courier atau prepaid). Sama untuk kedua.
function shape(s: StreamSummary) {
  return {
    katN: Object.fromEntries(Object.entries(s.katN).sort()),
    linesN: s.linesN, linesCod: r2(s.linesCod), linesFee: r2(s.linesFee),
    integN: s.integN, agedN: s.agedN,
    tallyN: s.tallyN, tallyCod: r2(s.tallyCod),
    daily: s.daily.map((d) => ({
      day: d.day, parcel: d.parcel, cod: r2(d.cod_dikutip), fee: r2(d.fee),
      tally: d.tally, exception: d.exception, botol: d.botol,
      botol_free: d.botol_free,
    })),
    // Susun ikut code-point (bukan localeCompare) supaya padan urutan sort Python.
    perBill: [...s.perBill]
      .sort((a, b) => cp(a.bill_id, b.bill_id))
      .map((b) => ({ bill_id: b.bill_id, parcel: b.parcel, cod: r2(b.cod),
                     fee: r2(b.fee), tally: b.tally, exc: b.exc })),
    // Susun ikut code-point (bukan localeCompare) supaya padan urutan sort Python.
    stokisKat: [...s.stokisKat]
      .sort((a, b) => cp(a.seller, b.seller) || cp(a.kategori, b.kategori))
      .map((x) => ({ seller: x.seller, kategori: x.kategori, n: x.n })),
    otherCourier: [...s.otherCouriers]
      .sort((a, b) => cp(a.courier, b.courier))
      .map((x) => ({ courier: x.courier, orders: x.orders, value: r2(x.value) })),
  };
}

function compareStream(key: string, mine: ReturnType<typeof shape>): number {
  const a = stable(mine);
  const b = stable(ref[key]);
  if (a === b) {
    console.log(`[${key}] PADAN  (kat=${JSON.stringify(mine.katN)})`);
    return 0;
  }
  console.log(`[${key}] TAK PADAN`);
  for (const f of Object.keys(mine) as (keyof typeof mine)[]) {
    const x = stable(mine[f]);
    const y = stable(ref[key][f]);
    if (x !== y) console.log(`  medan ${f}:\n    TS : ${x}\n    PY : ${y}`);
  }
  return 1;
}

async function main() {
  let fail = 0;
  for (const key of ["jnt", "dhl", "ninja"] as StreamKey[]) {
    fail += compareStream(key, shape(await streamSummary(key)));
  }
  // Prepaid (gateway CHIP): padan ikut order_id, bentuk perbandingan sama.
  for (const key of ["chip"] as PrepaidKey[]) {
    fail += compareStream(key, shape(await streamPrepaidSummary(key)));
  }
  // Botol per stokis
  const sb = (await stockistBottles())
    .map(({ stockist, confirmed_orders, paid_bottles, free_bottles,
            total_bottles, unconfirmed_bottles }) => ({
      stockist, confirmed_orders, paid_bottles, free_bottles,
      total_bottles, unconfirmed_bottles,
    }))
    .sort((a, b) => (a.stockist < b.stockist ? -1 : a.stockist > b.stockist ? 1 : 0));
  const sbRef = ref["stockists"];
  if (stable(sb) === stable(sbRef)) {
    console.log(`[stockists] PADAN  (${sb.length} stokis)`);
  } else {
    fail++;
    console.log("[stockists] TAK PADAN");
    console.log("  TS :", stable(sb));
    console.log("  PY :", stable(sbRef));
  }

  console.log(fail ? "\nPARITY GAGAL" : "\nPARITY LULUS , laluan TS setia pada enjin Python");
  process.exit(fail ? 1 : 0);
}

main();
