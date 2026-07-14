"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Counts = { orders: number; billLines: number; wallet: number };

export default function StoreDanger({ counts, resetEnabled }: { counts: Counts; resetEnabled: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reset = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: j.error ?? "reset gagal" });
      } else {
        setMsg({ kind: "ok", text: "Store cleared. SKU mapping kept." });
        setConfirm(false);
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "network error" });
    }
    setBusy(false);
  };

  return (
    <div className="card dangerCard">
      <div className="cardHead">
        <div className="cardTitle">Store admin</div>
        <div className="cardHint">Admin only</div>
        {msg && (
          <span className={"chip " + (msg.kind === "ok" ? "chipPos" : "chipDan")}
                style={{ marginLeft: "auto" }}>
            <span className="cdot" /> {msg.text}
          </span>
        )}
      </div>

      <p className="modalNote" style={{ marginTop: 2 }}>
        Current store: <b>{counts.orders.toLocaleString()}</b> orders ·{" "}
        <b>{counts.billLines.toLocaleString()}</b> bill lines ·{" "}
        <b>{counts.wallet.toLocaleString()}</b> wallet txns.
      </p>

      <div className="danPanel">
        <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none"
             stroke="currentColor" strokeWidth="2">
          <path d="M10 7v4m0 3h.01M10 2.5 18 16H2z" />
        </svg>
        <div>
          {resetEnabled ? (
            <>
              <b>Reset clears all uploaded data.</b>
              <p>Orders, courier bills, and wallet transactions are permanently
                deleted. The SKU mapping above is kept. This cannot be undone.</p>
            </>
          ) : (
            <>
              <b>Reset disabled on this environment.</b>
              <p>Set ALLOW_STORE_RESET=1 to enable (dev only). Production keeps
                this off so finance data can never be wiped.</p>
            </>
          )}
        </div>
      </div>

      <label className="confirmRow">
        <input type="checkbox" checked={confirm}
               onChange={(e) => setConfirm(e.target.checked)} disabled={busy || !resetEnabled} />
        I understand this permanently deletes all uploaded data.
      </label>

      <div className="editorBar">
        <span />
        <button className="dangerBtn" onClick={reset} disabled={!confirm || busy || !resetEnabled}>
          {busy ? "Resetting…" : "Reset store"}
        </button>
      </div>
    </div>
  );
}
