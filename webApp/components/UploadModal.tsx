"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type FileResult = {
  name: string;
  state: "pending" | "busy" | "done" | "unknown" | "error";
  detail: string;
};

const KIND_LABEL: Record<string, string> = {
  fighter: "Fighter orders",
  jnt: "J&T COD bill",
  dhl: "DHL payment advice",
  ninja: "Ninja Van SOA",
  chip: "CHIP statement",
  wallet: "Fighter Wallet",
};

export default function UploadModal() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<FileResult[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  // Escape untuk tutup (bila tak busy) + pindah fokus ke dialog bila buka,
  // pulang ke butang pencetus bila tutup. Keyboard/screen-reader boleh guna.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      triggerRef.current?.focus();
    };
  }, [open, busy]);

  const reset = () => { setFiles([]); setResults([]); };

  const ingest = async () => {
    setBusy(true);
    const out: FileResult[] = files.map((f) => ({
      name: f.name, state: "pending", detail: "queued",
    }));
    setResults([...out]);
    for (let i = 0; i < files.length; i++) {
      out[i] = { ...out[i], state: "busy", detail: "ingesting…" };
      setResults([...out]);
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "x-filename": encodeURIComponent(files[i].name) },
          body: files[i],
        });
        const j = await res.json();
        if (!res.ok) {
          out[i] = { ...out[i], state: "error", detail: j.error ?? "failed" };
        } else if (!j.kind) {
          out[i] = { ...out[i], state: "unknown", detail: "format not recognised · nothing written" };
        } else {
          out[i] = {
            ...out[i], state: "done",
            detail: `${KIND_LABEL[j.kind] ?? j.kind} · ${j.rows} rows`,
          };
        }
      } catch {
        out[i] = { ...out[i], state: "error", detail: "network error" };
      }
      setResults([...out]);
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <>
      <button ref={triggerRef} className="uploadBtn" onClick={() => setOpen(true)} title="Upload data">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 14V4m0 0L6 8m4-4 4 4M4 16.5h12" />
        </svg>
        <span className="uploadTxt">Upload data</span>
      </button>

      {/* Portal ke body: sidebar ada sticky + overflow (stacking context sendiri),
          modal fixed di dalamnya akan terperangkap belakang kandungan (bug Safari). */}
      {open && createPortal(
        <div className="modalBack" onClick={() => !busy && setOpen(false)}>
          <div ref={dialogRef} tabIndex={-1} className="modal" onClick={(e) => e.stopPropagation()}
               role="dialog" aria-modal="true" aria-label="Upload data">
            <div className="cardHead">
              <div className="cardTitle">Upload data</div>
              <button className="cardLink" onClick={() => !busy && setOpen(false)}>Close</button>
            </div>
            <p className="modalNote">
              Fighter export, courier bill (J&T / DHL / Ninja Van), CHIP statement or
              Fighter Wallet. The type is detected automatically, re-uploading the
              same file never double counts.
            </p>

            <button
              className="dropZone"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {files.length
                ? `${files.length} file${files.length > 1 ? "s" : ""} selected`
                : "Choose files (.xlsx / .xls / .csv)"}
            </button>
            <input
              ref={inputRef} type="file" multiple hidden
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []));
                setResults([]);
              }}
            />

            {files.length > 0 && (
              <div className="fileList">
                {files.map((f, i) => {
                  const r = results[i];
                  return (
                    <div className="fileRow" key={f.name + i}>
                      <span className="fileName">{f.name}</span>
                      {r ? (
                        <span className={
                          r.state === "done" ? "chip chipPos"
                            : r.state === "error" ? "chip chipDan"
                            : r.state === "unknown" ? "chip chipCau"
                            : "chip chipMut"
                        }>
                          <span className="cdot" /> {r.detail}
                        </span>
                      ) : (
                        <span className="chip chipMut"><span className="cdot" /> ready</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="modalWarn">
              ⚠ Upload only the <b>latest full export</b>. An older or filtered file
              overwrites current order status, tracking and price.
            </p>

            <div className="modalActions">
              <button className="ghostBtn" onClick={reset} disabled={busy || !files.length}>
                Clear
              </button>
              <button className="uploadBtn" style={{ flex: 1 }}
                onClick={ingest} disabled={busy || !files.length}>
                {busy ? "Ingesting…" : "Ingest"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
