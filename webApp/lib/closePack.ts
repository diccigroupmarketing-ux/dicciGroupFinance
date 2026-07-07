// Close Pack: sheet tutup bulan untuk finance. Per stream per period (bulan
// settlement bil), duit DIJANGKA (net remit) vs SEBENAR masuk bank (bank_deposits)
// + variance. Variance bukan sifar = tanda bocor.
//
// Komposisi streamSummary (dah cached, tag "recon") + getBankDeposits. TIADA logik
// recon baru, jadi tak sentuh parity. Unjuran dari enjin recon yang SAMA dengan
// dashboard supaya angka konsisten (satu sumber kebenaran).
import { streamSummary, StreamKey, COURIERS } from "./recon";
import { getBankDeposits } from "./bank";

export interface ClosePackRow {
  stream: string; streamKey: StreamKey; period: string;
  parcels: number; cod: number; fee: number; net: number;
  banked: number; bankedBills: number; totalBills: number;
  variance: number; exceptions: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const STREAMS: StreamKey[] = ["jnt", "dhl", "ninja"];

export async function closePack(): Promise<ClosePackRow[]> {
  const deposits = await getBankDeposits();
  const agg = new Map<string, ClosePackRow>();

  for (const key of STREAMS) {
    const s = await streamSummary(key);
    const pbById = new Map(s.perBill.map((p) => [p.bill_id, p]));
    for (const bill of s.bills) {
      const pb = pbById.get(bill.bill_id);
      if (!pb) continue;
      // Period = bulan settlement bil (YYYY-MM). Bil tanpa tarikh = "Unknown".
      const period = bill.settlement_date ? bill.settlement_date.slice(0, 7) : "Unknown";
      const gk = `${key}|${period}`;
      const cur = agg.get(gk) ?? {
        stream: COURIERS[key].name, streamKey: key, period,
        parcels: 0, cod: 0, fee: 0, net: 0, banked: 0,
        bankedBills: 0, totalBills: 0, variance: 0, exceptions: 0,
      };
      cur.parcels += pb.parcel;
      cur.cod += pb.cod;
      cur.fee += pb.fee;
      cur.exceptions += pb.exc;
      cur.totalBills += 1;
      const d = deposits[bill.bill_id];
      if (d) { cur.banked += d.actual_amount; cur.bankedBills += 1; }
      agg.set(gk, cur);
    }
  }

  const rows = [...agg.values()].map((r) => ({
    ...r,
    cod: r2(r.cod), fee: r2(r.fee),
    net: r2(r.cod - r.fee), banked: r2(r.banked),
    variance: r2((r.cod - r.fee) - r.banked),
  }));
  const order = (k: StreamKey) => STREAMS.indexOf(k);
  rows.sort((a, b) => order(a.streamKey) - order(b.streamKey) || a.period.localeCompare(b.period));
  return rows;
}
