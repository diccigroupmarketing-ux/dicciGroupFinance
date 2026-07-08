// Data mini page stokis (drill modal), berpenapis tarikh. On-demand (tak di-cache,
// per-arg). Terlindung proxy.ts + guard auth() di sini. Read-only.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { stockistDetail } from "@/lib/recon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const s = (url.searchParams.get("s") ?? "").trim();
  if (!s) {
    return NextResponse.json({ error: "medan 's' diperlukan" }, { status: 400 });
  }
  // Kosong = semua masa (sempadan lebar). Format YYYY-MM-DD.
  const from = (url.searchParams.get("from") || "0001-01-01").slice(0, 10);
  const to = (url.searchParams.get("to") || "9999-12-31").slice(0, 10);

  try {
    const detail = await stockistDetail(s, from, to);
    return NextResponse.json(detail);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "gagal muat data stokis" }, { status: 500 });
  }
}
