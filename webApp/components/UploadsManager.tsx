"use client";

// Urus fail upload: senarai fail (dari source_file) + padam per fail.
// Sengaja TIADA padam sekali klik: klik Delete buka panel confirm (checkbox +
// butang akhir), satu fail pada satu masa. Lepas berjaya, refresh data server.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UploadedFile } from "@/lib/recon";
import { fmtInt } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  orders: "Fighter orders", cod: "Courier bill",
  prepaid: "Gateway statement", wallet: "Fighter wallet",
};
const KIND_TONE: Record<string, string> = {
  orders: "chipPos", cod: "chipMut", prepaid: "chipCau", wallet: "chipMut",
};

// "2026-07-09 04:39:13" -> "9 Jul, 04:39"
function fmtStamp(ts: string | null): string {
  if (!ts) return "—";
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return ts;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}, ${m[4]}:${m[5]}`;
}

export default function UploadsManager({ files }: { files: UploadedFile[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<UploadedFile | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const openConfirm = (f: UploadedFile) => {
    setTarget(f); setAck(false); setMsg(null);
  };
  const cancel = () => { setTarget(null); setAck(false); };

  const doDelete = async () => {
    if (!target) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: target.file, confirm: true }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: j.error ?? "delete failed" });
      } else {
        setMsg({
          kind: "ok",
          text: `Removed ${fmtInt(j.removed.total)} rows from "${target.file}". Re-upload the corrected file when ready.`,
        });
        setTarget(null); setAck(false);
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "network error" });
    }
    setBusy(false);
  };

  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">Uploaded files</div>
        <div className="cardHint">{fmtInt(files.length)} file{files.length === 1 ? "" : "s"} in store</div>
        {msg && (
          <span className={"chip " + (msg.kind === "ok" ? "chipPos" : "chipDan")}
                style={{ marginLeft: "auto" }}>
            <span className="cdot" /> {msg.text}
          </span>
        )}
      </div>

      {files.length === 0 ? (
        <div className="cardHint" style={{ padding: "22px 0" }}>
          Nothing uploaded yet. Files appear here as the team uploads them.
        </div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr><th>File</th><th>Type</th><th className="num">Rows</th><th>Last upload</th><th /></tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={`${f.file}·${f.kind}`}>
                  <td className="cellMain" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }}
                      title={f.file}>{f.file}</td>
                  <td>
                    <span className={"chip " + (KIND_TONE[f.kind] ?? "chipMut")}>
                      <span className="cdot" /> {KIND_LABEL[f.kind] ?? f.kind}
                    </span>
                  </td>
                  <td className="num">{fmtInt(f.rows)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtStamp(f.lastAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="dangerBtn" style={{ padding: "5px 12px", fontSize: 12 }}
                            disabled={busy} onClick={() => openConfirm(f)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {target && (
        <div style={{ marginTop: 14 }}>
          <div className="danPanel">
            <svg className="ic" width="17" height="17" viewBox="0 0 20 20" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <path d="M10 7v4m0 3h.01M10 2.5 18 16H2z" />
            </svg>
            <div>
              <b>Delete all data from &quot;{target.file}&quot;?</b>
              <p>This permanently removes the {fmtInt(target.rows)} row{target.rows === 1 ? "" : "s"} that
                came from this file ({KIND_LABEL[target.kind] ?? target.kind}). Dashboards update
                immediately. If the file was only wrong, re-upload the corrected version after ,
                uploads are safe to repeat. This cannot be undone.</p>
            </div>
          </div>
          <label className="confirmRow">
            <input type="checkbox" checked={ack} disabled={busy}
                   onChange={(e) => setAck(e.target.checked)} />
            I understand this permanently deletes the data from this file.
          </label>
          <div className="editorBar">
            <span />
            <button className="ghostBtn" onClick={cancel} disabled={busy}>Cancel</button>
            <button className="dangerBtn" onClick={doDelete} disabled={!ack || busy}>
              {busy ? "Deleting…" : "Delete file data"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
