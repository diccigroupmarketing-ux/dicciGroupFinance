"use client";

// Tab "Settled & snoozed": sejarah keputusan + rollup ikut sebab.
//
// PERATURAN PAPARAN:
//   , Snoozed dikira dan dipapar BERASINGAN dari settled, sentiasa dengan tarikh
//     luput. Ia BUKAN duit yang selesai, ia cuma soalan yang ditangguh.
//   , Setiap baris menunjukkan siapa cadang, siapa lulus, dan bila.
//   , Label sebab datang dari reasonOptions() backbone (dihantar sebagai props).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate, fmtInt, fmtRM } from "@/lib/format";
import TableFilter from "@/components/TableFilter";
import { AMOUNT_UNREADABLE } from "@/components/AmountCell";
import {
  apiErrorEnglish, whyEnglish,
  type CaseUI, type DecideReply, type ResolveLimits,
} from "@/components/resolveTypes";

// Bila amaun masuk tak dapat dibaca, `amount` NULL, jadi nilai yang dipapar
// datang dari `expected` (yang memang kita tahu). Baris begitu ditanda di skrin
// supaya angka tu tak disalah baca sebagai duit yang disahkan masuk.
function caseValue(c: CaseUI): number {
  return Math.abs(c.amount ?? c.expected ?? 0);
}

function shortId(id: string): string {
  return id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
}

function whenText(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

// Snooze yang tarikhnya sudah lepas terbuka semula. Ia mesti kelihatan begitu di
// sini juga, bukan disorok dalam "settled".
function kindOf(c: CaseUI, todayYmd: string): "settled" | "snoozed" | "expired" {
  if (!c.isSnoozeReason) return "settled";
  if (c.expiresOn && todayYmd > c.expiresOn) return "expired";
  return "snoozed";
}

export default function ReviewSettled({
  cases, limits,
}: {
  cases: CaseUI[];
  limits: ResolveLimits;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");

  const tagged = useMemo(
    () => cases.map((c) => ({ c, kind: kindOf(c, limits.todayYmd) })),
    [cases, limits.todayYmd]);

  const rollup = useMemo(() => {
    const m = new Map<string, {
      label: string; snooze: boolean; n: number; value: number;
    }>();
    for (const { c } of tagged) {
      const cur = m.get(c.reason)
        ?? { label: c.reasonLabel, snooze: c.isSnoozeReason, n: 0, value: 0 };
      cur.n += 1;
      cur.value += caseValue(c);
      m.set(c.reason, cur);
    }
    return [...m.entries()].map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.value - a.value);
  }, [tagged]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tagged.filter(({ c, kind: k }) => {
      if (kind !== "all" && k !== kind) return false;
      if (!needle) return true;
      const hay = `${c.subjectId} ${c.reasonLabel} ${c.note ?? ""} `
        + `${c.proposedBy ?? ""} ${c.decidedBy ?? ""} ${c.stream ?? ""}`;
      return hay.toLowerCase().includes(needle);
    }).sort((a, b) => caseValue(b.c) - caseValue(a.c));
  }, [tagged, q, kind]);

  const settledN = tagged.filter((t) => t.kind === "settled").length;
  const snoozedN = tagged.filter((t) => t.kind === "snoozed").length;
  const expiredN = tagged.filter((t) => t.kind === "expired").length;

  if (cases.length === 0) {
    return (
      <div className="emptyCard">
        <div className="big">Nothing settled or snoozed yet</div>
        Approved cases land here with the full trail: who proposed it, who approved
        it, and when.
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="cardHead">
          <div className="cardTitle">By reason</div>
          <div className="cardHint">
            {fmtInt(settledN)} settled · {fmtInt(snoozedN)} snoozed
            {expiredN > 0 ? ` · ${fmtInt(expiredN)} snooze expired` : ""}
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Reason</th><th>Kind</th>
                <th className="num">Cases</th><th className="num">Value involved</th>
              </tr>
            </thead>
            <tbody>
              {rollup.map((r) => (
                <tr key={r.code}>
                  <td className="cellMain">{r.label}</td>
                  <td>
                    <span className={"chip " + (r.snooze ? "chipCau" : "chipPos")}>
                      <span className="cdot" /> {r.snooze ? "Snooze" : "Settled"}
                    </span>
                  </td>
                  <td className="num">{fmtInt(r.n)}</td>
                  <td className="num">{fmtRM(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cardHint" style={{ marginTop: 8 }}>
          Value involved is the money on those rows. It is shown so the size of what
          was closed is visible: none of it moved any total.
          {tagged.some(({ c }) => c.amountUnreadable) && (
            <> Rows marked “{AMOUNT_UNREADABLE}” count the expected value instead,
              because the amount received could not be read from the file.</>
          )}
        </div>
      </div>

      <div className="sectionGap" />

      <div className="card">
        <div className="cardHead" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="cardTitle">Decision trail</div>
          <TableFilter placeholder="Find row / person / note…" value={q} onChange={setQ} />
          <div className="segRow" role="group" aria-label="Filter kind">
            {[["all", "All"], ["settled", "Settled"], ["snoozed", "Snoozed"],
              ["expired", "Snooze expired"]].map(([k, label]) => (
              <button key={k} className={"segBtn" + (kind === k ? " active" : "")}
                onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Row</th><th>Reason</th><th>Proposed by</th><th>Approved by</th>
                <th className="num">Value</th><th>Until</th>
                {limits.isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ c, kind: k }) => (
                <tr key={c.resolutionId}>
                  <td className="cellMain">{shortId(c.subjectId)}
                    <div className="cellSub">{c.stream ?? "—"} · {c.category ?? "—"}</div>
                  </td>
                  <td>
                    <span className={"chip " + (k === "settled" ? "chipPos"
                      : k === "snoozed" ? "chipCau" : "chipDan")}>
                      <span className="cdot" /> {c.reasonLabel}
                    </span>
                    {c.note && <div className="cellSub">“{c.note}”</div>}
                  </td>
                  <td>{c.proposedBy ?? "—"}
                    <div className="cellSub">{whenText(c.proposedAt)}</div>
                  </td>
                  <td>{c.decidedBy ?? "—"}
                    <div className="cellSub">{whenText(c.decidedAt)}</div>
                  </td>
                  <td className="num">{fmtRM(caseValue(c))}
                    {c.amountUnreadable && (
                      <div className="cellSub amtUnread">{AMOUNT_UNREADABLE}</div>
                    )}
                  </td>
                  <td>
                    {c.expiresOn
                      ? <span className={k === "expired" ? "expiredOn" : undefined}>
                          {fmtDate(c.expiresOn)}
                        </span>
                      : "—"}
                  </td>
                  {limits.isAdmin && (
                    <td><VoidButton id={c.resolutionId} limits={limits} /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <div className="cellMuted">Nothing matches these filters.</div>
        )}
        <div className="cardHint" style={{ marginTop: 8 }}>
          Rejected and withdrawn cases are not listed here. They stay in the
          append-only event trail against the row they belong to.
        </div>
      </div>
    </>
  );
}

// Undo satu keputusan yang sudah lulus. Admin sahaja (backbone kuatkuasa juga).
function VoidButton({ id, limits }: { id: string; limits: ResolveLimits }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/resolutions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutionIds: [id], action: "void" }),
      });
      const j: DecideReply = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(apiErrorEnglish(res.status, j.error, "decide", limits));
      else if (j.failed?.length) setMsg(whyEnglish(j.failed[0].why));
      else router.refresh();
    } catch {
      setMsg("Network problem. Nothing was changed.");
    }
    setBusy(false);
  };

  if (msg) return <span className="resolveCellMsg">{msg}</span>;
  return armed ? (
    <span className="resolveCell">
      <button className="cardLink" onClick={go} disabled={busy}>
        {busy ? "…" : "Confirm undo"}
      </button>
      <button className="cardLink" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  ) : (
    <button className="cardLink" onClick={() => setArmed(true)}
      title="Undo this decision, the row goes back to open">Undo</button>
  );
}
