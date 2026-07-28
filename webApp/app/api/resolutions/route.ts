// Lapisan Resolution , cadang / putus / tarik balik "settle" baris exception.
// Terlindung: proxy.ts + guard `await auth()` (defense in depth).
//
// PRINSIP MUTLAK: tiada satu pun laluan di sini menggerakkan duit. Semua tulisan
// masuk recon_resolutions + recon_resolution_events sahaja (lihat lib/resolutions.ts).
//
// SENGAJA TIADA revalidateTag("recon"): tulisan kecil (settle satu baris) tak
// patut buang cache agregat yang mahal untuk semua orang. Klien guna
// router.refresh() selepas berjaya , overlay dibaca tanpa cache (getResolutions),
// jadi ia memang segar.
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/mutations";
import { logEvent } from "@/lib/audit";
import { reconTodayYmd } from "@/lib/recon";
import {
  ResolutionError, decideResolutions, proposeResolutions, withdrawResolutions,
  type DecideAction, type ProposeItem, type ReasonCode,
} from "@/lib/resolutions";

export const runtime = "nodejs";

interface Actor { email: string; admin: boolean }

async function actorOf(): Promise<Actor | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "unknown";
  return { email, admin: isAdmin(email) };
}

// Ralat berstruktur -> status betul; selain tu 500 (jangan bocorkan dalaman).
function errorResponse(e: unknown) {
  if (e instanceof ResolutionError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("resolutions route gagal", e);
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "gagal" }, { status: 500 });
}

// ====================================================================
// POST , cadang (maker). Balas 409 kalau SEMUA item ditolak sebab kes hidup
// sudah wujud (dua maker berlumba subjek sama).
// ====================================================================
export async function POST(req: Request) {
  const actor = await actorOf();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    items?: ProposeItem[]; reason?: ReasonCode; note?: string | null;
    adjustAmount?: number | null; counterparty?: string | null;
    duplicateRef?: string | null; expiresOn?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "items (array) diperlukan" }, { status: 400 });
  }

  try {
    const out = await proposeResolutions({
      items: body.items,
      reason: body.reason as ReasonCode,
      note: body.note ?? null,
      adjustAmount: body.adjustAmount ?? 0,
      counterparty: body.counterparty ?? null,
      duplicateRef: body.duplicateRef ?? null,
      expiresOn: body.expiresOn ?? null,
      actor: actor.email,
      isAdminActor: actor.admin,
      now: new Date().toISOString(),
      todayYmd: reconTodayYmd(),
    });
    // logEvent = CERMIN untuk feed Activity sahaja. Ia menelan error dan potong
    // detail 500 aksara (lib/audit.ts), jadi ia TAK BOLEH jadi rekod kawalan.
    // Rekod kawalan sebenar = recon_resolution_events, ditulis dalam transaksi
    // yang sama dengan perubahan keadaan. Dipanggil SELEPAS commit; kalau ia
    // gagal, tiada apa yang di-rollback.
    if (out.created.length) {
      await logEvent(actor.email, "resolution_propose",
        `${out.created.length} proposed (${body.reason})`
        + (out.batchId ? ` batch ${out.batchId}` : ""));
    }
    const status = out.created.length === 0 && out.rejected.length > 0 ? 409 : 200;
    return NextResponse.json({ ok: out.created.length > 0, ...out }, { status });
  } catch (e) {
    return errorResponse(e);
  }
}

// ====================================================================
// PATCH , putus (checker). approve / reject / void.
// ====================================================================
export async function PATCH(req: Request) {
  const actor = await actorOf();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { resolutionIds?: string[]; action?: DecideAction; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  if (!Array.isArray(body.resolutionIds)) {
    return NextResponse.json(
      { error: "resolutionIds (array) diperlukan" }, { status: 400 });
  }

  try {
    const out = await decideResolutions({
      resolutionIds: body.resolutionIds,
      action: body.action as DecideAction,
      note: body.note ?? null,
      actor: actor.email,
      isAdminActor: actor.admin,
      now: new Date().toISOString(),
    });
    if (out.changed.length) {
      await logEvent(actor.email, `resolution_${out.action}`,
        `${out.changed.length} ${out.action}d`);
    }
    const status = out.changed.length === 0 && out.failed.length > 0 ? 409 : 200;
    return NextResponse.json({ ok: out.changed.length > 0, ...out }, { status });
  } catch (e) {
    return errorResponse(e);
  }
}

// ====================================================================
// DELETE , tarik balik (maker sendiri, kes 'proposed' sahaja).
// ====================================================================
export async function DELETE(req: Request) {
  const actor = await actorOf();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { resolutionIds?: string[]; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  if (!Array.isArray(body.resolutionIds)) {
    return NextResponse.json(
      { error: "resolutionIds (array) diperlukan" }, { status: 400 });
  }

  try {
    const out = await withdrawResolutions({
      resolutionIds: body.resolutionIds,
      actor: actor.email,
      now: new Date().toISOString(),
      note: body.note ?? null,
    });
    if (out.changed.length) {
      await logEvent(actor.email, "resolution_withdraw",
        `${out.changed.length} withdrawn`);
    }
    const status = out.changed.length === 0 && out.failed.length > 0 ? 409 : 200;
    return NextResponse.json({ ok: out.changed.length > 0, ...out }, { status });
  } catch (e) {
    return errorResponse(e);
  }
}
