"use client";

// Bar penapis julat TARIKH ORDER, dikongsi oleh 4 page stream + Dashboard.
//
// Keadaan disimpan dalam URL (?from=&to=) supaya link boleh dishare ke team dan
// butang back browser jalan macam biasa. Tiada param = All time = angka SAMA
// macam sebelum ciri ni wujud.
//
// Nada visual: pill segmented berjenama (aktif dapat aksen emas + titik emas),
// input tarikh senada tema, dan satu ayat "Showing ..." supaya sekali pandang
// team tahu data apa yang dipapar.
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  activePreset, isAllTime, parseYmd, streamQuery,
  type DateRange, type RangePresets,
} from "@/lib/dateRange";
import { fmtDate, fmtInt } from "@/lib/format";
import InfoTip from "@/components/InfoTip";

// Ayat julat semasa. Tiada dash sebagai pemisah, guna "to" / "onwards".
function label(r: DateRange): string {
  if (isAllTime(r)) return "All time";
  if (r.from && r.to) return `${fmtDate(r.from)} to ${fmtDate(r.to)}`;
  if (r.from) return `${fmtDate(r.from)} onwards`;
  return `Up to ${fmtDate(r.to)}`;
}

const PRESETS: { key: "all" | "thisMonth" | "lastMonth"; text: string }[] = [
  { key: "all", text: "All time" },
  { key: "thisMonth", text: "This month" },
  { key: "lastMonth", text: "Last month" },
];

export default function DateRangeFilter({
  basePath, range, presets, keep, undatedRows = 0,
}: {
  basePath: string;
  range: DateRange;
  presets: RangePresets;
  // Param lain yang WAJIB dikekalkan (grain, pending) supaya tukar julat tak
  // reset kawalan lain pada page.
  keep: Record<string, string | number | null | undefined>;
  undatedRows?: number;
}) {
  const router = useRouter();
  const current = activePreset(range, presets);
  const scoped = !isAllTime(range);
  const [open, setOpen] = useState(current === "custom");
  const [from, setFrom] = useState(range.from ?? "");
  const [to, setTo] = useState(range.to ?? "");
  const [err, setErr] = useState<string | null>(null);

  const go = (r: DateRange) => {
    const qs = streamQuery(keep, r);
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const pick = (preset: "all" | "thisMonth" | "lastMonth") => {
    setErr(null);
    setOpen(false);
    if (preset === "all") { setFrom(""); setTo(""); go({ from: null, to: null }); return; }
    const r = presets[preset];
    setFrom(r.from ?? ""); setTo(r.to ?? "");
    go(r);
  };

  const apply = () => {
    const f = parseYmd(from), t = parseYmd(to);
    if (!f && !t) { setErr("Pick at least one date"); return; }
    if ((from && !f) || (to && !t)) { setErr("Use a real date"); return; }
    setErr(null);
    go({ from: f, to: t });
  };

  // Enter dalam mana mana input = Apply (kekunci, bukan tetikus sahaja).
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); apply(); }
  };

  const seg = (key: string, text: string, onClick: () => void) => (
    <button key={key} type="button"
      className={"rangePill" + (current === key ? " on" : "")}
      aria-pressed={current === key}
      onClick={onClick}>
      <span className="rangePillDot" aria-hidden="true" />
      {text}
    </button>
  );

  return (
    <div className={"rangeBar" + (scoped ? " scoped" : "")}>
      <div className="rangeMain">
        <span className="rangeLabel">Order date
          <InfoTip text="Filters this page by the date the order was placed, not the date the courier settled the bill. Every number on the page follows the range you pick." />
        </span>

        <div className="rangeSeg" role="group" aria-label="Order date range">
          {PRESETS.map((p) => seg(p.key, p.text, () => pick(p.key)))}
          <button type="button"
            className={"rangePill" + (current === "custom" ? " on" : "")}
            aria-pressed={current === "custom"}
            aria-expanded={open}
            onClick={() => { setErr(null); setOpen((o) => !o); }}>
            <span className="rangePillDot" aria-hidden="true" />
            Custom
            <span className={"rangeChev" + (open ? " open" : "")} aria-hidden="true">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
            </span>
          </button>
        </div>

        <div className="rangeShowing">
          <span className="rangeShowingText">Showing <b>{label(range)}</b></span>
          {scoped && (
            <button type="button" className="rangeClear" onClick={() => pick("all")}
              title="Clear the date filter and show all time">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              Clear
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="rangeCustom">
          <label className="rangeField">
            <span>From</span>
            <input className="rangeInput" type="date" value={from} max={to || undefined}
              onChange={(e) => setFrom(e.target.value)} onKeyDown={onKey}
              aria-label="Range start date" />
          </label>
          <label className="rangeField">
            <span>To</span>
            <input className="rangeInput" type="date" value={to} min={from || undefined}
              onChange={(e) => setTo(e.target.value)} onKeyDown={onKey}
              aria-label="Range end date" />
          </label>
          <button type="button" className="rangeApply" onClick={apply}>Apply range</button>
          {scoped && (
            <button type="button" className="rangeReset" onClick={() => pick("all")}>
              Reset to all time
            </button>
          )}
          {err && <span className="rangeErr" role="alert">{err}</span>}
        </div>
      )}

      {scoped && undatedRows > 0 && (
        <div className="rangeNote">
          {fmtInt(undatedRows)} item{undatedRows === 1 ? "" : "s"} carry no order date
          and stay visible in every range
          <InfoTip text="Some rows carry no order date: money on a courier bill with no matching order, or an order whose feed had no date. A date filter cannot place those in time, so we keep them visible in every range instead of hiding them, and the totals stay honest." />
        </div>
      )}
    </div>
  );
}
