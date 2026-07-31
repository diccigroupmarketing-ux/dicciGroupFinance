// ============================================================================
// FAIL DIJANA , JANGAN EDIT TANGAN.
// ============================================================================
// Sumber kebenaran konstan kategori recon ialah Python:
//   COD_VALUES, PREPAID_SUCCESS_STATUS  <-  db.py
//   INTEGRITY_EXC, AGED                 <-  reconcile.py
//   KAT_LABEL (dari KAT_LABEL_EN)       <-  theme.py
//
// Dijana oleh scripts/genReconConstants.mjs (dipanggil sebagai prebuild, sama
// corak dengan syncEngine.mjs). Jana semula:
//   node scripts/genReconConstants.mjs
// Guard freshness (banding byte lawan Python): scripts/checkReconConstants.mjs,
// satu langkah dalam `npm test`.
//
// Kenapa dijana, bukan tulis tangan: recon.ts dulu simpan SALINAN literal konstan
// ni dan ia boleh lari senyap dari Python. Sekarang recon.ts import dari sini dan
// fail ni terikat pada Python secara mekanikal, jadi mustahil lari. Nak tukar
// nilai? Tukar di Python, jana semula fail ni.
/* eslint-disable */

export const COD_VALUES: string[] = [
  "COD"
];
export const INTEGRITY_EXC: string[] = [
  "duit_hantu",
  "amount_mismatch",
  "duit_masuk_order_returned",
  "duit_masuk_order_rejected",
  "in_bil_tapi_intransit",
  "takde_awb_jnt",
  "takde_tracking",
  "match_luar_skop"
];
export const AGED: string[] = [
  "hilang_lewat"
];
export const PREPAID_SUCCESS_STATUS: string[] = [
  "paid",
  "success",
  "successful",
  "completed",
  "settled",
  "cleared",
  "captured"
];
export const KAT_LABEL: Record<string, string> = {
  "tally": "Tally",
  "amount_mismatch": "Amount mismatch",
  "duit_hantu": "Ghost money",
  "duit_masuk_order_returned": "Paid, order returned",
  "duit_masuk_order_rejected": "Paid, order rejected",
  "in_bil_tapi_intransit": "In bill, in-transit",
  "takde_awb_jnt": "No J&T AWB",
  "takde_tracking": "No tracking",
  "match_luar_skop": "Out-of-scope match",
  "hilang_lewat": "Overdue / missing",
  "belum_remit": "Awaiting remit",
  "belum_bayar": "Awaiting payment",
  "returned": "Returned",
  "rejected": "Rejected",
  "pending": "Pending"
};
