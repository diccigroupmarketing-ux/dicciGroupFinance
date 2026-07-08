// Simpan mapping SKU (ganti penuh jadual). Terlindung: proxy.ts + guard
// await auth() di sini (defense in depth). Semua ahli team yang sign-in boleh
// edit mapping (fasa sign-in dah buka edit, selari niat Streamlit).
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import { saveSkuMap, addSku, type SkuInput } from "@/lib/mutations";
import { logEvent } from "@/lib/audit";

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
  // Had waras: config SKU tak sepatutnya ribuan. Elak payload besar pegang
  // satu sambungan pool lama lama dalam transaksi tunggal.
  if (body.rows.length > 2000) {
    return NextResponse.json({ error: "terlalu banyak baris SKU (had 2000)" }, { status: 400 });
  }
  if (body.rows.some((r) => r == null || typeof r !== "object")) {
    return NextResponse.json({ error: "setiap baris mesti objek SKU" }, { status: 400 });
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
    revalidateTag("recon", { expire: 0 }); // botol bergantung sku_bottles
    const user = await currentUser();
    await logEvent(user?.primaryEmailAddress?.emailAddress ?? "unknown",
      "sku_save", `${n} SKUs saved`);
    return NextResponse.json({ saved: n });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "simpan gagal" }, { status: 500 });
  }
}

// Tambah SATU SKU baru (dipanggil dari page Free gift). Additive, tak sentuh SKU
// sedia ada. Balas 409 kalau SKU dah wujud (case-insensitive).
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { sku?: string; product_name?: string | null; paid?: number | null; free?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  const sku = String(body.sku ?? "").trim();
  if (!sku) {
    return NextResponse.json({ error: "medan 'sku' diperlukan" }, { status: 400 });
  }

  try {
    await addSku({ sku, product_name: body.product_name, paid: body.paid, free: body.free });
    revalidateTag("recon", { expire: 0 });
    const user = await currentUser();
    await logEvent(user?.primaryEmailAddress?.emailAddress ?? "unknown",
      "sku_add", `${sku} added`);
    return NextResponse.json({ added: sku });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tambah gagal";
    return NextResponse.json({ error: msg }, { status: msg.includes("sudah wujud") ? 409 : 500 });
  }
}
