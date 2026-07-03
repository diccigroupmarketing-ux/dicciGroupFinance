// Penerima upload dari browser. Browser TIDAK pernah pegang token; route ni
// (server-side) yang tambah token bila forward ke function Python.
//   Produksi : forward ke /api/pyIngest (Python function, parser sebenar).
//   Dev      : INGEST_MODE=local -> panggil python3 scripts/devIngest.py
//              (enjin rujukan root repo, tulis ke dev Postgres embedded).
import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // had body function Vercel ~4.5MB

export async function POST(req: Request) {
  const filename = decodeURIComponent(req.headers.get("x-filename") ?? "");
  if (!filename) {
    return NextResponse.json({ error: "x-filename header diperlukan" }, { status: 400 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) {
    return NextResponse.json({ error: "fail kosong" }, { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "fail melebihi 4MB, pecahkan export kepada tempoh lebih kecil" },
      { status: 413 },
    );
  }

  if (process.env.INGEST_MODE === "local") {
    const dir = mkdtempSync(join(tmpdir(), "dicciUp-"));
    const tmp = join(dir, "upload.bin");
    try {
      writeFileSync(tmp, buf);
      const res = spawnSync("python3", ["scripts/devIngest.py", tmp, filename], {
        cwd: process.cwd(), encoding: "utf8", timeout: 120_000,
        env: { ...process.env },
      });
      const line = (res.stdout ?? "").trim().split("\n").pop() ?? "";
      try {
        const parsed = JSON.parse(line);
        return NextResponse.json(parsed, { status: parsed.error ? 500 : 200 });
      } catch {
        return NextResponse.json(
          { error: (res.stderr ?? "ingest gagal").slice(-300) }, { status: 500 });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const token = process.env.UPLOAD_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "UPLOAD_TOKEN belum diset di server" }, { status: 503 });
  }
  const target = new URL("/api/pyIngest", req.url);
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "x-upload-token": token,
      "x-filename": encodeURIComponent(filename),
      "content-type": "application/octet-stream",
    },
    body: buf,
  });
  const payload = await res.json().catch(() => ({ error: "respons tidak sah dari enjin ingest" }));
  return NextResponse.json(payload, { status: res.status });
}
