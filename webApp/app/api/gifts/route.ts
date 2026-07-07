// Simpan free gift untuk SATU SKU (ganti penuh gift SKU tu). Terlindung proxy.ts
// + guard auth() di sini. Semua ahli team sign-in boleh edit (selari SKU editor).
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import { saveGifts, type GiftInput } from "@/lib/mutations";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { sku?: string; gifts?: GiftInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }

  const sku = String(body.sku ?? "").trim();
  if (!sku) {
    return NextResponse.json({ error: "medan 'sku' diperlukan" }, { status: 400 });
  }
  if (!Array.isArray(body.gifts)) {
    return NextResponse.json({ error: "medan 'gifts' (array) diperlukan" }, { status: 400 });
  }
  if (body.gifts.length > 50) {
    return NextResponse.json({ error: "terlalu banyak gift untuk satu SKU (had 50)" }, { status: 400 });
  }
  if (body.gifts.some((g) => g == null || typeof g !== "object")) {
    return NextResponse.json({ error: "setiap gift mesti objek" }, { status: 400 });
  }

  // Tolak nama gift berganda dalam satu SKU (PK sku, gift_name).
  const seen = new Set<string>();
  for (const g of body.gifts) {
    const k = String(g?.gift_name ?? "").trim().toUpperCase();
    if (!k) continue;
    if (seen.has(k)) {
      return NextResponse.json({ error: `gift berganda: ${k}` }, { status: 400 });
    }
    seen.add(k);
  }

  try {
    const n = await saveGifts(sku, body.gifts);
    revalidateTag("recon", { expire: 0 }); // kos giveaway bergantung sku_gifts
    const user = await currentUser();
    await logEvent(user?.primaryEmailAddress?.emailAddress ?? "unknown",
      "gift_save", `${sku}: ${n} gifts`);
    return NextResponse.json({ saved: n });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "simpan gagal" }, { status: 500 });
  }
}
