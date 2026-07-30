// Close Pack: sheet tutup bulan untuk finance. Per stream per period (bulan
// settlement bil), duit DIJANGKA (net remit) vs SEBENAR masuk bank (bank_deposits)
// + variance. Variance bukan sifar = tanda bocor.
//
// Komposisi streamSummary (dah cached, tag "recon") + getBankDeposits. TIADA logik
// recon baru, jadi tak sentuh parity. Unjuran dari enjin recon yang SAMA dengan
// dashboard supaya angka konsisten (satu sumber kebenaran).
//
// VARIANCE dikira atas bil CONFIRMED SAHAJA (ikut BillsTable.totVar): confirmedNet
// (net bil yang dah ada deposit) tolak banked bil yang sama. Bil belum confirm TIDAK
// masuk variance, jadi period separa-confirm tak papar variance kembung palsu. `net`
// penuh (semua bil) kekal sebagai kolum maklumat "expected", bukan isyarat bocor.
//
// AMAUN GAGAL DIBACA: parser sengaja simpan cod_amount NULL bila sel dalam fail
// bil tak boleh dibaca (lihat _amount_or_none dalam ingest.py), dan SUM() SQL
// langkau NULL. Maknanya `cod` (dan `net`) di sini TERKURANG KIRA secara senyap
// bila ada baris begitu. Kita TIDAK mengubah agregasi enjin; sebaliknya pack ni
// membawa kiraan `unreadable` supaya fail yang finance hantar keluar mengaku
// terus terang berapa baris tak masuk kira.
import { streamSummary, StreamKey, COURIERS } from "./recon";
import { getBankDeposits } from "./bank";
import { getPool } from "./db";

export interface ClosePackRow {
  stream: string; streamKey: StreamKey; period: string;
  parcels: number; cod: number; fee: number; net: number;
  banked: number; bankedBills: number; totalBills: number;
  // confirmedNet = jumlah net (cod - fee) bagi bil yang dah confirmed sahaja.
  // Ia pasangan sebenar `banked`; variance = confirmedNet - banked.
  confirmedNet: number; variance: number; exceptions: number;
  // Bilangan baris dalam bil period ni yang amaunnya gagal dibaca. > 0 bermakna
  // `cod` / `net` di baris ni terkurang kira (baris tu menyumbang RM 0).
  unreadable: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const STREAMS: StreamKey[] = ["jnt", "dhl", "ninja"];

// Bentuk input teras (subset streamSummary + getBankDeposits) supaya foldClosePack
// tulen dan boleh diuji tanpa DB.
export interface StreamInput {
  key: StreamKey;
  perBill: { bill_id: string; parcel: number; cod: number; fee: number; exc: number }[];
  bills: { bill_id: string; settlement_date: string | null }[];
}
export type DepositMap = Record<string, { actual_amount: number }>;
// bill_id -> bilangan baris yang amaunnya gagal dibaca dalam bil itu.
export type UnreadableMap = Record<string, number>;

// Teras tulen: lipat bil per (stream, period) jadi baris close pack. Tiada I/O, jadi
// senang diuji. Variance dikira atas bil confirmed SAHAJA (confirmedNet - banked).
export function foldClosePack(
  streams: StreamInput[], deposits: DepositMap, unreadable: UnreadableMap = {},
): ClosePackRow[] {
  const agg = new Map<string, ClosePackRow>();

  for (const s of streams) {
    const key = s.key;
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
        bankedBills: 0, totalBills: 0, confirmedNet: 0, variance: 0, exceptions: 0,
        unreadable: 0,
      };
      cur.parcels += pb.parcel;
      cur.cod += pb.cod;
      cur.fee += pb.fee;
      cur.exceptions += pb.exc;
      cur.totalBills += 1;
      cur.unreadable += unreadable[bill.bill_id] ?? 0;
      const d = deposits[bill.bill_id];
      // Bil confirmed sahaja masuk kira variance: kumpul net-nya (cod - fee) selari
      // dengan amaun bank sebenar, supaya variance = confirmedNet - banked.
      if (d) {
        cur.banked += d.actual_amount;
        cur.bankedBills += 1;
        cur.confirmedNet += pb.cod - pb.fee;
      }
      agg.set(gk, cur);
    }
  }

  const rows = [...agg.values()].map((r) => ({
    ...r,
    cod: r2(r.cod), fee: r2(r.fee),
    net: r2(r.cod - r.fee), banked: r2(r.banked),
    confirmedNet: r2(r.confirmedNet),
    variance: r2(r.confirmedNet - r.banked),
  }));
  const order = (k: StreamKey) => STREAMS.indexOf(k);
  rows.sort((a, b) => order(a.streamKey) - order(b.streamKey) || a.period.localeCompare(b.period));
  return rows;
}

// Kiraan baris bil yang amaunnya gagal dibaca, per bill_id. Dibaca terus dari
// fail sumber (cod_bill_lines), BUKAN dari tmp_m, jadi ia tak menyentuh enjin
// recon langsung dan tak boleh mengubah satu pun angka duit. Isyarat sama yang
// AmountCell / ResolveModal pakai: ada baris bayaran (awb) tapi amaun NULL.
export async function unreadableBillLines(): Promise<UnreadableMap> {
  const res = await getPool().query(`
    SELECT bill_id, COUNT(*) AS n
    FROM cod_bill_lines
    WHERE awb IS NOT NULL AND cod_amount IS NULL
    GROUP BY bill_id`);
  const out: UnreadableMap = {};
  for (const r of res.rows) {
    if (r.bill_id != null) out[String(r.bill_id)] = Number(r.n);
  }
  return out;
}

export async function closePack(): Promise<ClosePackRow[]> {
  const [deposits, unreadable] = await Promise.all([
    getBankDeposits(), unreadableBillLines(),
  ]);
  const streams: StreamInput[] = [];
  for (const key of STREAMS) {
    const s = await streamSummary(key);
    streams.push({ key, perBill: s.perBill, bills: s.bills });
  }
  return foldClosePack(streams, deposits, unreadable);
}
