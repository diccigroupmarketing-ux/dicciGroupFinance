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

export type Grain = "daily" | "weekly" | "monthly";

export function parseGrain(v: string | undefined): Grain {
  return v === "daily" || v === "monthly" ? v : "weekly";
}

export const GRAIN_LABEL: Record<Grain, string> = {
  daily: "day", weekly: "week", monthly: "month",
};

// Kumpul baris harian ikut grain , sama semantik dengan period_key Streamlit
// (weekly = mula Isnin, monthly = bulan kalendar).
export function groupByGrain(
  daily: { day: string; cod_dikutip: number; fee: number; parcel: number }[],
  grain: Grain = "weekly",
): WeekBar[] {
  const acc = new Map<string, { net: number; parcels: number }>();
  for (const d of daily) {
    const dt = new Date(d.day + "T00:00:00");
    if (isNaN(dt.getTime())) continue;
    let key: string;
    if (grain === "daily") {
      key = d.day;
    } else if (grain === "monthly") {
      key = d.day.slice(0, 7); // YYYY-MM
    } else {
      const weekday = (dt.getDay() + 6) % 7; // Isnin = 0
      // Guna komponen tarikh TEMPATAN (bukan toISOString UTC) supaya kunci minggu
      // kekal Isnin pada TZ timur UTC (dev lokal KL), sepadan period_key Streamlit.
      const mon = new Date(dt.getTime() - weekday * 86400_000);
      const yy = mon.getFullYear();
      const mm = String(mon.getMonth() + 1).padStart(2, "0");
      const dd = String(mon.getDate()).padStart(2, "0");
      key = `${yy}-${mm}-${dd}`;
    }
    const cur = acc.get(key) ?? { net: 0, parcels: 0 };
    cur.net += d.cod_dikutip - d.fee;
    cur.parcels += d.parcel;
    acc.set(key, cur);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      label: grain === "monthly"
        ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
        : fmtDay(key),
      net: Math.round(v.net * 100) / 100,
      parcels: v.parcels,
    }));
}

export const groupWeekly = (
  daily: { day: string; cod_dikutip: number; fee: number; parcel: number }[],
) => groupByGrain(daily, "weekly");
