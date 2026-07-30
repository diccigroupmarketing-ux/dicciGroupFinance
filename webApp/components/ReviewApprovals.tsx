"use client";

// Tab "Awaiting approval": maker checker sebenar.
//
// PERATURAN YANG DIKUATKUASA DI SINI (backbone kuatkuasa yang sama di SQL, ini
// lapisan jujur di skrin supaya orang tak buang masa klik benda yang akan gagal):
//   , Cadangan SENDIRI: butang Approve kekal NAMPAK tapi DIMATIKAN, dengan
//     tooltip "You proposed this, someone else must approve".
//   , BATCH: Approve kekal mati sampai checker BUKA senarai penuh sekali DAN
//     taip bilangan baris. Meluluskan 40 baris tanpa tengok bukan kelulusan.
//   , Selepas berjaya, `seen[]` dari API dipapar sebagai bukti apa yang dia
//     lulus (amaun + cap jari), bukan sekadar "done".
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtInt, fmtRM } from "@/lib/format";
import AmountCell, { AMOUNT_UNREADABLE } from "@/components/AmountCell";
import {
  apiErrorEnglish, whyEnglish,
  type CaseUI, type DecideReply, type ResolveLimits,
} from "@/components/resolveTypes";

interface Unit {
  id: string;
  batchId: string | null;
  cases: CaseUI[];
  mine: boolean;
  value: number;
}

function unitsOf(cases: CaseUI[]): Unit[] {
  const byBatch = new Map<string, CaseUI[]>();
  const singles: CaseUI[] = [];
  for (const c of cases) {
    if (c.batchId) {
      const list = byBatch.get(c.batchId) ?? [];
      list.push(c);
      byBatch.set(c.batchId, list);
    } else {
      singles.push(c);
    }
  }
  const units: Unit[] = [];
  for (const [batchId, list] of byBatch) {
    units.push({
      id: `batch:${batchId}`, batchId, cases: list,
      mine: list.every((c) => c.mine),
      value: list.reduce((a, c) => a + caseValue(c), 0),
    });
  }
  for (const c of singles) {
    units.push({
      id: `one:${c.resolutionId}`, batchId: null, cases: [c],
      mine: c.mine, value: caseValue(c),
    });
  }
  return units.sort((a, b) => b.value - a.value);
}

// Duit yang terlibat pada satu kes. Bila amaun masuk tak dapat dibaca, `amount`
// memang NULL, jadi ia jatuh pada `expected` (nilai yang KITA MEMANG TAHU),
// bukan pada 0. Sifar di sini akan menyusun baris paling rosak ke bawah senarai
// dan membuatnya nampak remeh.
function caseValue(c: CaseUI): number {
  return Math.abs(c.amount ?? c.expected ?? 0);
}

function shortId(id: string): string {
  return id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
}

function whenText(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

export default function ReviewApprovals({
  cases, limits,
}: {
  cases: CaseUI[];
  limits: ResolveLimits;
}) {
  const units = useMemo(() => unitsOf(cases), [cases]);
  const mine = units.filter((u) => u.mine);
  const theirs = units.filter((u) => !u.mine);

  if (cases.length === 0) {
    return (
      <div className="emptyCard">
        <div className="big">Nothing waiting for approval</div>
        Cases show up here the moment somebody proposes one from the Open tab or
        from a stream page.
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Ready for you to approve</div>
          <div className="cardHint">
            {fmtInt(theirs.length)} case{theirs.length === 1 ? "" : "s"} proposed by
            somebody else
          </div>
        </div>
        {theirs.length === 0 ? (
          <div className="cellMuted">
            Nothing here. Every open case was proposed by you, so it needs another
            pair of eyes.
          </div>
        ) : (
          theirs.map((u) => (
            <UnitCard key={u.id} unit={u} limits={limits} canDecide />
          ))
        )}
      </div>

      <div className="sectionGap" />

      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">Yours, waiting for someone else</div>
          <div className="cardHint">
            {fmtInt(mine.length)} case{mine.length === 1 ? "" : "s"} you proposed
          </div>
        </div>
        {mine.length === 0 ? (
          <div className="cellMuted">You have nothing waiting.</div>
        ) : (
          mine.map((u) => (
            <UnitCard key={u.id} unit={u} limits={limits} canDecide={false} />
          ))
        )}
      </div>
    </>
  );
}

function UnitCard({
  unit, limits, canDecide,
}: {
  unit: Unit; limits: ResolveLimits; canDecide: boolean;
}) {
  const router = useRouter();
  const [openList, setOpenList] = useState(unit.cases.length === 1);
  const [seenFull, setSeenFull] = useState(unit.cases.length === 1);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState<DecideReply | null>(null);

  const head = unit.cases[0];
  const n = unit.cases.length;
  const isBatch = n > 1;
  // Batch: WAJIB buka senarai penuh sekali + taip bilangan baris.
  const countOk = !isBatch || (seenFull && typed.trim() === String(n));
  const overPeer = !limits.isAdmin && n > limits.peerBatchMax;
  const overThreshold = !limits.isAdmin
    && unit.cases.some((c) => Math.abs(c.adjustAmount) > limits.adminThreshold);
  // Amaun tak dapat dibaca = nilainya TAK DIKETAHUI, jadi tiada siapa boleh
  // buktikan ia di bawah ambang. Backbone menolak peer 403 (GUARD 2b); di sini
  // kita cakap awal awal supaya orang tak klik Approve untuk dapat ralat.
  const unknownN = unit.cases.filter((c) => c.amountUnreadable).length;
  const overUnknown = !limits.isAdmin && unknownN > 0;

  const act = async (action: "approve" | "reject" | "withdraw") => {
    setBusy(true); setErr(null); setReply(null);
    const ids = unit.cases.map((c) => c.resolutionId);
    try {
      const res = await fetch("/api/resolutions", {
        method: action === "withdraw" ? "DELETE" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "withdraw"
          ? { resolutionIds: ids }
          : { resolutionIds: ids, action }),
      });
      const j: DecideReply = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(apiErrorEnglish(
          res.status, j.error, action === "withdraw" ? "withdraw" : "decide", limits));
        setReply(j.failed?.length ? j : null);
      } else {
        setReply(j);
        router.refresh();
      }
    } catch {
      setErr("Network problem. Nothing was changed.");
    }
    setBusy(false);
  };

  return (
    <div className="approvalUnit">
      <div className="approvalHead">
        <div>
          <div className="approvalTitle">
            {isBatch
              ? `Batch of ${fmtInt(n)} rows`
              : shortId(head.subjectId)}
            <span className={"chip " + (head.isSnoozeReason ? "chipCau" : "chipMut")}
              style={{ marginLeft: 8 }}>
              <span className="cdot" /> {head.reasonLabel}
              {head.isSnoozeReason ? " (snooze)" : ""}
            </span>
          </div>
          <div className="approvalMeta">
            {fmtRM(unit.value)} involved
            {unknownN > 0 && (
              <>
                <span className="sep"> · </span>
                <span className="amtUnread">
                  {unknownN === n
                    ? AMOUNT_UNREADABLE
                    : `${fmtInt(unknownN)} rows with the amount unreadable`}
                </span>
              </>
            )}
            <span className="sep"> · </span>
            proposed by {head.proposedBy ?? "unknown"}
            <span className="sep"> · </span>
            {whenText(head.proposedAt)}
            {head.expiresOn && (
              <>
                <span className="sep"> · </span>
                asks again on {head.expiresOn}
              </>
            )}
          </div>
          {head.note && <div className="approvalNote">“{head.note}”</div>}
          {head.counterparty && (
            <div className="approvalMeta">Counterparty: {head.counterparty}</div>
          )}
          {head.duplicateRef && (
            <div className="approvalMeta">Duplicate of: {head.duplicateRef}</div>
          )}
        </div>
        <div className="approvalActions">
          {isBatch && (
            <button className="cardLink"
              onClick={() => { setOpenList((v) => !v); setSeenFull(true); }}>
              {openList ? "Hide the rows" : `Open all ${fmtInt(n)} rows`}
            </button>
          )}
          {canDecide ? (
            <>
              <button className="ghostBtn resolveMini" disabled={busy}
                onClick={() => act("reject")}>Reject</button>
              <button className="uploadBtn resolveMini"
                disabled={busy || !countOk}
                title={countOk
                  ? "Approve this case"
                  : "Open the full list and type the number of rows first"}
                onClick={() => act("approve")}>
                {busy ? "…" : "Approve"}
              </button>
            </>
          ) : (
            <>
              <button className="uploadBtn resolveMini" disabled
                title="You proposed this, someone else must approve">
                Approve
              </button>
              <button className="ghostBtn resolveMini" disabled={busy}
                onClick={() => act("withdraw")}>
                {busy ? "…" : "Withdraw"}
              </button>
            </>
          )}
        </div>
      </div>

      {canDecide && isBatch && (
        <div className="approvalConfirm">
          <span>
            Open the list, then type <b>{fmtInt(n)}</b> to confirm you looked at
            every row:
          </span>
          <input className="cellInput num" style={{ maxWidth: 90 }} value={typed}
            inputMode="numeric" aria-label="Type the number of rows in this batch"
            onChange={(e) => setTyped(e.target.value)} disabled={!seenFull} />
          {!seenFull && <span className="resolveHelp">Open the rows first.</span>}
        </div>
      )}

      {(overPeer || overThreshold || overUnknown) && (
        <div className="cauPanel" style={{ marginTop: 8 }}>
          <div>
            <b>The finance lead has to decide this one.</b>
            {overThreshold && (
              <p>An adjustment here is over RM {limits.adminThreshold.toFixed(2)}.</p>
            )}
            {overUnknown && (
              <p>
                {unknownN === 1 ? "One row here has" : `${fmtInt(unknownN)} rows here have`}
                {" "}an amount that could not be read from the file, so nobody can
                show it is under RM {limits.adminThreshold.toFixed(2)}. The honest
                fix is a clean re-upload, not an approval.
              </p>
            )}
            {overPeer && (
              <p>{fmtInt(n)} rows is over the peer limit of {fmtInt(limits.peerBatchMax)}.</p>
            )}
          </div>
        </div>
      )}

      {openList && (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Row</th><th>Stream</th><th>Status when proposed</th>
                <th className="num">Expected</th><th className="num">Received</th>
                <th className="num">Adjustment</th>
              </tr>
            </thead>
            <tbody>
              {unit.cases.map((c) => (
                <tr key={c.resolutionId}>
                  <td className="cellMain">{shortId(c.subjectId)}</td>
                  <td>{c.stream ?? "—"}</td>
                  <td>{c.category ?? "—"}</td>
                  <td className="num">{c.expected != null ? fmtRM(c.expected) : "—"}</td>
                  {/* Snapshot NULL + hasPayment = "Amount unreadable", bukan
                      RM 0.00 dan bukan "—" (komponen sama macam jadual stream). */}
                  <td className="num">
                    <AmountCell value={c.amount} hasPayment={c.amountUnreadable} />
                  </td>
                  <td className="num">{c.adjustAmount ? fmtRM(c.adjustAmount) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {err && <div className="resolveErr" role="alert">{err}</div>}

      {reply && (
        <div className={reply.changed?.length ? "posPanel" : "danPanel"}
          style={{ marginTop: 10 }}>
          <div>
            <b>
              {reply.changed?.length
                ? `${fmtInt(reply.changed.length)} case${reply.changed.length === 1 ? "" : "s"} ${reply.action ?? "decided"}d.`
                : "Nothing changed."}
            </b>
            {!!reply.seen?.length && (
              <div className="approvalSeen">
                <div className="approvalSeenHead">What you decided on:</div>
                {reply.seen.map((s) => (
                  <div className="approvalSeenRow" key={s.resolutionId}>
                    expected {s.expected != null ? fmtRM(s.expected) : "—"}
                    <span className="sep"> · </span>
                    {/* amount NULL dalam `seen` cuma berlaku bila nilainya
                        gagal dibaca (backbone tak pernah simpan NULL selain
                        itu), jadi ia dinamakan, bukan dipapar "—". */}
                    received {s.amount != null ? fmtRM(s.amount) : AMOUNT_UNREADABLE}
                    <span className="sep"> · </span>
                    adjustment {fmtRM(s.adjustAmount)}
                    <span className="sep"> · </span>
                    fingerprint {(s.fingerprint ?? "").slice(0, 10) || "none"}
                  </div>
                ))}
              </div>
            )}
            {!!reply.failed?.length && (
              <div className="resolveRejects">
                {reply.failed.map((f) => (
                  <div className="resolveRejectRow" key={f.resolutionId}>
                    {whyEnglish(f.why)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
