// Side-effect: kunci RECON_TODAY SEBELUM modul recon dinilai.
//
// recon.ts menetapkan `export const TODAY = computeToday()` pada masa modul
// dimuatkan (eager). Import ES dihoist dan dinilai dahulu, jadi menetapkan
// process.env.RECON_TODAY dalam BADAN parityCheck.ts terlambat (recon sudah
// dinilai). Fail ini mesti diimport DULU (sebelum import ../lib/recon) supaya
// env dikunci sebelum recon menghitung TODAY. `??=` hormat env sedia ada
// (cth testAll.mjs yang sudah suntik RECON_TODAY=2026-06-18 ke child).
process.env.RECON_TODAY ??= "2026-06-18";
