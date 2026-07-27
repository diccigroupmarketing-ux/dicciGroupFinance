// Julat tarikh (order date) untuk page stream , lapisan TULEN, tiada DB, tiada
// logik recon. Semua fungsi di sini boleh diuji tanpa Postgres.
//
// Peraturan yang dikunci owner:
//   , tapis atas TARIKH ORDER (orders.order_date), bukan tarikh bil.
//   , sempadan INKLUSIF dua dua hujung, tarikh sahaja (tiada bahagian masa).
//   , baris TANPA tarikh order (cth duit hantu = baris bil tiada order) SENTIASA
//     dikekalkan, tak pernah disorok senyap (prinsip baldi jujur projek ni).
//   , tiada param dalam URL = All time = angka SAMA macam sebelum ciri ni wujud.
//
// Zon waktu: kita tak pernah bina objek Date untuk perbandingan. Tarikh disimpan
// sebagai teks "YYYY-MM-DD..." dalam DB, jadi perbandingan STRING (leksikografik)
// = perbandingan kronologi, immune pada zon waktu mesin. Rujukan "hari ini" untuk
// preset datang dari reconToday() (jam Kuala Lumpur), sama macam enjin aging.

export interface DateRange {
  from: string | null;  // "YYYY-MM-DD" atau null = tiada had bawah
  to: string | null;    // "YYYY-MM-DD" atau null = tiada had atas
}

export const ALL_TIME: DateRange = { from: null, to: null };

export type RangePreset = "all" | "thisMonth" | "lastMonth" | "custom";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// Sahkan teks "YYYY-MM-DD" yang BETUL betul wujud dalam kalendar (tolak 2026-02-31,
// 2026-13-01, dsb). Pulang null kalau tak sah , input sampah dilayan macam tiada
// penapis, bukan crash.
export function parseYmd(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!YMD_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return null;
  if (d > daysInMonth(y, m)) return null;
  return s;
}

export function daysInMonth(year: number, month1: number): number {
  // Date.UTC(y, m, 0) = hari terakhir bulan m (month1 sudah 1-based).
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

// Ambil bahagian tarikh sahaja dari nilai DB ("2026-06-11 00:00:00" -> "2026-06-11").
// Nilai kosong/rosak -> null, dan null bermaksud "baris ni tiada tarikh order".
export function ymdOf(v: string | null | undefined): string | null {
  if (!v) return null;
  const head = v.trim().slice(0, 10);
  return YMD_RE.test(head) ? head : null;
}

// Baca julat dari query param. Apa apa yang tak sah = diabaikan (jatuh All time).
// Kalau from > to, kita tukar tempat (owner taip terbalik, jangan pulangkan kosong).
export function parseDateRange(
  sp: { from?: string | string[]; to?: string | string[] } | undefined,
): DateRange {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  let from = parseYmd(one(sp?.from));
  let to = parseYmd(one(sp?.to));
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

export function isAllTime(r: DateRange): boolean {
  return !r.from && !r.to;
}

export function sameRange(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

// Ujian keahlian satu baris. orderDate null/rosak = baris tanpa tarikh = SENTIASA
// masuk (lihat nota baldi jujur di atas).
export function rowInRange(orderDate: string | null | undefined, r: DateRange): boolean {
  const d = ymdOf(orderDate);
  if (d === null) return true;
  if (r.from && d < r.from) return false;
  if (r.to && d > r.to) return false;
  return true;
}

// Preset dikira dari tarikh rujukan app (bukan jam browser) supaya "This month"
// sama untuk semua orang yang buka link yang sama pada hari yang sama.
export interface RangePresets { thisMonth: DateRange; lastMonth: DateRange }

export function presetRanges(todayYmd: string): RangePresets {
  const safe = parseYmd(todayYmd) ?? "1970-01-01";
  const y = Number(safe.slice(0, 4));
  const m = Number(safe.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return {
    thisMonth: { from: monthStart(y, m), to: monthEnd(y, m) },
    lastMonth: { from: monthStart(py, pm), to: monthEnd(py, pm) },
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
export const monthStart = (y: number, m: number) => `${y}-${pad2(m)}-01`;
export const monthEnd = (y: number, m: number) => `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;

export function activePreset(r: DateRange, p: RangePresets): RangePreset {
  if (isAllTime(r)) return "all";
  if (sameRange(r, p.thisMonth)) return "thisMonth";
  if (sameRange(r, p.lastMonth)) return "lastMonth";
  return "custom";
}

// Pasangan query untuk julat. All time = kosong, jadi URL lalai kekal bersih.
export function rangeParams(r: DateRange): [string, string][] {
  const out: [string, string][] = [];
  if (r.from) out.push(["from", r.from]);
  if (r.to) out.push(["to", r.to]);
  return out;
}

// Bina query string untuk link page stream: kekalkan grain/pending/julat sekali
// gus supaya tekan satu kawalan tak reset kawalan lain.
export function streamQuery(
  keep: Record<string, string | number | null | undefined>, r: DateRange,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) {
    if (v === null || v === undefined || v === "") continue;
    params.set(k, String(v));
  }
  for (const [k, v] of rangeParams(r)) params.set(k, v);
  return params.toString();
}
