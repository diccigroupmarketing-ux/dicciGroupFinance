// Reset store: padam SEMUA data transaksi (kekal mapping SKU). DESTRUKTIF,
// admin sahaja (email dalam ADMIN_EMAILS). Perlu body {confirm:true} supaya
// tak ter-trigger sengaja.
// Kill-switch env: dimatikan melainkan ALLOW_STORE_RESET=1 (prod Vercel tak set, jadi data prod selamat).
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import { resetStore, isAdmin } from "@/lib/mutations";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  if (!isAdmin(email)) {
    return NextResponse.json({ error: "forbidden , admin sahaja" }, { status: 403 });
  }
  if (process.env.ALLOW_STORE_RESET !== "1") {
    return NextResponse.json(
      { error: "reset dimatikan pada environment ini , set ALLOW_STORE_RESET=1 untuk benarkan" },
      { status: 403 });
  }

  let body: { confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: "confirm:true diperlukan" }, { status: 400 });
  }

  try {
    await resetStore();
    revalidateTag("recon", { expire: 0 });
    await logEvent(email ?? "unknown", "store_reset", "all transaction data cleared");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reset gagal" }, { status: 500 });
  }
}
