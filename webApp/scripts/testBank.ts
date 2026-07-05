// Test lapisan bank confirmation atas dev PG. Guna bil sebenar dalam cod_bills.
//   DATABASE_URL="postgresql://dev:dev@localhost:5433/dicci" npx tsx scripts/testBank.ts
import { getBankDeposits, saveBankDeposit, deleteBankDeposit } from "../lib/bank";
import { getPool } from "../lib/db";

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) {
  console.error("TOLAK: DATABASE_URL mesti dev lokal (localhost).");
  process.exit(1);
}

let fail = 0;
function ok(c: boolean, label: string) {
  console.log((c ? "  PASS " : "  FAIL ") + label);
  if (!c) fail++;
}

async function main() {
  // ensureTable dipanggil dalam getBankDeposits; sahkan jadual wujud + mula kosong.
  const start = await getBankDeposits();
  const bill = (await getPool().query("SELECT bill_id FROM cod_bills LIMIT 1")).rows[0]?.bill_id;
  ok(!!bill, `ada bil untuk diuji: ${bill}`);
  ok(start[bill] === undefined, "bil belum ada deposit (mula bersih)");

  await saveBankDeposit({ bill_id: bill, actual_amount: 12345.67, deposited_on: null,
    note: "ujian", entered_by: "test@dicci.com", now: "2026-07-05T00:00:00Z" });
  const after = await getBankDeposits();
  ok(after[bill]?.actual_amount === 12345.67, `deposit disimpan (${after[bill]?.actual_amount})`);
  ok(after[bill]?.entered_by === "test@dicci.com", "entered_by direkod");

  // Upsert: tukar jumlah.
  await saveBankDeposit({ bill_id: bill, actual_amount: 9999, deposited_on: null,
    note: null, entered_by: "test2@dicci.com", now: "2026-07-05T01:00:00Z" });
  const upd = await getBankDeposits();
  ok(upd[bill]?.actual_amount === 9999, `upsert tukar jumlah (${upd[bill]?.actual_amount})`);
  ok(Object.keys(upd).length === Object.keys(start).length + 1, "tiada baris berganda selepas upsert");

  // Guard: jumlah negatif ditolak.
  let threw = false;
  try { await saveBankDeposit({ bill_id: bill, actual_amount: -5, entered_by: "x", now: "z" }); }
  catch { threw = true; }
  ok(threw, "jumlah negatif ditolak");

  // Padam.
  await deleteBankDeposit(bill);
  const del = await getBankDeposits();
  ok(del[bill] === undefined, "deposit dipadam");

  console.log(fail === 0 ? "\nSEMUA LULUS" : `\n${fail} GAGAL`);
  await getPool().end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
