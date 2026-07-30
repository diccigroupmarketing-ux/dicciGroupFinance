// ====================================================================
// Jenis + penterjemah teks untuk lapisan Resolution DI SISI UI.
//
// Fail ni SENGAJA tulen: tiada import dari lib/resolutions (yang tarik `pg` dan
// `node:crypto`), supaya komponen "use client" boleh guna tanpa memaksa kod
// server masuk bundle browser. Bentuknya cermin struktur backbone, jadi page
// server cuma perlu hantar objek yang sama tanpa memetakan apa apa.
//
// SEMUA teks di sini English penuh (UI English), walaupun komen BM.
// ====================================================================

export type ResolveSide = "order" | "awb";

// Cermin ReasonMeta + kod. Diisi oleh reasonOptions() di sisi server.
export interface ReasonOptionUI {
  code: string;
  label: string;
  side: ResolveSide | "both";
  kelas: string;
  snooze: boolean;
  wajibCounterparty: boolean;
  wajibRef: boolean;
  adminSahaja: boolean;
  minNote: number;
  bolehBatch: boolean;
  // Tooltip khusus (English) kalau backbone sediakan satu. Kosong = borang guna
  // ayat generik ikut kelas/snooze.
  desc?: string;
}

// Nombor dasar datang dari adminThreshold() / peerBatchMax() / pemalar backbone.
// TIADA satu pun daripadanya di-hardcode dalam komponen.
export interface ResolveLimits {
  adminThreshold: number;
  peerBatchMax: number;
  batchHardMax: number;
  maxSnoozeDays: number;
  isAdmin: boolean;
  todayYmd: string;
  actor: string;
}

// Cermin RowResolution (lencana satu baris) dari lib/resolutions.
export interface RowBadgeUI {
  resolutionId: string;
  state: string;
  reason: string;
  reasonLabel: string;
  kelas: string;
  stale: boolean;
  snoozed: boolean;
  expired: boolean;
  settled: boolean;
  by: string | null;
  at: string | null;
  expiresOn: string | null;
  note: string | null;
  adjustAmount: number;
}

// Satu baris yang boleh dicadang untuk resolve. `value` = duit yang terlibat
// (cod_amount kalau ada, kalau tak selling_price), dipakai untuk susunan + pratonton.
export interface ResolveTarget {
  subjectType: ResolveSide;
  subjectId: string;
  stream: string;
  streamName: string;
  title: string;              // order ID atau AWB
  sub: string | null;         // stokis / bil, sekadar konteks
  tracking: string | null;    // paparan sahaja, bukan kunci
  category: string;
  categoryLabel: string;
  amount: number | null;      // duit masuk
  expected: number | null;    // duit dijangka
  value: number;
  ageDays: number | null;
  // PAPARAN sahaja: ada baris bayaran padan (baris bil / statement) untuk baris
  // ni. Bila true DAN amount NULL, maknanya nilai gagal dibaca masa ingest,
  // bukan "tiada bayaran" , lihat components/AmountCell.tsx. Tidak dihantar ke
  // API dan tidak menyentuh apa apa kiraan.
  hasPayment?: boolean;
  badge?: RowBadgeUI;
}

// Satu KES resolution, dirata untuk client (Resolution backbone ada medan
// snapshot + tarikh ISO). Dipakai tab "Awaiting approval" dan "Settled".
export interface CaseUI {
  resolutionId: string;
  subjectType: ResolveSide;
  subjectId: string;
  stream: string | null;
  category: string | null;
  amount: number | null;
  expected: number | null;
  reason: string;
  reasonLabel: string;
  note: string | null;
  adjustAmount: number;
  counterparty: string | null;
  duplicateRef: string | null;
  expiresOn: string | null;
  batchId: string | null;
  batchSize: number;
  state: string;
  proposedBy: string | null;
  proposedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  isSnoozeReason: boolean;
  mine: boolean;
}

// Balasan API (bentuk sama macam route.ts).
export interface ProposeReply {
  ok?: boolean;
  batchId?: string | null;
  created?: { resolutionId: string; subjectType: string; subjectId: string }[];
  rejected?: { subjectType: string; subjectId: string; why: string }[];
  error?: string;
}

export interface DecideReply {
  ok?: boolean;
  action?: string;
  changed?: string[];
  failed?: { resolutionId: string; why: string }[];
  seen?: {
    resolutionId: string; fingerprint: string | null;
    amount: number | null; expected: number | null; adjustAmount: number;
  }[];
  error?: string;
}

// ====================================================================
// Penterjemah sebab tolakan. Enjin backbone bercakap BM (ia rekod kawalan
// dalaman); UI mesti English penuh dan tak boleh telan sebab itu senyap.
// Padanan corak, jadi teks enjin boleh berubah sedikit tanpa memecahkan UI.
// ====================================================================
const WHY_RULES: { test: RegExp; text: string }[] = [
  { test: /bukan baris exception hidup/i,
    text: "This row is no longer an open exception. It may have tallied, moved to another stream, or its file was deleted." },
  { test: /multi line/i,
    text: "This subject still has more than one live line. Resolve it one bill line at a time." },
  { test: /hanya untuk baris sisi order/i,
    text: "That reason only applies to order rows." },
  { test: /hanya untuk baris sisi awb/i,
    text: "That reason only applies to money rows (bill or payment lines)." },
  { test: /tidak munasabah lawan beza/i,
    text: "The adjustment does not fit the difference on this row. It must point the same way and cannot be larger." },
  { test: /kes hidup untuk subjek ni sudah wujud/i,
    text: "Someone else just opened a case on this row." },
  { test: /subjek berganda/i,
    text: "This row was listed twice in the same request." },
  { test: /stream tidak dikenali/i,
    text: "This row carries a stream the engine does not know." },
  { test: /subjectId kosong/i,
    text: "This row has no usable ID to key a decision on." },
  { test: /subjectType mesti/i,
    text: "This row has an unknown subject type." },
  { test: /kes tidak dijumpai/i,
    text: "That case no longer exists." },
  { test: /maker checker/i,
    text: "You proposed this case, so someone else has to decide it." },
  { test: /withdraw hanya untuk pencadang sendiri/i,
    text: "Only the person who proposed a case can withdraw it." },
  { test: /withdraw hanya untuk 'proposed'/i,
    text: "Only a case still waiting for approval can be withdrawn." },
  { test: /keadaan '([a-z]+)'/i,
    text: "This case already moved on, so the action no longer applies." },
];

export function whyEnglish(why: string | null | undefined): string {
  const raw = (why ?? "").trim();
  if (!raw) return "Not accepted.";
  for (const r of WHY_RULES) if (r.test.test(raw)) return r.text;
  return "Not accepted by the engine.";
}

// Ralat peringkat permintaan. Status + konteks -> ayat English yang jujur.
// Kita SENGAJA tidak menghantar semula teks BM mentah ke skrin.
export function apiErrorEnglish(
  status: number,
  raw: string | null | undefined,
  what: "propose" | "decide" | "withdraw",
  limits?: ResolveLimits,
): string {
  const msg = (raw ?? "").toLowerCase();

  if (status === 401) return "Your session expired. Sign in again and retry.";

  if (status === 403) {
    if (/ambang|melebihi ambang/.test(msg) && limits) {
      return `This case is over RM ${limits.adminThreshold.toFixed(2)}, `
        + "it needs approval from the finance lead.";
    }
    if (/had peer|maksimum \d+ baris|batch .* baris/.test(msg) && limits) {
      return `A batch this size (over ${limits.peerBatchMax} rows) has to be decided `
        + "by the finance lead, not a peer.";
    }
    if (/void untuk admin/.test(msg)) {
      return "Only the finance lead can undo a case that is already approved.";
    }
    if (/admin sahaja|wajib diputuskan admin/.test(msg)) {
      return "That reason is reserved for the finance lead.";
    }
    return "You are not allowed to do that. It needs the finance lead.";
  }

  if (status === 409) {
    return what === "propose"
      ? "Nothing was created: these rows were just taken by someone else, or they are no longer open. Refresh to see the latest."
      : "Nothing changed: these cases were just decided by someone else. Refresh to see the latest.";
  }

  if (status === 400) {
    if (/tidak boleh batch/.test(msg)) {
      return "That reason has to be proposed one case at a time.";
    }
    if (/perlu nota/.test(msg)) {
      return "That reason needs a longer note.";
    }
    if (/perlu counterparty/.test(msg)) return "That reason needs a counterparty.";
    if (/perlu duplicate reference/.test(msg)) {
      return "That reason needs the reference of the bill line it duplicates.";
    }
    if (/snooze maksimum/.test(msg) && limits) {
      return `A snooze can run at most ${limits.maxSnoozeDays} days.`;
    }
    if (/expiresOn/i.test(raw ?? "")) {
      return "Pick a snooze date after today.";
    }
    if (/maksimum \d+ item|maksimum \d+ kes/.test(msg) && limits) {
      return `Only ${limits.batchHardMax} rows can go in one request.`;
    }
    if (/items kosong|resolutionIds kosong/.test(msg)) {
      return "Nothing was selected.";
    }
    return "That request was not accepted. Check the reason, the note and the dates.";
  }

  if (status >= 500) {
    return "The server could not record that. Nothing was changed, try again.";
  }
  return "That did not go through. Nothing was changed.";
}

// ====================================================================
// Sebab lalai ikut kategori recon. Tujuannya JIMAT KLIK (satu kes = 3 klik),
// bukan memutuskan untuk manusia: dropdown kekal boleh diubah sepenuhnya.
// ====================================================================
const DEFAULT_REASON: Record<string, string> = {
  hilang_lewat: "awaiting_bill_upload",
  belum_remit: "awaiting_bill_upload",
  belum_bayar: "awaiting_bill_upload",
  amount_mismatch: "processing_fee",
  duit_masuk_order_returned: "partial_or_refund",
  duit_masuk_order_rejected: "partial_or_refund",
  in_bil_tapi_intransit: "data_entry_error",
  takde_awb_jnt: "data_entry_error",
  takde_tracking: "data_entry_error",
  duit_hantu: "awaiting_order_upload",
  match_luar_skop: "belongs_other_entity",
};

export function reasonAllowed(r: ReasonOptionUI, side: ResolveSide | null): boolean {
  if (side == null) return r.side === "both";
  return r.side === "both" || r.side === side;
}

// Sebab pra-pilih untuk satu set baris. Pulang "" kalau tiada calon yang sah
// (contoh: pilihan campur sisi order dan sisi duit).
export function pickDefaultReason(
  targets: ResolveTarget[], options: ReasonOptionUI[],
): string {
  const side = commonSide(targets);
  const usable = options.filter((o) =>
    reasonAllowed(o, side) && (targets.length <= 1 || o.bolehBatch));
  if (usable.length === 0) return "";
  const kats = new Set(targets.map((t) => t.category));
  if (kats.size === 1) {
    const want = DEFAULT_REASON[[...kats][0]];
    if (want && usable.some((o) => o.code === want)) return want;
  }
  return usable[0].code;
}

// Sisi yang dikongsi semua baris terpilih, atau null kalau bercampur.
export function commonSide(targets: ResolveTarget[]): ResolveSide | null {
  const sides = new Set(targets.map((t) => t.subjectType));
  return sides.size === 1 ? ([...sides][0] as ResolveSide) : null;
}

// Beza duit satu baris (masuk tolak dijangka), dibundar 2dp separa ke atas
// mengikut semangat round2() backbone.
export function rowDiff(t: ResolveTarget): number {
  const a = t.amount ?? 0;
  const e = t.expected ?? 0;
  const raw = a - e;
  const sign = raw < 0 ? -1 : 1;
  return (sign * Math.round(Number((Math.abs(raw) * 100).toFixed(6)))) / 100;
}

// Baris ada kes HIDUP (proposed / approved) = tak boleh dicadang lagi.
export function hasLiveCase(t: ResolveTarget): boolean {
  return !!t.badge;
}

// Label ringkas keadaan satu lencana, dipakai chip + tooltip.
export function badgeState(b: RowBadgeUI):
  "waiting" | "settled" | "snoozed" | "expired" | "stale" {
  if (b.state === "proposed") return "waiting";
  if (b.stale) return "stale";
  if (b.expired) return "expired";
  if (b.snoozed) return "snoozed";
  if (b.settled) return "settled";
  return "waiting";
}

export const BADGE_TEXT: Record<ReturnType<typeof badgeState>, string> = {
  waiting: "Waiting for approval",
  settled: "Settled",
  snoozed: "Snoozed",
  expired: "Snooze expired",
  stale: "Reopened, figures changed",
};

export function ymdAdd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-`
    + `${String(t.getUTCDate()).padStart(2, "0")}`;
}
