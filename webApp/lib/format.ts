// Format duit & tarikh (UI English, mata wang RM).
export function fmtRM(v: number, dp = 2): string {
  return "RM " + v.toLocaleString("en-MY", {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
}

export function fmtInt(v: number): string {
  return v.toLocaleString("en-MY");
}

export function fmtShortK(v: number): string {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "k";
  return String(Math.round(v));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDay(day: string): string {
  // "2026-06-11" -> "11 Jun"
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function fmtDate(day: string | null): string {
  // "2026-06-11" -> "11 Jun 2026"
  if (!day) return "date?";
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return day;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// norm_trk enjin lama simpan NaN sebagai teks "NAN"; papar sebagai tiada.
export function trackingOrDash(v: string | null): string {
  return v && v.toUpperCase() !== "NAN" ? v : "—";
}

export interface WeekBar { label: string; net: number; parcels: number }

// Kumpul baris harian ke minggu (mula Isnin), sama semantik dengan period_key
// "Weekly" dalam app Streamlit.
export function groupWeekly(
  daily: { day: string; cod_dikutip: number; fee: number; parcel: number }[],
): WeekBar[] {
  const acc = new Map<string, { net: number; parcels: number }>();
  for (const d of daily) {
    const dt = new Date(d.day + "T00:00:00");
    if (isNaN(dt.getTime())) continue;
    const weekday = (dt.getDay() + 6) % 7; // Isnin = 0
    const start = new Date(dt.getTime() - weekday * 86400_000);
    const key = start.toISOString().slice(0, 10);
    const cur = acc.get(key) ?? { net: 0, parcels: 0 };
    cur.net += d.cod_dikutip - d.fee;
    cur.parcels += d.parcel;
    acc.set(key, cur);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      label: fmtDay(key),
      net: Math.round(v.net * 100) / 100,
      parcels: v.parcels,
    }));
}
