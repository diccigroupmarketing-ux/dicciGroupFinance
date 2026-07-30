"use client";

// Tab "Open" page Review: SEMUA baris yang boleh di-settle, silang stream, dalam
// satu tempat kerja. Ini satu satunya skrin di mana finance memilih banyak baris
// sekali gus.
//
// PERATURAN PAPARAN:
//   , Baris yang sudah settled / snoozed tetap dipapar (kelabu + chip). Toggle
//     "Hide settled" ada tapi lalainya MATI.
//   , Baris yang sudah ada kes hidup TAK BOLEH dipilih semula (backbone akan
//     tolak), jadi checkbox dimatikan dengan sebab yang jelas.
//   , Susunan lalai: nilai RM paling besar dahulu. Toggle "Oldest first" ada.
import { useMemo, useState } from "react";
import { fmtInt, fmtRM, trackingOrDash } from "@/lib/format";
import AmountCell from "@/components/AmountCell";
import TableFilter from "@/components/TableFilter";
import ResolveModal from "@/components/ResolveModal";
import ResolutionChip, { ToneChip } from "@/components/ResolutionChip";
import { badgeState } from "@/components/resolveTypes";
import type {
  ReasonOptionUI, ResolveLimits, ResolveTarget,
} from "@/components/resolveTypes";

const COHORTS = [
  { key: "all", label: "All ages", lo: -Infinity, hi: Infinity },
  { key: "0-14", label: "0–14d", lo: 0, hi: 14 },
  { key: "15-30", label: "15–30d", lo: 15, hi: 30 },
  { key: "31-60", label: "31–60d", lo: 31, hi: 60 },
  { key: "60+", label: "60d+", lo: 61, hi: Infinity },
];

function inCohort(age: number | null, key: string): boolean {
  if (key === "all") return true;
  if (age == null) return false;
  const c = COHORTS.find((x) => x.key === key)!;
  return age >= c.lo && age <= c.hi;
}

function rowKey(r: ResolveTarget): string {
  return `${r.stream}|${r.subjectType}|${r.subjectId}`;
}

function tone(kat: string): "pos" | "cau" | "dan" | "mut" {
  if (kat === "tally") return "pos";
  if (kat === "hilang_lewat" || kat === "belum_remit" || kat === "belum_bayar") return "cau";
  return "dan";
}

// Baldi paparan. "Awaiting" (belum_remit / belum_bayar) memang NORMAL: duitnya
// belum sampai giliran, bukan bocor. Ia boleh di-resolve (backbone benarkan),
// tapi ia TIDAK sepatutnya jadi barisan kerja lalai, jadi ia disorok di belakang
// satu penapis dan bukan campur dengan baris yang betul betul perlu manusia.
const AWAITING_KATS = new Set(["belum_remit", "belum_bayar"]);

function bucketOf(kat: string): "human" | "awaiting" {
  return AWAITING_KATS.has(kat) ? "awaiting" : "human";
}

const BUCKETS: { key: string; label: string }[] = [
  { key: "human", label: "Needs a human" },
  { key: "awaiting", label: "Awaiting (normal)" },
  { key: "all", label: "All" },
];

export default function ReviewOpen({
  rows, reasons, limits, streams,
}: {
  rows: ResolveTarget[];
  reasons: ReasonOptionUI[];
  limits: ResolveLimits;
  streams: { key: string; name: string }[];
}) {
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState("human");
  const [stream, setStream] = useState("all");
  const [cohort, setCohort] = useState("all");
  const [oldest, setOldest] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [capNote, setCapNote] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (bucket !== "all" && bucketOf(r.category) !== bucket) return false;
      if (stream !== "all" && r.stream !== stream) return false;
      if (!inCohort(r.ageDays, cohort)) return false;
      if (hideDone && r.badge) {
        const st = badgeState(r.badge);
        if (st === "settled" || st === "snoozed") return false;
      }
      if (needle) {
        const hay = `${r.title} ${r.sub ?? ""} ${r.tracking ?? ""} ${r.categoryLabel}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => oldest
      ? (b.ageDays ?? -1) - (a.ageDays ?? -1)
      : b.value - a.value);
  }, [rows, q, bucket, stream, cohort, hideDone, oldest]);

  // Hanya baris TANPA kes hidup boleh dicadang. Backbone akan tolak yang lain,
  // jadi lebih jujur mematikan checkbox terus daripada membiarkan orang pilih.
  const selectable = useMemo(() => filtered.filter((r) => !r.badge), [filtered]);
  const selected = useMemo(
    () => rows.filter((r) => picked.has(rowKey(r))), [rows, picked]);
  const selectedValue = selected.reduce((a, r) => a + r.value, 0);
  const closedN = rows.filter((r) => {
    if (!r.badge) return false;
    const st = badgeState(r.badge);
    return st === "settled" || st === "snoozed";
  }).length;

  const toggle = (r: ResolveTarget) => {
    setCapNote(null);
    setPicked((prev) => {
      const next = new Set(prev);
      const k = rowKey(r);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const selectAllMatching = () => {
    const take = selectable.slice(0, limits.batchHardMax);
    setPicked(new Set(take.map(rowKey)));
    setCapNote(selectable.length > take.length
      ? `Selected the first ${fmtInt(take.length)} of ${fmtInt(selectable.length)} `
        + `matching rows. ${fmtInt(limits.batchHardMax)} is the maximum per request.`
      : null);
  };

  const clear = () => { setPicked(new Set()); setCapNote(null); };

  if (rows.length === 0) {
    return (
      <div className="emptyCard">
        <div className="big">No exceptions to review</div>
        Every stream is clean, or no bills have been uploaded yet. Rows appear here
        the moment the engine flags them.
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="cardHead" style={{ flexWrap: "wrap", gap: 10 }}>
          <TableFilter placeholder="Find order / AWB / stockist…" value={q} onChange={setQ} />
          <div className="segRow" role="group" aria-label="Filter bucket">
            {BUCKETS.map((b) => (
              <button key={b.key} className={"segBtn" + (bucket === b.key ? " active" : "")}
                onClick={() => setBucket(b.key)}>{b.label}</button>
            ))}
          </div>
          <div className="segRow" role="group" aria-label="Filter stream">
            <button className={"segBtn" + (stream === "all" ? " active" : "")}
              onClick={() => setStream("all")}>All streams</button>
            {streams.map((s) => (
              <button key={s.key} className={"segBtn" + (stream === s.key ? " active" : "")}
                onClick={() => setStream(s.key)}>{s.name}</button>
            ))}
          </div>
          <div className="segRow" role="group" aria-label="Filter age">
            {COHORTS.map((c) => (
              <button key={c.key} className={"segBtn" + (cohort === c.key ? " active" : "")}
                onClick={() => setCohort(c.key)}>{c.label}</button>
            ))}
          </div>
          <div className="segRow" role="group" aria-label="Sort order">
            <button className={"segBtn" + (!oldest ? " active" : "")}
              onClick={() => setOldest(false)}>Biggest first</button>
            <button className={"segBtn" + (oldest ? " active" : "")}
              onClick={() => setOldest(true)}>Oldest first</button>
          </div>
        </div>
        <div className="resolveToolbar">
          <span className="resolveToolbarNote">
            {fmtInt(filtered.length)} row{filtered.length === 1 ? "" : "s"} shown
            {" · "}{fmtInt(selectable.length)} still selectable
            {" · "}{fmtInt(rows.length)} resolvable in total
          </span>
          {closedN > 0 && (
            <label className="resolveToggle">
              <input type="checkbox" checked={hideDone}
                onChange={(e) => setHideDone(e.target.checked)} />
              Hide settled and snoozed ({fmtInt(closedN)})
            </label>
          )}
          <button className="ghostBtn resolveMini" onClick={selectAllMatching}
            disabled={selectable.length === 0}>
            Select all matching filter (max {fmtInt(limits.batchHardMax)})
          </button>
        </div>
        {capNote && <div className="resolveBlock">{capNote}</div>}
      </div>

      {picked.size > 0 && (
        <div className="resolveBar">
          <div className="resolveBarText">
            <b>{fmtInt(picked.size)}</b> row{picked.size === 1 ? "" : "s"} selected
            {" · "}<b>{fmtRM(selectedValue)}</b>
            {picked.size > limits.peerBatchMax && (
              <span className="resolveBarWarn">
                {" "}over the peer limit of {fmtInt(limits.peerBatchMax)}, the finance
                lead will have to approve it
              </span>
            )}
          </div>
          <button className="ghostBtn resolveMini" onClick={clear}>Clear</button>
          <button className="uploadBtn resolveMini" onClick={() => setOpen(true)}>
            Resolve selected
          </button>
        </div>
      )}

      <div className="sectionGap" />

      <div className="card">
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th className="pickCol"></th>
                <th>Row</th>
                <th>Stream</th>
                <th>Status</th>
                <th className="num">Age</th>
                <th className="num">Expected</th>
                <th className="num">Received</th>
                <th className="num">Value</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const k = rowKey(r);
                const st = r.badge ? badgeState(r.badge) : null;
                const dim = st === "settled" || st === "snoozed";
                return (
                  <tr key={k} className={dim ? "rowResolved" : undefined}>
                    <td className="pickCol">
                      <input type="checkbox" checked={picked.has(k)}
                        disabled={!!r.badge}
                        title={r.badge
                          ? "This row already has an open case. Void or withdraw it first."
                          : "Select this row"}
                        aria-label={`Select ${r.title}`}
                        onChange={() => toggle(r)} />
                    </td>
                    <td className="cellMain">{r.title}
                      <div className="cellSub">
                        {r.sub ?? "no stockist"}
                        {r.tracking ? ` · ${trackingOrDash(r.tracking)}` : ""}
                      </div>
                    </td>
                    <td>{r.streamName}</td>
                    <td><ToneChip tone={tone(r.category)}>{r.categoryLabel}</ToneChip></td>
                    <td className="num">{r.ageDays != null ? `${fmtInt(r.ageDays)}d` : "—"}</td>
                    <td className="num">{r.expected != null ? fmtRM(r.expected) : "—"}</td>
                    <td className="num">
                      <AmountCell value={r.amount} hasPayment={r.hasPayment} />
                    </td>
                    <td className="num"><b>{fmtRM(r.value)}</b></td>
                    <td>{r.badge ? <ResolutionChip badge={r.badge} /> : <span className="cellSub">open</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="cellMuted">No rows match these filters.</div>
        )}
      </div>

      {open && selected.length > 0 && (
        <ResolveModal targets={selected} reasons={reasons} limits={limits}
          onClose={() => { setOpen(false); clear(); }} />
      )}
    </>
  );
}
