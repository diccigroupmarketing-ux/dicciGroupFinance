// Simpan mapping SKU (ganti penuh jadual). Terlindung: proxy.ts + guard
// await auth() di sini (defense in depth). Semua ahli team yang sign-in boleh
// edit mapping (fasa sign-in dah buka edit, selari niat Streamlit).
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { saveSkuMap, type SkuInput } from "@/lib/mutations";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { rows?: SkuInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: "medan 'rows' (array) diperlukan" }, { status: 400 });
  }

  // Tolak SKU pendua (huruf besar/kecil dikira sama sebab join guna UPPER(TRIM)).
  const seen = new Set<string>();
  for (const r of body.rows) {
    const key = String(r?.sku ?? "").trim().toUpperCase();
    if (!key) continue;
    if (seen.has(key)) {
      return NextResponse.json(
        { error: `SKU berganda: ${key}` }, { status: 400 });
    }
    seen.add(key);
  }

  try {
    const n = await saveSkuMap(body.rows);
    return NextResponse.json({ saved: n });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "simpan gagal" }, { status: 500 });
  }
}
