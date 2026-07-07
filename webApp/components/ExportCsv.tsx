"use client";

// Muat turun baris (array objek) sebagai CSV, sepenuhnya di pelayar guna data
// yang sedia ada di halaman (tiada query baru). Untuk finance kerja dalam Excel.
// Generik supaya boleh terima interface DAN type alias (elak isu index signature).
function cell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // Escape jika ada koma / petikan / baris baru.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ExportCsv<T>({
  rows, columns, filename, label = "Download CSV", total,
}: {
  rows: readonly T[];
  columns: { key: string; header: string }[];
  filename: string;
  label?: string;
  // Bila set dan lebih besar dari rows.length, butang isyarat "N of M" (view
  // bercap): jujur yang export ni separa, bukan set penuh. Set penuh = undefined.
  total?: number;
}) {
  const download = () => {
    const head = columns.map((c) => cell(c.header)).join(",");
    const body = rows.map((r) =>
      columns.map((c) => cell((r as Record<string, unknown>)[c.key] ?? "")).join(","),
    ).join("\n");
    const csv = head + "\n" + body;
    // BOM supaya Excel kenal UTF-8.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const partial = total != null && total > rows.length;
  const title = rows.length === 0 ? "Nothing to export"
    : partial ? `Export ${rows.length} of ${total} rows shown here (partial, view is capped)`
    : `Export ${rows.length} rows`;

  return (
    <button className="cardLink" onClick={download} disabled={rows.length === 0}
            title={title}>
      {label}{partial ? ` (${rows.length} of ${total})` : ""}
    </button>
  );
}
