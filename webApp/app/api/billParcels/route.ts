// Drill parcel satu bil (on-demand bila pengguna buka baris bil). Terlindung:
// proxy.ts + guard await auth(). Baca sahaja (billParcels rollback tmp_m).
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { billParcels, COURIERS, type StreamKey } from "@/lib/recon";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const bill = url.searchParams.get("bill") ?? "";
  if (!Object.prototype.hasOwnProperty.call(COURIERS, key)) {
    return NextResponse.json({ error: "stream tidak sah" }, { status: 400 });
  }
  if (!bill) {
    return NextResponse.json({ error: "bill diperlukan" }, { status: 400 });
  }
  try {
    const rows = await billParcels(key as StreamKey, bill);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "gagal" }, { status: 500 });
  }
}
