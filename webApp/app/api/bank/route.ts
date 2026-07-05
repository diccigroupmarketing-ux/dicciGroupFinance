// Simpan / padam pengesahan bank per bil. Terlindung: proxy.ts + guard await
// auth() (defense in depth). Semua ahli sign-in boleh sahkan bank.
import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { saveBankDeposit, deleteBankDeposit } from "@/lib/bank";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    bill_id?: string; actual_amount?: number;
    deposited_on?: string | null; note?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  if (!body.bill_id || typeof body.bill_id !== "string") {
    return NextResponse.json({ error: "bill_id diperlukan" }, { status: 400 });
  }
  if (typeof body.actual_amount !== "number" || !Number.isFinite(body.actual_amount)) {
    return NextResponse.json({ error: "actual_amount (nombor) diperlukan" }, { status: 400 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "unknown";

  try {
    await saveBankDeposit({
      bill_id: body.bill_id,
      actual_amount: body.actual_amount,
      deposited_on: body.deposited_on ?? null,
      note: body.note ?? null,
      entered_by: email,
      now: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "simpan gagal" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const billId = new URL(req.url).searchParams.get("bill_id");
  if (!billId) {
    return NextResponse.json({ error: "bill_id diperlukan" }, { status: 400 });
  }
  try {
    await deleteBankDeposit(billId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "padam gagal" }, { status: 500 });
  }
}
