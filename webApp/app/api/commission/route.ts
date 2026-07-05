// Drill commission satu stokis (on-demand). Terlindung: proxy.ts + guard auth().
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { commissionBreakdown } from "@/lib/recon";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const seller = new URL(req.url).searchParams.get("seller") ?? "";
  if (!seller) {
    return NextResponse.json({ error: "seller diperlukan" }, { status: 400 });
  }
  try {
    const data = await commissionBreakdown(seller);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "gagal" }, { status: 500 });
  }
}
