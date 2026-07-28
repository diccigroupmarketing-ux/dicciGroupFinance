// Drill parcel satu bil (on-demand bila pengguna buka baris bil). Terlindung:
// proxy.ts + guard await auth(). Baca sahaja (billParcels rollback tmp_m).
//
// Balasan bawa DUA senarai yang SEJAJAR (indeks sama):
//   rows[i]    , baris parcel mentah dari enjin (angka TIDAK disentuh)
//   targets[i] , sasaran Resolution untuk baris itu, atau null kalau baris tu
//                memang tak boleh diresolve (contoh 'tally', atau tiada id).
// Sejajar ikut indeks supaya UI tak perlu mengarang kunci subjek sendiri ,
// kunci itu sentiasa datang dari backbone (subjectKeyForExcRow).
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  billParcels, COURIERS, KAT_LABEL, reconTodayYmd,
  type BillParcel, type ExcRow, type StreamKey,
} from "@/lib/recon";
import { RESOLVABLE_KATS, resolutionContext } from "@/lib/resolutions";
import { targetsFrom, withBadges } from "@/components/resolveServer";
import type { ResolveTarget } from "@/components/resolveTypes";

export const runtime = "nodejs";

// Overlay Resolution untuk parcel dalam SATU bil. Ia menambah label sahaja:
// tiada angka duit dikira semula di sini, dan enjin recon langsung tak disentuh.
//
// Kos: resolutionContext() mula dengan COUNT kecil atas jadual kawalan, jadi
// bila TIADA kes hidup ia pulang konteks kosong tanpa membina tmp_m kedua.
// Bila ada kes hidup barulah fakta stream dibaca (sekali, on-demand per drill).
async function parcelTargets(
  key: StreamKey, streamName: string, rows: BillParcel[],
): Promise<(ResolveTarget | null)[]> {
  const out: (ResolveTarget | null)[] = rows.map(() => null);
  // Hanya kategori yang backbone memang terima. Baris tally (dan apa apa yang
  // luar senarai ni) tak pernah dapat butang, sebab propose akan ditolak.
  const idx: number[] = [];
  const excs: ExcRow[] = [];
  rows.forEach((p, i) => {
    if (!RESOLVABLE_KATS.includes(p.kategori)) return;
    idx.push(i);
    excs.push({
      order_id: p.order_id, seller_name: p.seller_name,
      // BillParcel tak bawa tracking Fighter; targetsFrom akan fallback ke awb.
      tracking: null, awb: p.awb, kategori: p.kategori,
      selling_price: p.selling_price, cod_amount: p.cod_amount,
      // Umur order tiada dalam baris bil (paparan sahaja, bukan syarat resolve).
      umur_hari: null,
    });
  });
  if (excs.length === 0) return out;

  const ctx = await resolutionContext(key, reconTodayYmd());
  const badged = withBadges(excs, ctx);
  badged.forEach((r, j) => {
    const t = targetsFrom([r], key, streamName, (k) => KAT_LABEL[k] ?? k)[0];
    if (t) out[idx[j]] = t;
  });
  return out;
}

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
    let targets: (ResolveTarget | null)[] = rows.map(() => null);
    try {
      targets = await parcelTargets(key as StreamKey, COURIERS[key as StreamKey].name, rows);
    } catch {
      // Lapisan label tak pernah boleh merosakkan paparan parcel. Kalau jadual
      // kawalan bermasalah, drill tetap keluar, cuma tanpa butang Resolve.
      targets = rows.map(() => null);
    }
    return NextResponse.json({ rows, targets });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "gagal" }, { status: 500 });
  }
}
