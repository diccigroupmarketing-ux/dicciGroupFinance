"use client";

import { useRef, useState } from "react";
import type { WeekBar } from "@/lib/format";
import { fmtRM, fmtShortK } from "@/lib/format";

// Bar chart mingguan (satu siri: net remit). Emas gelap #A8853B = warna data
// yang lulus semakan kontras; bar terakhir ditonjolkan sebagai tempoh semasa.
export default function WeeklyChart({ bars }: { bars: WeekBar[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; html: string } | null>(null);

  if (!bars.length) return null;

  const W = 620, H = 250, top = 30, bottom = 210, left = 52, right = 600;
  const maxVal = Math.max(...bars.map((b) => b.net), 1);
  // Bucat skala ke atas supaya gridline cantik.
  const step = Math.pow(10, Math.floor(Math.log10(maxVal)));
  const ceilTo = Math.ceil(maxVal / step) * step;
  const scale = (v: number) => bottom - (v / ceilTo) * (bottom - top);

  const n = bars.length;
  const slot = (right - left) / n;
  const barW = Math.min(72, slot * 0.55);

  const grids = [1, 2 / 3, 1 / 3, 0];

  return (
    <div className="chartWrap" ref={wrapRef}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={"Net remit by week: " + bars.map((b) => `${b.label} ${fmtRM(b.net)}`).join("; ")}>
        {grids.map((g) => (
          <g key={g}>
            <line className="gridline" x1={left} y1={top + (1 - g) * (bottom - top)}
              x2={right} y2={top + (1 - g) * (bottom - top)} />
            <text className="axisLabel" x={left - 8} y={top + (1 - g) * (bottom - top) + 4}
              textAnchor="end">{fmtShortK(ceilTo * g)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = left + slot * i + (slot - barW) / 2;
          const y = scale(b.net);
          const last = i === n - 1;
          return (
            <g key={b.label}>
              <rect className="bar" x={x} y={y} width={barW} height={Math.max(bottom - y, 2)}
                rx="4" fill="#A8853B" opacity={last ? 1 : 0.75}
                onMouseMove={(e) => {
                  const r = wrapRef.current!.getBoundingClientRect();
                  setTip({
                    x: e.clientX - r.left, y: e.clientY - r.top - 8,
                    html: `${b.label}${last ? " · latest" : ""}|${fmtRM(b.net)} · ${b.parcels} parcels`,
                  });
                }}
                onMouseLeave={() => setTip(null)} />
              <text className={"barLabel" + (last ? " hot" : "")} x={x + barW / 2} y={y - 8}
                textAnchor="middle">{fmtShortK(b.net)}</text>
              <text className="axisLabel" x={x + barW / 2} y={bottom + 22}
                textAnchor="middle">{b.label}</text>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="tooltip show" style={{ left: tip.x, top: tip.y }}>
          {tip.html.split("|")[0]}<br /><b>{tip.html.split("|")[1]}</b>
        </div>
      )}
    </div>
  );
}
