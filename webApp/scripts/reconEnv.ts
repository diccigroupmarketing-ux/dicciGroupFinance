// Side-effect: kunci RECON_TODAY SEBELUM recon dipakai (parity deterministik).
//
// recon.ts kini kira tarikh secara lazy dalam reconToday() (bukan lagi const
// eager masa modul load), jadi env cuma perlu ditetapkan sebelum panggilan
// reconToday() PERTAMA. Import fail ini DULU (sebelum ../lib/recon) kekal cara
// paling selamat supaya env terkunci sebelum sebarang query recon jalan.
// `??=` hormat env sedia ada (cth testAll.mjs yang sudah suntik
// RECON_TODAY=2026-06-18 ke child).
process.env.RECON_TODAY ??= "2026-06-18";
