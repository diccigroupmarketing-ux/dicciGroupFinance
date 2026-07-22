// Padam data SATU fail upload (fix fail tersalah upload). Semua user finance
// yang sign in boleh guna (mereka betulkan silap sendiri), tapi DESTRUKTIF:
// perlu body {file, confirm:true} + UI dua langkah. Dilog ke audit trail.
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import { deleteUpload } from "@/lib/mutations";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const actor = user?.primaryEmailAddress?.emailAddress ?? "unknown";

  let body: { file?: string; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const file = String(body.file ?? "").trim();
  if (!file) {
    return NextResponse.json({ error: "medan 'file' diperlukan" }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: "confirm:true diperlukan" }, { status: 400 });
  }

  try {
    const removed = await deleteUpload(file);
    revalidateTag("recon", { expire: 0 });
    await logEvent(actor, "upload_delete",
      `${file}: ${removed.total} rows removed (orders ${removed.orders}, bill lines ${removed.billLines}, prepaid ${removed.prepaid}, wallet ${removed.wallet}); ` +
      `conflicts cleared ${removed.conflicts}; ` +
      `orders kept ${removed.ordersKeptShared} shared, ${removed.ordersKeptLegacy} legacy`);
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "padam gagal" }, { status: 500 });
  }
}
