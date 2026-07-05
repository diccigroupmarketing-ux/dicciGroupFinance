// Pengesahan bank (per bil settlement). Tutup gelung Fasa 1: banding net remit
// DIJANGKA dengan jumlah SEBENAR masuk bank, variance = tanda bocor duit.
// Additive, tiada kesan pada logik recon. webApp memiliki jadual ni; ensureTable
// cipta bila perlu supaya tak bergantung pada boot Streamlit.
import { getPool } from "./db";

export interface BankDeposit {
  bill_id: string;
  actual_amount: number;
  deposited_on: string | null;
  note: string | null;
  entered_by: string | null;
  updated_at: string | null;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS bank_deposits (
      bill_id       TEXT PRIMARY KEY,
      actual_amount DOUBLE PRECISION,
      deposited_on  TEXT,
      note          TEXT,
      entered_by    TEXT,
      updated_at    TEXT
    )`);
  ensured = true;
}

// Semua deposit sebagai peta bill_id -> rekod (jadual kecil, satu baris per bil).
export async function getBankDeposits(): Promise<Record<string, BankDeposit>> {
  await ensureTable();
  const res = await getPool().query(
    `SELECT bill_id, actual_amount, deposited_on, note, entered_by, updated_at
     FROM bank_deposits`);
  const out: Record<string, BankDeposit> = {};
  for (const r of res.rows) {
    out[r.bill_id] = {
      bill_id: r.bill_id,
      actual_amount: Number(r.actual_amount),
      deposited_on: r.deposited_on, note: r.note,
      entered_by: r.entered_by, updated_at: r.updated_at,
    };
  }
  return out;
}

export interface BankInput {
  bill_id: string;
  actual_amount: number;
  deposited_on?: string | null;
  note?: string | null;
  entered_by: string;
  now: string; // stamp masa dari route (Date tak tersedia dalam sesetengah konteks)
}

export async function saveBankDeposit(input: BankInput): Promise<void> {
  await ensureTable();
  const amount = Number(input.actual_amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("jumlah bank tidak sah");
  }
  const bill = String(input.bill_id ?? "").trim();
  if (!bill) throw new Error("bill_id diperlukan");
  await getPool().query(
    `INSERT INTO bank_deposits
       (bill_id, actual_amount, deposited_on, note, entered_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (bill_id) DO UPDATE SET
       actual_amount = excluded.actual_amount,
       deposited_on  = excluded.deposited_on,
       note          = excluded.note,
       entered_by    = excluded.entered_by,
       updated_at    = excluded.updated_at`,
    [bill, amount, input.deposited_on ?? null, input.note ?? null,
     input.entered_by, input.now],
  );
}

export async function deleteBankDeposit(billId: string): Promise<void> {
  await ensureTable();
  await getPool().query("DELETE FROM bank_deposits WHERE bill_id = $1",
    [String(billId ?? "").trim()]);
}
