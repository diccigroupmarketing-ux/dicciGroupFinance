// ====================================================================
// Penghubung SISI SERVER antara backbone Resolution (lib/resolutions.ts) dan
// komponen UI. Fail ni TIDAK ada "use client" dan TIDAK boleh diimport oleh
// komponen client , ia menyentuh DB.
//
// Ia cuma memanggil fungsi yang backbone dah sediakan (resolutionContext /
// decorate / decorateGhostRows / reasonOptions / adminThreshold / peerBatchMax)
// dan menukar hasilnya jadi bentuk props yang selamat dihantar ke client.
// TIADA logik kategori, TIADA kiraan duit baru di sini.
// ====================================================================
import {
  BATCH_HARD_MAX, MAX_SNOOZE_DAYS, adminThreshold, decorate, decorateGhostRows,
  getResolutions, peerBatchMax, reasonOptions, resolutionContext, subjectKeyForExcRow,
  subjectKeyForGhostRow, subjectKeyStr,
  type ResolutionAggregate, type ResolutionContext, type Resolution,
  type ResolvedExcRow, type ResolvedGhostRow,
} from "@/lib/resolutions";
import type { ExcRow, GhostRow, NotCollectedRow, StreamSummary } from "@/lib/recon";
import type {
  CaseUI, ReasonOptionUI, ResolveLimits, ResolveTarget, RowBadgeUI,
} from "@/components/resolveTypes";

export type { CaseUI };

export type { ResolvedGhostRow };

// Senarai sebab untuk borang. UI JANGAN sekali kali hardcode senarai ni.
export function reasonOptionsUI(): ReasonOptionUI[] {
  return reasonOptions().map((r) => ({
    code: r.code, label: r.label, side: r.side, kelas: r.kelas,
    snooze: r.snooze, wajibCounterparty: r.wajibCounterparty,
    wajibRef: r.wajibRef, adminSahaja: r.adminSahaja,
    minNote: r.minNote, bolehBatch: r.bolehBatch,
    desc: r.desc,
  }));
}

// Ambang + had, semua diambil dari backbone (boleh diubah lewat env tanpa deploy).
export function resolveLimits(
  isAdminActor: boolean, todayYmd: string, actor: string,
): ResolveLimits {
  return {
    adminThreshold: adminThreshold(),
    peerBatchMax: peerBatchMax(),
    batchHardMax: BATCH_HARD_MAX,
    maxSnoozeDays: MAX_SNOOZE_DAYS,
    isAdmin: isAdminActor,
    todayYmd,
    actor,
  };
}

// Rangka StreamSummary kosong. Dipakai SEMATA MATA untuk melalukan senarai baris
// melalui decorate() yang sama (satu laluan lencana, bukan salinan kedua logik).
const EMPTY_SUMMARY: StreamSummary = {
  katN: {}, katCod: {}, daily: [],
  integ: [], integN: 0, integRisk: 0,
  aged: [], agedN: 0,
  perBill: [], bills: [],
  linesN: 0, linesCod: 0, linesFee: 0,
  tallyN: 0, tallyCod: 0,
  auditPreview: [], scopedOrders: 0,
  stokisKat: [], otherCouriers: [],
};

// Lencana untuk satu senarai baris exception. Ia melalukan baris melalui
// decorate() YANG SAMA seperti page stream, jadi tiada laluan lencana kedua.
// Turutan baris dikekalkan (decorate guna .map), jadi hasilnya boleh dipakai
// terus menggantikan senarai asal.
export function withBadges(
  rows: ExcRow[], ctx: ResolutionContext,
): ResolvedExcRow[] {
  if (rows.length === 0) return [];
  return decorate({ ...EMPTY_SUMMARY, integ: rows }, ctx).integ;
}

// Versi peta, bila pemanggil perlu mencari lencana ikut kunci subjek.
export function badgesFor(
  rows: ExcRow[], ctx: ResolutionContext,
): Map<string, RowBadgeUI> {
  const out = new Map<string, RowBadgeUI>();
  for (const r of withBadges(rows, ctx)) {
    if (!r.resolution) continue;
    const k = subjectKeyForExcRow(r, ctx.stream);
    if (k) out.set(subjectKeyStr(k), r.resolution);
  }
  return out;
}

// Baris exception -> sasaran resolve untuk UI. Kunci subjek SENTIASA datang dari
// subjectKeyForExcRow() backbone, jadi UI tak pernah mengarang kunci sendiri.
export function targetsFrom(
  rows: ResolvedExcRow[], streamKey: string, streamName: string,
  labelOf: (kat: string) => string,
): ResolveTarget[] {
  const out: ResolveTarget[] = [];
  for (const r of rows) {
    const k = subjectKeyForExcRow(r, streamKey);
    if (!k) continue;
    out.push({
      subjectType: k.subjectType,
      subjectId: k.subjectId,
      stream: streamKey,
      streamName,
      title: r.order_id ?? r.awb ?? "(no id)",
      sub: r.seller_name,
      tracking: r.tracking ?? r.awb,
      category: r.kategori,
      categoryLabel: labelOf(r.kategori),
      amount: r.cod_amount,
      expected: r.selling_price,
      value: r.cod_amount ?? r.selling_price ?? 0,
      ageDays: r.umur_hari,
      // awb bukan NULL = baris bil (COD) atau baris statement (prepaid,
      // order_ref) memang padan. Kalau amount pula NULL, itu nilai gagal dibaca,
      // bukan "belum bayar" , paparan sahaja, tiada kesan pada kiraan.
      hasPayment: r.awb != null,
      badge: r.resolution,
    });
  }
  return out;
}

// Baris "Not collected" (bentuknya lain dari ExcRow) -> ExcRow, supaya ia boleh
// lalu laluan lencana + sasaran yang SAMA. Tiada kategori dikira semula.
export function excFromNotCollected(rows: NotCollectedRow[]): ExcRow[] {
  return rows.map((r) => ({
    order_id: r.order_id, seller_name: r.seller_name, tracking: r.tracking,
    awb: null, kategori: r.kategori, selling_price: r.selling_price,
    cod_amount: null, umur_hari: r.umur_hari,
  }));
}

export function ghostBadges(
  rows: GhostRow[], ctx: ResolutionContext,
): ResolvedGhostRow[] {
  return decorateGhostRows(rows, ctx);
}

// Sasaran resolve untuk jadual "Not collected", dikunci ikut order_id supaya
// jadual client boleh mencarinya selepas menapis / menyusun semula.
export function notCollectedTargets(
  rows: NotCollectedRow[], ctx: ResolutionContext,
  labelOf: (kat: string) => string,
): Record<string, ResolveTarget> {
  const badged = withBadges(excFromNotCollected(rows), ctx);
  const out: Record<string, ResolveTarget> = {};
  rows.forEach((r, i) => {
    if (!r.order_id) return;
    out[r.order_id] = {
      subjectType: "order", subjectId: r.order_id,
      stream: r.streamKey, streamName: r.courier,
      title: r.order_id, sub: r.seller_name, tracking: r.tracking,
      category: r.kategori, categoryLabel: labelOf(r.kategori),
      amount: null, expected: r.selling_price,
      value: r.selling_price ?? 0, ageDays: r.umur_hari,
      // "Not collected" = memang tiada baris duit masuk, jadi amount NULL di
      // sini betul betul bermaksud "tiada bayaran" ("—", bukan gagal dibaca).
      hasPayment: false,
      badge: badged[i]?.resolution,
    };
  });
  return out;
}

// Sasaran resolve untuk jadual "Ghost money". Kunci subjek datang dari
// subjectKeyForGhostRow() backbone (ia yang tahu ruang nama duit).
export function ghostTargets(
  rows: GhostRow[], ctx: ResolutionContext,
  labelOf: (kat: string) => string,
): Record<string, ResolveTarget> {
  const badged = decorateGhostRows(rows, ctx);
  const out: Record<string, ResolveTarget> = {};
  rows.forEach((r, i) => {
    const k = subjectKeyForGhostRow(r);
    if (!k || !r.awb) return;
    out[`${r.streamKey}:${r.awb}`] = {
      subjectType: k.subjectType, subjectId: k.subjectId,
      stream: r.streamKey, streamName: r.courier,
      title: r.awb, sub: r.bill_id, tracking: r.awb,
      category: "duit_hantu", categoryLabel: labelOf("duit_hantu"),
      amount: r.cod_amount, expected: null,
      value: r.cod_amount ?? 0, ageDays: null,
      // Baris ghost SENTIASA datang dari baris duit masuk, jadi amount NULL di
      // sini bermakna nilainya gagal dibaca.
      hasPayment: true,
      badge: badged[i]?.resolution,
    };
  });
  return out;
}

// Gabung beberapa konteks stream jadi SATU, untuk page yang memang bersilang
// kurier (Not collected, Review). Fakta hidup dikunci ikut subjectKeyStr yang
// sudah berruang nama, jadi cantum ni selamat.
export function mergeContexts(
  ctxs: ResolutionContext[], todayYmd: string,
): ResolutionContext {
  const facts = new Map(ctxs.flatMap((c) => [...c.facts]));
  return {
    // 'cod' = ruang nama duit kurier (moneyNs bagi jnt/dhl/ninja). Konteks
    // gabungan ni hanya dipakai untuk baris sisi ORDER dan untuk ghost (yang
    // bawa streamKey sendiri), jadi nilai ni tak menyentuh penamaan CHIP.
    stream: "cod",
    resolutions: ctxs[0]?.resolutions ?? [],
    facts,
    factsLoaded: ctxs.some((c) => c.factsLoaded),
    exceptionN: ctxs.reduce((a, c) => a + c.exceptionN, 0),
    exceptionValue: ctxs.reduce((a, c) => a + c.exceptionValue, 0),
    todayYmd,
  };
}

export async function contextsFor(
  streams: string[], todayYmd: string, pendingDays?: number,
): Promise<ResolutionContext[]> {
  return Promise.all(
    streams.map((s) => resolutionContext(s, todayYmd, pendingDays)));
}

// Jumlah agregat merentas stream. Ia SEMATA MATA penjumlahan medan yang
// decorate() dah kira, bukan kiraan baru.
export function sumAggregates(list: ResolutionAggregate[]): ResolutionAggregate {
  const out: ResolutionAggregate = {
    stream: "all", loaded: list.some((a) => a.loaded), scope: "streamAllTime",
    exceptionN: 0, exceptionValue: 0,
    settledN: 0, settledValue: 0, snoozedN: 0, snoozedValue: 0,
    openN: 0, openValue: 0, proposedN: 0, staleN: 0, expiredN: 0, orphanN: 0,
  };
  for (const a of list) {
    out.exceptionN += a.exceptionN; out.exceptionValue += a.exceptionValue;
    out.settledN += a.settledN; out.settledValue += a.settledValue;
    out.snoozedN += a.snoozedN; out.snoozedValue += a.snoozedValue;
    out.openN += a.openN; out.openValue += a.openValue;
    out.proposedN += a.proposedN; out.staleN += a.staleN;
    out.expiredN += a.expiredN; out.orphanN += a.orphanN;
  }
  return out;
}

// Kes yang MENUNGGU kelulusan. Dipakai lencana sidebar + satu baris kecil
// dashboard. Murah: satu SELECT atas jadual kawalan yang kecil.
export interface PendingApprovals { n: number; value: number }

export async function pendingApprovals(): Promise<PendingApprovals> {
  try {
    const live = await getResolutions();
    const waiting = live.filter((r) => r.state === "proposed");
    const value = waiting.reduce(
      (a, r) => a + Math.abs(r.amountSnapshot ?? r.expectedSnapshot ?? 0), 0);
    return { n: waiting.length, value: Math.round(value * 100) / 100 };
  } catch {
    // Lencana tak pernah boleh merosakkan render page. Diam diam jadi sifar.
    return { n: 0, value: 0 };
  }
}

// Bentuk rata satu kes untuk client (CaseUI ditakrif dalam resolveTypes supaya
// komponen "use client" boleh guna tanpa menarik fail server ni).
export function casesUI(
  list: Resolution[], actor: string, labelOf: (code: string) => string,
  snoozeOf: (code: string) => boolean,
): CaseUI[] {
  const batchCount = new Map<string, number>();
  for (const r of list) {
    if (!r.batchId) continue;
    batchCount.set(r.batchId, (batchCount.get(r.batchId) ?? 0) + 1);
  }
  const me = actor.trim().toLowerCase();
  return list.map((r) => ({
    resolutionId: r.resolutionId,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    stream: r.streamSnapshot,
    category: r.categorySnapshot,
    amount: r.amountSnapshot,
    // Snapshot NULL = amaun tak dapat dibaca masa kes dicadang (lihat
    // lib/resolutions.ts, proposeResolutions). Kes lama sentiasa ada nombor,
    // jadi bendera ni tak pernah menyala palsu untuk kes sedia ada.
    amountUnreadable: r.amountSnapshot == null,
    expected: r.expectedSnapshot,
    reason: r.reason,
    reasonLabel: labelOf(r.reason),
    note: r.note,
    adjustAmount: r.adjustAmount,
    counterparty: r.counterparty,
    duplicateRef: r.duplicateRef,
    expiresOn: r.expiresOn,
    batchId: r.batchId,
    batchSize: r.batchId ? (batchCount.get(r.batchId) ?? 1) : 1,
    state: r.state,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    isSnoozeReason: snoozeOf(r.reason),
    mine: (r.proposedBy ?? "").trim().toLowerCase() === me,
  }));
}
