# Liputan CI , apa yang hijau CI sebenarnya jamin

Nota pendek untuk sesi dan manusia akan datang. Baca ni dulu sebelum percaya
"CI hijau, maknanya semua selamat". Ia BUKAN suite penuh.

## Prinsip utama: hijau CI bukan suite penuh

Repo ni PUBLIC. Semua snapshot data SEBENAR (`backups/`, `parityHarness/data/`,
`data/baselineRecon.db`) di-gitignore, jadi CI awam (GitHub Actions) TAK boleh
sentuh data betul. Sebab tu CI cuma jalankan langkah yang boleh DISINTETIKKAN:
sama ada tulen tanpa DB, atau perlu Postgres tapi seed data ciptaan sendiri.

Gate PENUH (22 langkah, parity 3 enjin atas fixture SEBENAR, baseline byte
identik) kekal MANUAL, di mesin yang ada snapshot data sebenar. Hijau CI = subset
sintetik lulus, bukan lebih. `testCi.mjs` sengaja cetak lejar jujur langkah yang
dilangkau supaya tiada siapa tersalah baca hijau CI sebagai "semua ujian lulus".

## Dua laluan, bila guna yang mana

- **Suite penuh lokal**: `cd webApp && npm test` (perlu dev PG 5433 hidup dulu,
  `node scripts/devDb.mjs` di terminal lain). Ini gate rasmi 22 langkah + parity
  3 enjin atas fixture data SEBENAR + baseline. WAJIB lulus sebelum commit apa
  apa perubahan enjin/ingest (lihat `doktrinFleet.md`). MEMADAM data dev PG.
- **Subset CI**: `node scripts/testCi.mjs` (dari `webApp/`, perlu Postgres
  localhost berschema). Ini yang GitHub Actions jalankan (`.github/workflows/ci.yml`).
  Sama juga yang jalan pada tiap push/PR ke `main`. Ia seed data sintetik sendiri,
  tiada snapshot sebenar diperlukan.

Baseline byte identik (berasingan, guna SQLite suci):
`DATABASE_URL="sqlite:///$PWD/data/baselineRecon.db" python3 reconcile.py`
mesti keluar `RM 63,912.00 (369 order)`.

## Apa CI COVER (15 langkah dijalankan)

Tulen sintetik (tiada DB):
1. `check:engine` , salinan `webApp/api/engine` selaras dengan enjin root.
2. `checkReconConstants` , konstan kategori/status selaras merentas 3 enjin.
3. `checkRawQueryRatchet` , injap sehala titik query mentah `webApp/lib` (baca
   fail sumber sahaja, baseline 203).
4. `tsc --noEmit` , semakan jenis TypeScript penuh (typescript dalam devDeps,
   `npm ci` pasang dev deps by default).
5. `testReconEdgeCases.py` , E1 (reconcile.py) vs E2 (reconSql.py), fixture
   sqlite kes tepi duit.
6. `testIngestParsers.py` , parser + guard pintu ingest, fixture sintetik (225 ujian).
7. `testGoldenParity.py` , E1 vs E2 atas fixture emas + assert liputan 15 kategori.

Perlu Postgres tapi seed sendiri:
8. `testReconEdgeCases.ts` , E3 (recon.ts) kes tepi, suntik baris perangkap +
   buang balik (jalan atas DB bersih, sebelum seed golden).
9. `seedGoldenPg` , muat fixture emas SINTETIK ke Postgres (setup untuk parity
   E2 vs E3 di bawah).
10. `parityDump` + 11. `parityCheck` , **parity E2 vs E3** (reconSql.py vs
    recon.ts) baris demi baris atas fixture golden yang cetus SEMUA 15 kategori.
    Ini enjin yang webApp guna di produksi, kini diperiksa hujung ke hujung di CI.
12. `testStockistDetail` , invariant drill stokis recon.ts (read-only).
13. `testBank` , lapisan bank CRUD (guna bil golden, self-clean).
14. `testDateRange` + 15. `testUncollectedRange` , lapisan tapis julat tarikh:
    bukti aggregate ALL_TIME identik dengan output enjin (invariant, read-only).

### Segi tiga parity di CI

Enjin recon ada 3 salinan: E1 `reconcile.py` (rujukan kebenaran), E2
`reconSql.py`, E3 `webApp/lib/recon.ts`. CI kini cover DUA sisi segi tiga secara
sintetik:

- E1 vs E2 : `testGoldenParity.py` (fixture sqlite).
- E2 vs E3 : `seedGoldenPg` + `parityCheck` (fixture SAMA, di Postgres).

Kedua guna `genGoldenFixture` (satu sumber kebenaran untuk data rekaan). Jadi
regresi enjin merentas mana mana sisi ditangkap di CI walau tanpa data sebenar.
Yang TINGGAL manual cuma parity 3 enjin atas fixture DATA SEBENAR (parityHarness).

## Apa CI TAK COVER (6 langkah dilangkau, dan kenapa)

Semua yang tinggal betul betul perlu snapshot data SEBENAR, atau MEMADAM +
pin nombor yang hanya bermakna atas snapshot tu:

- `restore (loadDevDb, backup sebenar)` , CI ganti dengan `seedGoldenPg`
  (sintetik); restore snapshot backup betul tak dijalankan (gitignored).
- `testGifts` , perlu order confirmed > 0 + SKU dipetakan untuk cabang
  byGiftType bergigi. Golden takde `order_skus`, jadi cabang tu tak tercetus
  secara bermakna. Kekal manual (jujur), bukan dipaksa.
- `testMutations` , pin `sku_bottles jangka 9` yang hanya betul atas snapshot
  sebenar; MEMADAM.
- `testUploads` , aliran upload atas data sebenar; MEMADAM.
- `testResolutions` , lapisan Resolution atas data sebenar; MEMADAM + ubah
  sementara satu selling_price.
- `parityHarness (3 enjin, fixture SEBENAR)` , perlu `parityHarness/data/fixture.db`
  + `data/baselineRecon.db` (order sebenar, gitignored). NOTA: parity enjin
  itu sendiri SUDAH dicover sintetik di CI (E1 vs E2 + E2 vs E3); yang tinggal
  cuma parity atas fixture data SEBENAR.

## Lejar semasa

- Dijalankan di CI: **15 langkah** (naik dari 6).
- Dilangkau di CI (perlu data sebenar): **6 langkah** (turun dari 12).
- Suite penuh lokal (`npm test`): **22 langkah** + parity 3 enjin + baseline.

Kalau awak tambah/ubah langkah di `testAll.mjs`, semak sama ada ia boleh
disintetikkan (seed sendiri) dan kemas kini `testCi.mjs` (senarai jalan atau
lejar SKIPPED) + nota ni.
