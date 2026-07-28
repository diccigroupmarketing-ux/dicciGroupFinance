// Lencana keadaan satu baris yang ada kes resolution.
//
// PENTING: "Snoozed" BUKAN "Settled". Warnanya lain (kuning neutral lawan hijau)
// dan ia SENTIASA membawa tarikh luput, sebab baldi paling besar (overdue yang
// menunggu bil diupload) hanya layak di-snooze, bukan di-settle.
//
// Komponen tulen (tiada hook, tiada fetch), jadi ia selamat dipakai dalam
// komponen server mahupun client.
import { fmtDate } from "@/lib/format";
import { BADGE_TEXT, badgeState, type RowBadgeUI } from "@/components/resolveTypes";

const TONE: Record<string, string> = {
  waiting: "chipMut",
  settled: "chipPos",
  snoozed: "chipCau",
  expired: "chipDan",
  stale: "chipDan",
};

export function resolutionTitle(b: RowBadgeUI): string {
  const st = badgeState(b);
  const bits: string[] = [`${BADGE_TEXT[st]} · ${b.reasonLabel}`];
  if (b.note) bits.push(`Note: ${b.note}`);
  if (b.expiresOn) bits.push(`Asks again on ${fmtDate(b.expiresOn)}`);
  if (b.by) bits.push(`${st === "waiting" ? "Proposed" : "Decided"} by ${b.by}`);
  if (b.stale) bits.push("The figures on this row changed after the decision, so it is open again.");
  return bits.join(" · ");
}

// Chip nada umum yang SELAMAT untuk komponen client. Sengaja TIDAK guna
// components/Chip.tsx: fail itu mengimport lib/recon (yang tarik `pg` dan
// next/cache), jadi mengimportnya dari komponen "use client" akan menyeret kod
// server masuk bundle browser. Label kategori dikira di server dan dihantar
// sebagai teks, jadi tiada peta kategori diperlukan di sini.
export function ToneChip({
  tone, children,
}: {
  tone: "pos" | "cau" | "dan" | "mut";
  children: React.ReactNode;
}) {
  const cls = tone === "pos" ? "chipPos"
    : tone === "cau" ? "chipCau"
    : tone === "dan" ? "chipDan" : "chipMut";
  return <span className={`chip ${cls}`}><span className="cdot" /> {children}</span>;
}

export default function ResolutionChip({ badge }: { badge: RowBadgeUI }) {
  const st = badgeState(badge);
  const text = st === "snoozed" && badge.expiresOn
    ? `Snoozed to ${fmtDate(badge.expiresOn)}`
    : BADGE_TEXT[st];
  return (
    <span className={`chip ${TONE[st]}`} title={resolutionTitle(badge)}>
      <span className="cdot" /> {text}
    </span>
  );
}
