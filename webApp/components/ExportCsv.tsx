"use client";

// Muat turun baris (array objek) sebagai CSV, sepenuhnya di pelayar guna data
// yang sedia ada di halaman (tiada query baru). Untuk finance kerja exceptions
// dalam Excel.
type Row = Record<string, string | number | null>;

function cell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  // Escape jika ada koma / petikan / baris baru.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ExportCsv({
  rows, columns, filename, label = "Download CSV",
}: {
  rows: Row[];
  columns: { key: string; header: string }[];
  filename: string;
  label?: string;
}) {
  const download = () => {
    const head = columns.map((c) => cell(c.header)).join(",");
    const body = rows.map((r) => columns.map((c) => cell(r[c.key] ?? "")).join(",")).join("\n");
    const csv = head + "\n" + body;
    // BOM supaya Excel kenal UTF-8.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <button className="cardLink" onClick={download} disabled={rows.length === 0}
            title={rows.length === 0 ? "Nothing to export" : `Export ${rows.length} rows`}>
      {label}
    </button>
  );
}
