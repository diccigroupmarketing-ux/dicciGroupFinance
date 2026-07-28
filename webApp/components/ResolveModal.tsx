"use client";

// ====================================================================
// Borang SATU SATUNYA untuk mencadang resolution. Dipakai oleh butang inline
// dalam jadual (satu baris) DAN oleh Review page (batch). Tiada salinan kedua.
//
// Prinsip yang dipegang borang ni:
//   , Senarai sebab datang dari reasonOptions() backbone, tak pernah hardcode.
//   , Ambang RM dan had batch datang dari adminThreshold() / peerBatchMax().
//   , Medan tambahan (counterparty / duplicate ref / tarikh luput) muncul HANYA
//     bila sebab yang dipilih memang menuntutnya.
//   , Cadangan TAK PERNAH menggerakkan duit. Ayat itu ditulis terus pada borang.
// ====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { fmtInt, fmtRM } from "@/lib/format";
import {
  apiErrorEnglish, commonSide, pickDefaultReason, reasonAllowed, rowDiff,
  whyEnglish, ymdAdd,
  type ProposeReply, type ReasonOptionUI, type ResolveLimits, type ResolveTarget,
} from "@/components/resolveTypes";

// Snooze lalai: separuh had, dibundar, supaya team tak terus lompat ke maksimum.
const DEFAULT_SNOOZE_DAYS = 14;

export default function ResolveModal({
  targets, reasons, limits, onClose,
}: {
  targets: ResolveTarget[];
  reasons: ReasonOptionUI[];
  limits: ResolveLimits;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const side = commonSide(targets);
  const batch = targets.length > 1;

  const usable = useMemo(
    () => reasons.filter((r) => reasonAllowed(r, side) && (!batch || r.bolehBatch)),
    [reasons, side, batch],
  );

  const [code, setCode] = useState(() => pickDefaultReason(targets, reasons));
  const [note, setNote] = useState("");
  const [adjust, setAdjust] = useState(
    () => (targets.length === 1 ? String(rowDiff(targets[0])) : "0"));
  const [counterparty, setCounterparty] = useState("");
  const [duplicateRef, setDuplicateRef] = useState("");
  const snoozeMax = ymdAdd(limits.todayYmd, limits.maxSnoozeDays);
  const [expiresOn, setExpiresOn] = useState(
    () => ymdAdd(limits.todayYmd, Math.min(DEFAULT_SNOOZE_DAYS, limits.maxSnoozeDays)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState<ProposeReply | null>(null);

  const meta = usable.find((r) => r.code === code) ?? null;

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const totalValue = targets.reduce((a, t) => a + t.value, 0);
  const adjustNum = Number(adjust);
  const adjustOk = adjust.trim() === "" || Number.isFinite(adjustNum);

  // Amaran eskalasi, dikira dari nombor backbone, bukan tekaan.
  const escalations: string[] = [];
  if (adjustOk && Math.abs(adjustNum || 0) > limits.adminThreshold) {
    escalations.push(
      `The adjustment is over RM ${limits.adminThreshold.toFixed(2)}, so only the `
      + "finance lead can approve it.");
  }
  if (meta?.adminSahaja) {
    escalations.push(`"${meta.label}" is reserved for the finance lead.`);
  }
  if (targets.length > limits.peerBatchMax) {
    escalations.push(
      `${fmtInt(targets.length)} rows is over the peer limit of `
      + `${fmtInt(limits.peerBatchMax)}, so only the finance lead can approve this batch.`);
  }

  // Halangan yang kita boleh tangkap sebelum hantar (mesej terus, bukan 400).
  let block: string | null = null;
  if (targets.length === 0) block = "Nothing selected.";
  else if (targets.length > limits.batchHardMax) {
    block = `Only ${fmtInt(limits.batchHardMax)} rows can go in one request.`;
  } else if (!meta) {
    block = side == null
      ? "The selection mixes order rows and money rows. Pick one kind at a time."
      : "Pick a reason.";
  } else if (meta.minNote > 0 && note.trim().length < meta.minNote) {
    block = `This reason needs a note of at least ${meta.minNote} characters.`;
  } else if (meta.wajibCounterparty && !counterparty.trim()) {
    block = "This reason needs a counterparty.";
  } else if (meta.wajibRef && !duplicateRef.trim()) {
    block = "This reason needs the reference of the line it duplicates.";
  } else if (meta.snooze && (!expiresOn || expiresOn <= limits.todayYmd)) {
    block = "Pick a snooze date after today.";
  } else if (meta.snooze && expiresOn > snoozeMax) {
    block = `A snooze can run at most ${limits.maxSnoozeDays} days (until ${snoozeMax}).`;
  } else if (!adjustOk) {
    block = "The adjustment has to be a number.";
  }

  const send = async () => {
    if (block || !meta) return;
    setBusy(true); setErr(null); setReply(null);
    try {
      const res = await fetch("/api/resolutions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: targets.map((t) => ({
            subjectType: t.subjectType, subjectId: t.subjectId, stream: t.stream,
          })),
          reason: meta.code,
          note: note.trim() || null,
          adjustAmount: adjust.trim() === "" ? 0 : adjustNum,
          counterparty: meta.wajibCounterparty ? counterparty.trim() : null,
          duplicateRef: meta.wajibRef ? duplicateRef.trim() : null,
          expiresOn: meta.snooze ? expiresOn : null,
        }),
      });
      const j: ProposeReply = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(apiErrorEnglish(res.status, j.error, "propose", limits));
        setReply(j.rejected?.length ? j : null);
      } else {
        setReply(j);
        router.refresh();
      }
    } catch {
      setErr("Network problem. Nothing was recorded, try again.");
    }
    setBusy(false);
  };

  const created = reply?.created?.length ?? 0;
  const rejected = reply?.rejected ?? [];
  const done = created > 0;

  return createPortal(
    <div className="modalBack" onClick={() => !busy && onClose()}>
      <div ref={dialogRef} tabIndex={-1} className="modal resolveModal"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Send a case for approval">
        <div className="cardHead">
          <div className="cardTitle">
            {batch ? `Resolve ${fmtInt(targets.length)} rows` : "Resolve this row"}
          </div>
          <button className="cardLink" onClick={() => !busy && onClose()}>Close</button>
        </div>

        <p className="modalNote">
          A resolution records <b>why</b> a row is being closed. It never moves money:
          the totals, the buckets and the variance stay exactly as they are.
          Someone else has to approve it before it counts.
        </p>

        {/* Pratonton: apa sebenarnya yang akan dicadang. */}
        <div className="resolvePreview">
          <div className="resolvePreviewHead">
            You are about to propose <b>{fmtInt(targets.length)}</b> case
            {targets.length === 1 ? "" : "s"} worth <b>{fmtRM(totalValue)}</b>
          </div>
          <div className="resolveTargets">
            {targets.slice(0, 6).map((t) => (
              <div className="resolveTargetRow" key={`${t.subjectType}:${t.subjectId}`}>
                <span className="resolveTargetId">{t.title}</span>
                <span className="resolveTargetMeta">
                  {t.streamName} · {t.categoryLabel}
                </span>
                <span className="resolveTargetVal">{fmtRM(t.value)}</span>
              </div>
            ))}
            {targets.length > 6 && (
              <div className="resolveTargetRow more">
                and {fmtInt(targets.length - 6)} more row
                {targets.length - 6 === 1 ? "" : "s"}
              </div>
            )}
          </div>
        </div>

        {!done && (
          <>
            <label className="resolveField">
              <span className="resolveLabel">Reason</span>
              <select className="cellInput" value={code} disabled={busy}
                onChange={(e) => setCode(e.target.value)}>
                {usable.length === 0 && <option value="">No reason fits this selection</option>}
                {usable.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}{r.snooze ? " (snooze, not settled)" : ""}
                    {r.adminSahaja ? " · finance lead only" : ""}
                  </option>
                ))}
              </select>
              {meta && <span className="resolveHelp">{reasonHelp(meta)}</span>}
            </label>

            {meta?.snooze && (
              <label className="resolveField">
                <span className="resolveLabel">Ask again on</span>
                <input className="cellInput" type="date" value={expiresOn} disabled={busy}
                  min={ymdAdd(limits.todayYmd, 1)} max={snoozeMax}
                  onChange={(e) => setExpiresOn(e.target.value)} />
                <span className="resolveHelp">
                  A snooze is not a settlement. The row stays in its bucket, it just
                  stops asking until this date (at most {limits.maxSnoozeDays} days).
                </span>
              </label>
            )}

            {meta?.wajibCounterparty && (
              <label className="resolveField">
                <span className="resolveLabel">Counterparty</span>
                <input className="cellInput" type="text" value={counterparty} disabled={busy}
                  placeholder="Which company or entity this money belongs to"
                  onChange={(e) => setCounterparty(e.target.value)} />
              </label>
            )}

            {meta?.wajibRef && (
              <label className="resolveField">
                <span className="resolveLabel">Duplicate of</span>
                <input className="cellInput" type="text" value={duplicateRef} disabled={busy}
                  placeholder="Bill or line reference this one repeats"
                  onChange={(e) => setDuplicateRef(e.target.value)} />
              </label>
            )}

            <label className="resolveField">
              <span className="resolveLabel">Adjustment (RM)</span>
              <input className="cellInput num" type="number" step="0.01" value={adjust}
                disabled={busy} onChange={(e) => setAdjust(e.target.value)} />
              <span className="resolveHelp">
                {batch
                  ? "Applied to every selected row, so leave it at 0 unless they all share the same difference."
                  : "Pre-filled with the difference on this row. It is recorded as an explanation only, it does not change any total."}
              </span>
            </label>

            <label className="resolveField">
              <span className="resolveLabel">
                Note{meta && meta.minNote > 0 ? " (required)" : " (optional)"}
              </span>
              <textarea className="cellInput resolveNote" rows={3} value={note}
                disabled={busy} onChange={(e) => setNote(e.target.value)}
                placeholder={batch
                  ? "One note for every row in this batch"
                  : "What did you check, and what did you find"} />
              {meta && meta.minNote > 0 && (
                <span className="resolveHelp">
                  {note.trim().length} / {meta.minNote} characters minimum
                </span>
              )}
            </label>

            {escalations.length > 0 && (
              <div className="cauPanel" style={{ marginTop: 4 }}>
                <div>
                  <b>This needs the finance lead.</b>
                  {escalations.map((e) => <p key={e}>{e}</p>)}
                </div>
              </div>
            )}

            {block && <div className="resolveBlock">{block}</div>}
            {err && <div className="resolveErr" role="alert">{err}</div>}
          </>
        )}

        {reply && (
          <div className={done ? "posPanel" : "danPanel"} style={{ marginTop: 12 }}>
            <div>
              <b>
                {done
                  ? `${fmtInt(created)} case${created === 1 ? "" : "s"} sent for approval.`
                  : "Nothing was created."}
              </b>
              {done && (
                <p>
                  The rows stay exactly where they are until someone else approves.
                  No total moved.
                </p>
              )}
              {rejected.length > 0 && (
                <div className="resolveRejects">
                  {rejected.map((r) => (
                    <div className="resolveRejectRow" key={`${r.subjectType}:${r.subjectId}`}>
                      <b>{shortId(r.subjectId)}</b> {whyEnglish(r.why)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="modalActions" style={{ marginTop: 14 }}>
          <button className="ghostBtn" onClick={onClose} disabled={busy}>
            {done ? "Done" : "Cancel"}
          </button>
          {!done && (
            <button className="uploadBtn" style={{ flex: 1 }}
              onClick={send} disabled={busy || !!block}>
              {busy ? "Sending…" : "Send for approval"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Penjelasan ringkas satu sebab, dalam bahasa finance biasa. Kalau backbone dah
// tulis tooltip khusus untuk sebab tu, ia yang menang (borang tak pernah tahu
// kod sebab mana mana, ia cuma baca medan `desc`).
function reasonHelp(r: ReasonOptionUI): string {
  if (r.desc) return r.desc;
  if (r.snooze) {
    return "Parks the row for a while. It is NOT settled and it stays in its bucket.";
  }
  switch (r.kelas) {
    case "cost":
      return "The money did arrive, a cost was taken out of it before it reached us.";
    case "revenue":
      return "Part of the money came back out, refund or partial payment.";
    case "data":
      return "The gap comes from what was typed upstream, not from missing money.";
    case "loss":
      return "Accepted as a loss. Finance lead only, and it is recorded as a loss.";
    case "register":
      return "The money has an owner, it just is not one of our orders.";
    default:
      return "";
  }
}

function shortId(id: string): string {
  const bare = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return bare.length > 22 ? bare.slice(0, 21) + "…" : bare;
}
