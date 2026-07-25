"use client";

import { useRouter } from "next/navigation";

// Pilih ambang aging (hari sebelum "overdue"). Default 14 = baseline. Menukar
// nilai re-bucket belum_remit vs hilang_lewat (tujuan parameter, bukan ubah logik).
const PRESETS = [7, 14, 30];

export default function AgingControl({
  pending, grain, streamKey, basePath, extraQuery,
}: {
  pending: number; grain?: string; streamKey?: string;
  // Mod umum: bila basePath diberi, tekan butang pergi ke
  // `${basePath}?${extraQuery&}pending=n` (dipakai page Not collected). Bila
  // tak diberi, kekal perilaku lama stream page (grain + streamKey).
  basePath?: string; extraQuery?: string;
}) {
  const router = useRouter();
  const go = (n: number) => {
    if (basePath) {
      const pre = extraQuery ? `${extraQuery}&` : "";
      router.push(`${basePath}?${pre}pending=${n}`);
    } else {
      router.push(`/impact/streams/${streamKey}?grain=${grain}&pending=${n}`);
    }
  };

  return (
    <div className="segRow" role="group" aria-label="Aging threshold">
      {PRESETS.map((n) => (
        <button key={n} className={"segBtn" + (n === pending ? " active" : "")}
                onClick={() => go(n)}>{n}d</button>
      ))}
    </div>
  );
}
