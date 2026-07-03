import { INTEGRITY_EXC, AGED, KAT_LABEL } from "@/lib/recon";

type Tone = "pos" | "cau" | "dan" | "mut";
const TONE_CLASS: Record<Tone, string> = {
  pos: "chipPos", cau: "chipCau", dan: "chipDan", mut: "chipMut",
};

export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`chip ${TONE_CLASS[tone]}`}>
      <span className="cdot" /> {children}
    </span>
  );
}

// Nada chip ikut makna kategori recon (sama semantik dengan warna Streamlit).
export function katTone(kat: string): Tone {
  if (kat === "tally") return "pos";
  if (INTEGRITY_EXC.includes(kat)) return "dan";
  if (AGED.includes(kat)) return "cau";
  return "mut";
}

export function KatChip({ kat }: { kat: string }) {
  return <Chip tone={katTone(kat)}>{KAT_LABEL[kat] ?? kat}</Chip>;
}
