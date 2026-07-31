# Inventori Divergen 3 Enjin Recon

Dokumen ni langkah pertama tangga 2 "satu gudang" (proposal d22e5a): satukan 3 enjin
recon jadi 1. Sebelum boleh satukan, kita kena tahu DENGAN TEPAT di mana ketiga tiga
enjin dah lari sesama sendiri. Dokumen ni inventori sahaja, SIFAR perubahan kod.

Analogi ringkas: bayangkan 3 orang kira duit guna 3 buku nota berasingan. Sepatutnya
salin ayat demi ayat dari buku "rujukan kebenaran", tapi lama lama ada ayat tertinggal
masa salin. Dokumen ni senaraikan setiap ayat yang tertinggal atau berubah, supaya
bila kita gabung jadi satu buku, tiada silap kira duit yang terbawa masuk.

---

## Keputusan bentuk akhir (2026-07-31, owner ratifikasi Pilihan 1)

Selepas semua divergen ditutup (D1 hingga D9, lihat bawah), owner ratifikasi
**Pilihan 1** untuk bentuk akhir tiga enjin. Ini keputusan tetap, bukan lagi
cadangan. Peranan kanonik:

| Enjin | Fail | Peranan MUKTAMAD |
|---|---|---|
| E3 | `webApp/lib/recon.ts` | **ENJIN PRODUKSI KANONIK** , yang app LIVE jalankan runtime |
| E1 | `reconcile.py` | **ORACLE beku** , rujukan kebenaran + jana baseline + gate parity (CLI/ujian sahaja, BUKAN runtime) |
| E2 | `reconSql.py` | **BEKU** , bersara bersama Streamlit di tangga 5 |

**Peta consumer sebenar** (disahkan lewat grep, bukan andaian):

- `app.py` (Streamlit) guna **reconSql sahaja** untuk recon (`stream_summary`,
  `bill_parcels`, `stockist_bottles`, dll). `reconcile` diimport di `app.py`
  tapi HANYA masuk tuple `_PROJECT_MODULES` untuk handshake self-heal, TIDAK
  dipanggil untuk kira recon.
- `webApp` (Next.js LIVE) guna **recon.ts sahaja** (`@/lib/recon`), tiada laluan
  Python recon di runtime. Fungsi `/api/pyIngest` guna salinan `api/engine` untuk
  INGEST, bukan recon.
- `reconcile.py` = **oracle**, dipanggil hanya dari CLI (`python reconcile.py`,
  jana baseline) dan ujian (`testReconEdgeCases.py` E1 lawan E2, harness parity).

**Kenapa Pilihan 1 (bukan gabung terus jadi satu fail)**: recon.ts sudah jadi
laluan produksi sebenar (Vercel LIVE), jadi menjadikan ia kanonik = sifar migrasi
consumer. reconcile.py pandas tulen kekal jadi oracle sebab ia paling senang
dibaca manusia dan jadi buku rujukan yang jujur. reconSql.py tak dibuang SEKARANG
sebab app.py Streamlit masih hidup (soft-retire) dan ia jadi jaring E2 dalam
harness 3 enjin.

**Fasa yang DITANGGUH** (bukan dibatalkan, cuma belum masanya):

- **Fasa 4 , padam E2 (`reconSql.py`)**: ditangguh ke **tangga 5**, iaitu bila
  app.py Streamlit betul betul bersara. Selagi Streamlit hidup, E2 kekal sebagai
  enjin yang app tu guna DAN sebagai jaring parity.
- **Fasa 5 , recon jadi SQL view tunggal**: ditangguh ke **tangga 6 hingga 7**
  (fasa skala ratus ribu+ order, selari peraturan HANDOVER "jangan SQL-ify
  sekarang"). Belum ada tekanan skala yang menuntutnya.

Sehingga tangga tangga itu tiba, tiga enjin KEKAL dijaga selari oleh harness
parity + guard konstan (`webApp/scripts/checkReconConstants.mjs`). Header setiap
fail enjin kini membawa tanda peranan ni supaya sesiapa yang buka fail terus tahu
mana kanonik, mana oracle, mana beku.

## Tiga enjin yang dibandingkan

- `reconcile.py` (root), RUJUKAN KEBENARAN. Enjin pandas, kira dalam memori. Semua
  logik kategori bermula di sini.
- `reconSql.py` (root), laluan SQL. Sepatutnya salinan SETIA `reconcile.py` tapi ditulis
  sebagai SQL supaya boleh pegang jutaan baris tanpa muat semua ke RAM.
- `webApp/lib/recon.ts` (webApp), laluan Next.js. Port SETIA cabang postgresql
  `reconSql.py` ke TypeScript.

Konstan dikongsi enjin Python duduk dalam `db.py`. `recon.ts` simpan SALINAN SENDIRI
konstan tu (bukan import), jadi tiap konstan wujud di dua tempat dan boleh lari.

Salinan enjin dalam webApp: `webApp/api/engine/db.py` dan `webApp/api/engine/ingest.py`.
Disahkan `webApp/api/engine/db.py` IDENTIK dengan `db.py` root (`diff` sifar beza), jadi
konstan Python konsisten merentas dua salinan. Salinan tu dipakai fungsi ingest
`/api/pyIngest`, bukan laluan recon, jadi tak tambah enjin recon keempat.

---

## Konstan

Jadual ni banding tiap konstan kongsi merentas 3 enjin. Lajur akhir SAMA atau LARI.

| Konstan | reconcile.py | reconSql.py | recon.ts | Status |
|---|---|---|---|---|
| REMIT_PENDING_DAYS | `db.py:36` = 14 (import `reconcile.py:22`) | `db.py:36` (import `reconSql.py:30`) | `recon.ts:15` = 14 | SAMA |
| COD_VALUES | `db.py:32` = `{"COD"}` (import `reconcile.py:21`) | `db.py:32` (import `reconSql.py:30`) | `recon.ts:20` = `["COD"]` | SAMA (set lawan array, nilai sama) |
| INTEGRITY_EXC | `reconcile.py:25` (8 kategori) | import `reconSql.py:31` | `recon.ts:24` (8 kategori sama) | SAMA |
| AGED | `reconcile.py:31` = `["hilang_lewat"]` | import `reconSql.py:31` | `recon.ts:29` sama | SAMA |
| PREPAID_SUCCESS_STATUS | `db.py:107` (7 status) | `reconSql.py:429` `_PREPAID_OK` (7 sama) | `recon.ts:490` `PREPAID_OK` (7 sama) | SAMA |
| awb_valid (J&T = digit, DHL/NV = ada nilai) | `db.py:68` `is_real_awb`, `db.py:73` `_awb_present`, dipeta `db.py:83` COURIERS | `reconSql.py:44` `_frags` (`digit_ok`/`present_ok`) pilih ikut COURIERS | `recon.ts:118` (`digits`/`present` per COURIERS `recon.ts:51`) | SAMA |
| TODAY | `db.py:40` baca env `RECON_TODAY`, fallback hari sebenar (import `reconcile.py:22`) | `db.py:40` sama (import `reconSql.py:30`) | `reconToday()` lazy, baca env `RECON_TODAY`, fallback hari sebenar zon Asia/Kuala_Lumpur | SAMA (dibaiki 2026-07-23, lihat D1) |

Nota COD_VALUES: `reconcile.py` guna set `{"COD"}` untuk semakan keahlian
(`isin(COD_VALUES)`), `recon.ts:20` guna array `["COD"]` untuk param SQL `= ANY($3)`.
Nilai kandungan identik, cuma jenis data ikut bahasa. Bukan divergen makna.

Nota MODULE_REV (`db.py:46`): konstan handshake self heal `app.py`, bukan input recon.
Tiada padanan dalam `recon.ts`. Tidak relevan pada penyatuan enjin, disenaraikan supaya
lengkap.

---

## Takrif kategori

Semua enjin letak tiap baris (order lawan baris bil) ke dalam satu "baldi" kategori.
Bahagian ni banding cara tiap baldi ditakrif. Kategori COD (padan ikut tracking) dan
prepaid (padan ikut order_id) diasingkan.

### Baldi COD (courier: J&T, DHL, Ninja Van)

Sisi padanan: order lawan baris bil di-merge ikut tracking = awb.

| Keadaan baris | reconcile.py | reconSql.py | recon.ts |
|---|---|---|---|
| Ada bil + Completed + amaun padan | `tally` (`reconcile.py:136`) | `tally` (`reconSql.py:143`) | `tally` (`recon.ts:140`) |
| Ada bil + Completed + amaun tak padan | `amount_mismatch` (`reconcile.py:136`) | `amount_mismatch` (`reconSql.py:143`) | `amount_mismatch` (`recon.ts:141`) |
| Ada bil + Completed + AWB DIKONGSI >1 order | `amount_mismatch` (guard, `reconcile.py:194`) | `amount_mismatch` (guard diport, `reconSql.py:188`) | `amount_mismatch` (guard, `recon.ts:201`) |
| Ada bil tapi `cod_amount` RM0 / NULL | bukan bukti duit masuk, jatuh BALIK ke laluan "takde bil" (`reconcile.py:189` `_duit_masuk`) | sama, `l.cod_amount > 0` (`reconSql.py:180`) | sama, `l.cod_amount > 0` (`recon.ts:193`) |
| Ada bil + Returned | `duit_masuk_order_returned` (`reconcile.py:138`) | sama (`reconSql.py:145`) | sama (`recon.ts:142`) |
| Ada bil + Rejected | `duit_masuk_order_rejected` (`reconcile.py:140`) | sama (`reconSql.py:146`) | sama (`recon.ts:143`) |
| Ada bil + status lain | `in_bil_tapi_intransit` (`reconcile.py:141`) | sama (`reconSql.py:147`) | sama (`recon.ts:144`) |
| Takde bil + Completed + tracking tak sah | `no_awb_cat` per courier (`reconcile.py:145`) | sama (`reconSql.py:153`) | sama (`recon.ts:150`) |
| Takde bil + Completed + umur > pending_days | `hilang_lewat` (`reconcile.py:147`) | `hilang_lewat` (`reconSql.py:155`) | `hilang_lewat` (`recon.ts:152`) |
| Takde bil + Completed + masih muda | `belum_remit` (`reconcile.py:149`) | sama (`reconSql.py:156`) | sama (`recon.ts:153`) |
| Takde bil + Returned/Rejected/lain | `returned`/`rejected`/`pending` (`reconcile.py:151`) | sama (`reconSql.py:158`) | sama (`recon.ts:155`) |
| Baris bil tanpa order, awb wujud sebagai tracking order | `match_luar_skop` (`reconcile.py:130`) | sama, `known_trk` guna `not_sentinel_literal` (lihat D6) | sama, `NOT_SENTINEL_LITERAL` (lihat D6) |
| Baris bil tanpa order, awb tak dikenali | `duit_hantu` (`reconcile.py:130`) | sama (`reconSql.py:173`) | sama (`recon.ts:170`) |

Ambang aging: ketiga tiga guna formula sama, `(TODAY - order_date).hari > pending_days`.
`reconcile.py:147` kira terus atas `umur_hari`; `reconSql.py:67` `_cutoff` tukar jadi
`order_date <= TODAY - (pending_days+1)`; `recon.ts:94` `cutoff` ulang formula sama.
Formula IDENTIK, cuma nilai `TODAY` yang lari (lihat Divergen D1).

### Baldi prepaid (gateway: CHIP)

Sisi padanan: order lawan bayaran prepaid di-merge ikut order_id = order_ref.

| Keadaan baris | reconcile.py | reconSql.py | recon.ts |
|---|---|---|---|
| Ada bayaran + amaun padan | `tally` (`reconcile.py:223`) | `tally` (`reconSql.py:211`) | `tally` (`mSqlPrepaid`) |
| Ada bayaran + amaun tak padan | `amount_mismatch` (`reconcile.py:223`) | `amount_mismatch` (`reconSql.py:211`) | `amount_mismatch` (`mSqlPrepaid`) |
| Bayaran tanpa order | `duit_hantu` (`reconcile.py:221`) | `duit_hantu` (`reconSql.py:224`) | `duit_hantu` (`mSqlPrepaid`) |
| Order tanpa bayaran | `belum_bayar` (`reconcile.py:224`) | `belum_bayar` (`reconSql.py:213`) | `belum_bayar` (`mSqlPrepaid`) |

`recon.ts` kini ADA laluan recon prepaid penuh: `mSqlPrepaid()` +
`buildTmpMPrepaid()` + `streamPrepaidSummaryImpl(gateway)` (port setia cabang
prepaid `reconSql.stream_summary`). Padanan ikut order_id = order_ref, agregat
tmp_m dikongsi dengan laluan courier (`tmpMAggregates`). "Pay buckets" jujur
(`payBucketCase`) KEKAL sebagai lapisan paparan atas payment_method + kehadiran
feed (soalan berbeza: keadaan bayaran per stokis), bukan pengganti recon prepaid.
Lihat Divergen D3 (kini DITUTUP).

### Cara kira botol

- `reconcile.py:49` `_bottles_for_skus`: pisah string `orders.skus` ikut koma, regex
  `(\d+)x\s*(.+)`, jumlah `qty*paid` dan `qty*free` per SKU dari `sku_map`.
- `db.py:376` `parse_skus`: regex SAMA (`db.py:373` `_SKU_QTY_RE`), bina jadual
  normalized `order_skus`. `reconSql.py` dan `recon.ts` kira botol dengan JOIN
  `order_skus` ke `sku_bottles` (`reconSql.py:296`, `recon.ts:301`).
- Beza kecil tak memberi kesan: `_bottles_for_skus` tambah tiap bahagian berasingan,
  `parse_skus` gabung qty SKU berulang dulu sebelum darab. Jumlah botol identik.
- Padanan kunci SKU: kedua guna `base.upper()` (base dah di-strip), SQL banding
  `UPPER(TRIM(sb.sku)) = os.sku`. Konsisten. SAMA.

### Cara sahkan "duit disahkan" (confirmed paid)

- `db.py:548` `confirmed_paid_order_ids`: COD (tracking wujud dalam
  `cod_bill_lines.awb` DENGAN `cod_amount > 0`) union prepaid (order_ref padan + status
  dalam PREPAID_SUCCESS_STATUS + amount > 0).
- `reconSql.py` `CONF_SQL`: EXISTS `cod_bill_lines` (syarat `cod_amount > 0` sama) OR
  EXISTS prepaid dengan `_PREPAID_OK`. Logik sama.
- `recon.ts` `CONF_SQL` (+ `COD_LINE_OK` = `cl.cod_amount > 0`): sama. SAMA merentas tiga.

Syarat `cod_amount > 0` ditambah 2026-07-31 (commit `65f2d81`) serentak di tiga enjin,
selari dengan `reconcile._duit_masuk`: baris bil RM0 (contoh caj Returned to Sender
Ninja Van) BUKAN bukti duit masuk, jadi ia tak boleh mengesahkan order. Tanpa syarat ni,
botol order yang duitnya tak pernah masuk akan dikira sebagai jualan sah.

---

## Divergen disahkan

Sembilan divergen ditemui setakat ni, merentas tiga pusingan audit (inventori asal
2026-07-23, audit reconTrust 2026-07-27, baki reconTrust diverify 2026-07-30 dan
ditangani 2026-07-31). SEMUA sudah ditangani, sama ada DIBAIKI dalam enjin atau
DIDOKUMEN sebagai gap sedar yang dikunci ujian. Entri kekal di sini sebagai rekod.

### D1. TODAY beku dalam recon.ts (DIBAIKI 2026-07-23, kini SAMA)

- reconcile.py + reconSql.py: `db.py:40` baca env `RECON_TODAY`, fallback
  `pd.Timestamp.now().normalize()` (hari sebenar). Aging bergerak dengan masa.
- recon.ts: `recon.ts:18` `TODAY = new Date("2026-06-18T00:00:00")`, BEKU keras,
  tiada baca env.

Kesan finance: umur order (`umur_hari`, `recon.ts:106`) dan penentu `hilang_lewat`
(`recon.ts:94` `cutoff`) dalam webApp terpaku pada 18 Jun 2026. Bila masa sebenar
berlalu, webApp KURANG lapor order lewat/hilang berbanding enjin Python (order yang
sepatutnya jatuh `hilang_lewat` masih dikira `belum_remit`). Aging baldi bayaran
(`recon.ts:555` `agingDays`) pun terbeku, jadi "order paling lama" nampak lebih muda
dari realiti.

Kenapa parity tak tangkap: harness set `RECON_TODAY=2026-06-18`, jadi `TODAY` Python
dibekukan ke tarikh SAMA dengan `recon.ts` masa parity jalan. Kedua sisi beku serentak,
jadi padan. Divergen hanya muncul dalam PRODUKSI (Python guna hari sebenar, recon.ts
kekal 18 Jun).

Status: SELESAI. `recon.ts` kini kira tarikh secara lazy dalam `reconToday()` (bukan
lagi `const` beku masa modul load), baca env `RECON_TODAY` kalau ada, kalau tak fallback
hari SEBENAR di zon Asia/Kuala_Lumpur dinormalkan ke tengah malam tempatan. Zon waktu
dikira eksplisit sebab prod Vercel jalan UTC (kalau ambil komponen tarikh dari jam mesin,
tetingkap 00:00 hingga 08:00 waktu Malaysia akan under-report `hilang_lewat` sehari).
Selari dengan `db.py:40`. D1 kini SAMA.

### D2. Guard AWB dikongsi tiada dalam reconSql.py (DIBAIKI 2026-07-23, kini SAMA)

> Status: guard telah diport ke reconSql.py pada 2026-07-23 (Langkah 1 urutan
> penyatuan selesai). Verify: baseline suci kekal, parity harness lulus, kes
> sintetik shared AWB bagi hasil sama pada ketiga tiga enjin. Butiran asal
> dikekalkan di bawah sebagai rekod.

- reconcile.py: KIRA `awb_shared` (`reconcile.py:122`), bila >1 order COD dalam skop
  padan baris bil YANG SAMA, tandakan `amount_mismatch` (`reconcile.py:134`) supaya
  duit satu parcel tak dikira tally berganda.
- recon.ts: ADA guard sama, subquery `COUNT(*) FROM orders o2 WHERE o2.tracking =
  s.tracking ... > 1 THEN 'amount_mismatch'` (`recon.ts:135`).
- reconSql.py: TIADA guard langsung. Both + Completed terus jatuh ikut amaun sahaja
  (`reconSql.py:142`). Kalau 2 order kongsi tracking sama padan satu baris bil, kedua
  dikira `tally` (kalau amaun padan).

Bukti sejarah: guard ditambah ke `reconcile.py` DAN `recon.ts` dalam commit `ddd1f82`
("Audit bug multi-agent"), tapi `reconSql.py` TIDAK PERNAH terima guard ni
(`git log -S "awb_shared" -- reconSql.py` kosong). Jadi `reconSql.py` melanggar
peraturannya sendiri (patut jadi "salinan SETIA reconcile.py", `reconSql.py:9`).

Kesan finance: pada data yang ada order kongsi tracking (contoh dua order satu parcel),
`reconSql.py` LEBIH lapor nilai tally (double count duit), manakala `reconcile.py`
(kebenaran) dan `recon.ts` tandakan `amount_mismatch` untuk siasat. Nilai tally
`reconSql.py` boleh melambung palsu.

Kenapa parity tak tangkap: harness banding `recon.ts` lawan `reconSql.py`
(`webApp/scripts/parityCheck.ts`). Data dev sekarang nampak tiada kes AWB dikongsi
antara order COD dalam skop, jadi kedua sisi keluar sama dan parity LULUS. Ini bug
laten yang disorok data, bukan bukti dua enjin selari. Penyatuan WAJIB dedah dan tutup
lubang ni.

### D3. recon.ts tiada laluan recon prepaid (DITUTUP 2026-07-23, kini SAMA)

> Status: keputusan owner = pilihan (a), PORT recon prepaid ke `recon.ts`. Siap
> 2026-07-23. `mSqlPrepaid()` + `buildTmpMPrepaid()` + `streamPrepaidSummaryImpl()`
> ditambah sebagai port setia cabang prepaid `reconSql.stream_summary`. Padanan ikut
> order_id = order_ref, kategori `tally`/`amount_mismatch`/`duit_hantu`/`belum_bayar`
> identik tiga enjin. Parity harness diperluas: `parityDump.py` + `parityCheck.ts`
> kini banding stream `chip` (row-by-row) di sisi Python DAN TS, LULUS. Page stream
> CHIP dihidupkan (`/impact/streams/chip`) dengan nota jelas "duit CHIP masuk bank
> Dicci Group, bukan Dicci Impact". "Pay buckets" jujur KEKAL sebagai lapisan
> paparan (soalan berbeza), tidak dibuang. Butiran asal dikekalkan di bawah.

- reconcile.py + reconSql.py: ada fungsi recon prepaid penuh
  (`reconcile.py:191` `reconcile_prepaid`, `reconSql.py:190` `_m_sql_prepaid`) yang
  keluar kategori `tally`/`amount_mismatch`/`duit_hantu`/`belum_bayar` untuk gateway
  prepaid (CHIP).
- recon.ts (sebelum ini): TIADA. StreamKey terhad `jnt`/`dhl`/`ninja`. WebApp guna
  derivasi "pay buckets" jujur (`payBucketCase`) atas payment_method + kehadiran feed,
  bukan kategori recon prepaid.

Kesan finance (asal): SEKARANG sifar, sebab CHIP DORMAN (tiada feed CHIP live). Tapi
bila CHIP diaktifkan, webApp TAKDE laluan yang keluarkan kategori recon prepaid setara
enjin Python. Tangga penyatuan kena putuskan: port recon prepaid ke webApp, atau
tetapkan "pay buckets" sebagai pengganti rasmi. KEPUTUSAN: port (a), lihat status atas.

Nota data dev: `prepaid_payments` kosong tapi ada 120 order `payment_method='CHIP'`,
jadi laluan prepaid diuji pada cabang `belum_bayar` (120 order, 9 stokis); parity padan
dua belah walaupun sisi statement kosong.

### D4. Layanan sentinel tracking NONE tak selari (DIBAIKI 2026-07-23, kini SAMA)

> Status: DISAHKAN divergen SEBENAR (bukan palsu) lewat kes ujian sintetik, kemudian
> diport. Bukti sintetik: satu order COD J&T tracking literal `'NONE'` (Completed, RM100)
> + satu baris bil AWB `'NONE'` (RM100, sepadan amaun). SEBELUM baik: `reconcile.py`
> keluar `takde_awb_jnt`+1 dan `duit_hantu`+1 (order & bil tak padan), tapi `reconSql.py`
> JOIN `'NONE'='NONE'` jadi satu padanan `tally`+1 (369->370). Divergen mengembang nilai
> tally palsu DAN sorok duit hantu + AWB hilang. SELEPAS baik: ketiga tiga enjin keluar
> `takde_awb_jnt`+1, `duit_hantu`+1, `tally` KEKAL. Butiran asal dikekalkan di bawah.

- reconcile.py (rujukan, TIDAK disentuh): SENTINEL_TRK = `{"NAN", "NONE", ""}`
  (`reconcile.py:36`). Digunakan dua tempat: kunci merge (`reconcile.py:45`
  `_no_match_keys`) supaya tracking sentinel tak padan sesama sendiri, dan `all_trk`
  (`reconcile.py:94`) untuk beza `match_luar_skop` lawan `duit_hantu`.
- reconSql.py + recon.ts (sebelum baik): hanya guard kosong + `'NAN'` dalam semakan awb
  sah (`reconSql.py:55` `present_ok`, `recon.ts:120`), dan bergantung pada persamaan JOIN
  `l.awb = s.tracking` untuk padanan. Nilai literal `'NONE'` TIDAK disekat, jadi dua
  `'NONE'` JOIN jadi padanan palsu.

Baik (2026-07-23): fragmen dialek `not_sentinel(col)` ditambah ke `reconSql._frags`
(port setia SENTINEL_TRK), dipakai tiga tempat dalam `_m_sql_courier`: (1) JOIN
`l.awb = s.tracking AND not_sentinel(s.tracking)` halang order sentinel padan baris bil
sentinel, (2) `known_trk` (match_luar_skop vs duit_hantu) keluarkan sentinel dari set
tracking dikenali, (3) `anti` (keahlian right_only) keluarkan sentinel dari set scoped
tracking supaya baris bil AWB sentinel jatuh `duit_hantu`. Helper `NOT_SENTINEL(col)`
yang sama diport ke `recon.ts` (JOIN + known + anti), padan cabang postgresql reconSql.

Kesan finance (asal): kalau ingest pernah simpan nilai tracking literal `'NONE'` (contoh
dari sel kosong yang di-stringify oleh `norm_trk`), `reconcile.py` halang ia padan (jadi
order left_only, baris bil right_only), tapi SQL/TS boleh JOIN dua `'NONE'` jadi satu
padanan palsu (`tally`), mengembang nilai tally dan sorok duit hantu. Data dev sebenar
tiada kes ni (parity lulus tanpa perubahan `parityPython.json`), jadi ia bug laten, kini
ditutup sebelum penyatuan.

### D5. Pembundaran sen: banker lawan half-up (DIBAIKI 2026-07-27, kini SAMA)

> Ditemui audit reconTrust (2026-07-27), disahkan skeptik bebas dengan 23 perangkap.
> Keputusan owner: **5 sen NAIK (half-up)**.

`round()` Python bundar seri (tepat separuh sen) ke nombor GENAP: `round(100.125, 2)`
= 100.12, `round(100.625, 2)` = 100.62. SQLite `ROUND` dan Postgres
`ROUND(CAST(x AS numeric), 2)` bundar seri NAIK: 100.13 / 100.63. Baris duit yang sama
jadi `tally` di satu enjin dan `amount_mismatch` di enjin lain, DUA ARAH (bukan satu
enjin sekadar lebih ketat), jadi ia mengembang DAN mengecilkan nilai tally.

Baik: `reconcile._r2()` (`reconcile.py`) guna `Decimal(str(x)).quantize(0.01,
ROUND_HALF_UP)`, dipakai di kedua dua tempat perbandingan duit (COD + prepaid).
`Decimal(str(x))` sengaja lalu TEKS sebab itu perangai Postgres bila `float8` dicast
ke `numeric`, iaitu dialek PRODUKSI. NaN kekal NaN supaya nilai hilang tak pernah
dikira sama. `reconSql.py` dan `recon.ts` TIDAK berubah (memang sudah half-up).

Kesan pada data SEBENAR: **sifar**. Disahkan atas `data/baselineRecon.db`, `recon.db`
(cermin live) dan snapshot backup dev: 0 daripada 1274 pasangan duit bertukar kategori,
dan 0 daripada 13101 nilai duit ada lebih 2 titik perpuluhan. Baseline kekal
byte-identik (`RM 63,912.00`, 369 order).

BAKI DIDOKUMEN (gap dialek, dev sahaja): untuk nilai dengan digit KETIGA selepas titik
yang tak boleh diwakili tepat dalam float (contoh 100.005 tersimpan 100.00499...),
Postgres + `reconcile._r2` bundar ikut TEKS (100.01) manakala SQLite bundar ikut double
mentah (100.00). Prod = Postgres, jadi E1/E2pg/E3 selari; hanya sqlite dev lokal beza.
Diuji dan dikunci sebagai gap sedar dalam `TestGapDialekSen`.

Kunci tambahan (2026-07-31): gap dialek ni SEMPIT, ia tak kena semua nilai digit
ke-3. `TestGapDialekSen` kini simpan kawalan persetujuan 99.995 (semua enjin ->
100.00) dan 0.005 (semua -> 0.01), membuktikan hanya 100.005 yang terbelah antara
sqlite dan Postgres/teks. Sisi POSTGRES (prod) pula dikunci berasingan di
`testReconEdgeCases.ts` (E3 dev PG): 100.005->100.01, 99.995->100.00, 0.005->0.01,
disahkan lewat probe dev PG dan SELARI `reconcile._r2` (oracle). Maknanya TIADA
divergen oracle lawan prod pada digit ke-3, cuma sqlite dev yang jadi outlier pada
satu nilai.

### D6. `all_trk` diport terlalu ketat: match_luar_skop jadi duit_hantu (DIBAIKI 2026-07-27)

> Regresi yang masuk bersama baik D4. Keputusan owner: **ikut reconcile.py**.

Masa D4 ditutup, fragmen `not_sentinel` (ADA `UPPER(TRIM(...))`) dipakai di TIGA tempat
dalam `reconSql._m_sql_courier`, termasuk `known_trk`. Tapi `reconcile.py` layan nilai
sentinel dengan DUA cara berbeza dalam satu fungsi:

- `reconcile.py:42` `_no_match_keys` , kunci merge, ADA `.str.strip().str.upper()`.
- `reconcile.py:94` `all_trk` , `set(orders.tracking.dropna()) - SENTINEL_TRK`,
  TIADA strip/upper, jadi ia buang padanan LITERAL `'NAN'/'NONE'/''` sahaja.

Akibatnya tracking `'none'` huruf kecil KEKAL "tracking dikenali" dalam `reconcile.py`,
jadi baris bil AWB `'none'` = `match_luar_skop` (benign: duit ada tuannya, cuma ordernya
di luar skop stream ini). `reconSql.py` + `recon.ts` buang ia dari set dikenali, jadi
baris sama dilabel `duit_hantu` , membesarkan angka page Not collected / Ghost money
dengan duit yang sebenarnya ada tuan.

Baik: fragmen KEDUA, `not_sentinel_literal(col)` / `NOT_SENTINEL_LITERAL(col)` (tiada
UPPER/TRIM), dipakai HANYA pada `known_trk` dalam dua dua dialek `reconSql.py` dan dalam
`recon.ts`. JOIN + anti-join (keahlian right_only) KEKAL guna `not_sentinel`, sebab di
situ `reconcile.py` memang normalkan kunci. `reconcile.py` TIDAK disentuh.

Kesan yang dijangka pada UI: bilangan `duit_hantu` TURUN (baris berpindah ke
`match_luar_skop`). Itu pembetulan, bukan kehilangan data , dua dua kategori kekal dalam
`INTEGRITY_EXC` jadi jumlah exception tak berubah.

### D7. Tarikh bukan kanonik: pandas parse lawan banding teks (DITUTUP DI PINTU 2026-07-27)

> Keputusan owner: **kemas di pintu ingest, enjin recon TIDAK diubah**.

`reconcile.py` kira umur dengan `pd.to_datetime(order_date)`; `reconSql.py:179` dan
`recon.ts` BANDING TEKS (`order_date <= cutoff`). Selagi `orders.order_date` kanonik
(`YYYY-MM-DD HH:MM:SS`) atau NULL, dua cara tu bagi jawapan sama. Kalau tidak, ia lari:
rentetan KOSONG `''` bagi `belum_remit` di E1 (pandas -> NaT) tapi `hilang_lewat` di
E2/E3 (`'' <= cutoff` benar), iaitu duit tertunggak dilaporkan dua cara bertentangan.

Punca sebenar disiasat di pintu, dan ia LEBIH TERUK daripada yang dilaporkan:

1. `db.parse_dt` lama teka SATU format dari sel pertama lalu paksa ke seluruh lajur.
   Lajur bercampur format (`'01/06/2026'` diikuti `'2026-06-03'`) buat sel yang tak muat
   tekaan jatuh SENYAP jadi NaT. Order hilang tarikh, hilang umur, jadi ia tak pernah
   naik ke `hilang_lewat` , duit bocor tersorok.
2. Lebih teruk: tarikh ISO berjam (`'2026-06-01 10:00:00'`) dengan `dayfirst=True`
   ditekakan sebagai `%Y-%d-%m`, jadi ia pulang **6 Januari**. Bulan dan hari BERTUKAR.

Baik: `db.parse_dt` guna `format="mixed"` (tiap sel diparse ikut bentuk sendiri, dengan
jaring `try/except` ke perangai lama), dan laluan Fighter dapat guard keempat,
`ingest.guard_fighter_dates`: sel Date yang ADA isi tapi tak boleh diparse = fail
DITOLAK dengan `REASON_SUSPECT_VALUES` (sebab sama dengan guard duit), bukan disimpan
NULL senyap. `F_DATE` juga masuk `F_REQUIRED_COLUMNS`, jadi lajur Date hilang = mesej
mesra, bukan crash. Sel kosong tulen KEKAL dibenarkan dan disimpan NULL (bukan `''`),
dan semua enjin setuju pada NULL.

Disahkan atas export Fighter SEBENAR: 0 beza berbanding perangai lama (852 baris).
Keempat empat bentuk tarikh perangkap audit (`'2026-06-03'`, `'2026-06-02T10:00:00'`,
`''`, `'01/06/2026'`) kini keluar dari pintu sebagai kanonik atau NULL, dan E1 lawan E2
PADAN atas data yang masuk lewat ingest.

BAKI DIDOKUMEN: kalau baris ditulis TERUS ke DB (bukan lewat ingest), divergen tarikh
masih boleh wujud. Ia dikunci sebagai gap sedar dalam `TestGapTarikhBukanKanonik`.

### D8. Tarikh songsang + mod runtuh CASCADE parse tarikh (DIBAIKI 2026-07-31)

> Salah satu daripada 2 divergen baki audit reconTrust. DIVERIFY SAH 30 Jul 2026 dengan
> 24 perangkap tarikh, kemudian DIBAIKI dan DIDOKUMEN 31 Jul (commit `65f2d81`).
> Keputusan owner: **kemas di pintu ingest untuk teks, TAPI tutup mod runtuh dalam enjin**.

Adik beradik D7, tapi ini sisi yang D7 tak tangkap. Bila `orders.order_date` bukan
kanonik, E2/E3 banding ia sebagai **TEKS** lawan cutoff manakala E1 **parse** ia jadi
tarikh sebenar. Dua cara tu boleh bagi jawapan bertentangan, dan bercanggah **DUA ARAH**
(bukan satu enjin sekadar lebih ketat): 14 daripada 24 perangkap tarikh keluar kategori
berbeza antara E1 dan E2. Contoh paling terang, `'07/01/2026'`:

- E1 parse ikut sel, dapat 1 Julai 2026, iaitu MASA DEPAN, jadi `belum_remit`.
- E2 banding teks lawan cutoff `'2026-06-03...'`, `'0'` < `'2'` jadi ia "lama",
  jadi `hilang_lewat`.

Penemuan yang LEBIH BESAR keluar masa verify: `reconcile.py` panggil `pd.to_datetime`
untuk lajur `umur_hari` TANPA `format="mixed"`. Pandas teka SATU format dari sel
**pertama** lalu paksa ia ke seluruh lajur. Satu sel rosak di kedudukan pertama boleh
merosakkan umur SATU STREAM PENUH: setiap order lain jadi NaT, hilang umur, dan tak
pernah naik ke baldi `hilang_lewat`. Duit tertunggak lenyap dari radar secara senyap.
Ujian mod runtuh ni ukur **333 baris lari, RM 57,937**. Nama korban: mod runtuh CASCADE.

Baik: `format="mixed"` dipakai di `reconcile.py` (DUA tempat, laluan COD dan laluan
prepaid) dan di `reconSql._umur_hari` (lajur "Age (days)" yang finance BACA dalam jadual
exception, ia terdedah pada cascade yang sama). Tiap sel kini diparse ikut bentuknya
sendiri, jadi satu tarikh rosak cuma rosakkan dirinya. Kelas
`TestGapTarikhBukanKanonik` dinaik taraf: selain mengunci gap teks asal (D7), ia kini
kunci ANTI-cascade (order tua kekal `hilang_lewat` walaupun ada tarikh rosak di baris
pertama, E1 dan E2 selari, lajur `umur_hari` paparan pulang NOMBOR bukan NaN) dan kunci
kes `TEST-GAP-SONGSANG` sebagai gap sedar.

Kesan pada data SEBENAR: **0 baris**. Ia bug LATEN, ditutup sebelum ia sempat menggigit.
Baki gap teks (order ditulis TERUS ke DB, bukan lewat ingest) KEKAL didokumen, sebab
ubatnya di pintu ingest (tulis ISO), bukan di enjin.

### D9. Sentinel whitespace: `.strip()` Python lawan `TRIM()` SQL (DIDOKUMEN 2026-07-31)

> Divergen kedua baki audit reconTrust. DIVERIFY SAH 30 Jul 2026 dengan 25 varian
> sentinel, didokumen dan dikunci 31 Jul. Keputusan owner: **enjin TIDAK diubah**,
> corak sama dengan `TestGapDialekSen`.

`.strip()` Python buang **SEMUA** whitespace Unicode (space, tab, newline, NBSP).
`TRIM()` SQL buang **space sahaja**. Jadi untuk tracking yang berisi tab, newline, atau
NBSP:

- E1 normalkan ia jadi kosong, iaitu sentinel, jadi order dikira **takde AWB sah** dan
  baris duitnya jadi yatim benign (`match_luar_skop`). 3 order perangkap keluar
  `takde_awb_jnt` + 3 `match_luar_skop`.
- E2/E3 biarkan tab kekal dalam nilai, jadi JOIN `tab = tab` MENJADI dan ketiga tiga
  dilabel `tally`. Itu **TALLY PALSU**, dan lebih teruk, ia SOROK 2 exception yang
  sepatutnya naik untuk disiasat.

Skop divergen ni SEMPIT dan itu penting: 24 varian sentinel yang lain (huruf besar
kecil, `'NULL'`, `'-'`, `'N/A'`, space biasa dan sebagainya) SEMUA setuju merentas 4
enjin. Maknanya baik D4 dan D6 memang tertutup rapat; yang tinggal cuma celah whitespace
bukan-space ni.

Kenapa enjin TAK diubah: pintu ingest sudah menapis. `db.norm_trk` buat
`.str.replace(r"\s+", "", regex=True)`, iaitu ia BUANG semua whitespace (termasuk tab,
newline, NBSP) sebelum nilai sempat masuk DB. Tracking bentuk ni cuma boleh wujud kalau
baris ditulis TERUS ke DB memintas ingest. Kesan pada data SEBENAR: **0 baris**.
Menyentuh enjin untuk kes yang pintu dah tutup = risiko regres tanpa pulangan.

Sebagai ganti, gap dikunci sebagai gap SEDAR dalam `TestGapSentinelWhitespace`, corak
sama macam `TestGapDialekSen`: ujian menegaskan E1 dan E2 memang bercanggah di sini,
dengan penegasan eksplisit `assertNotEqual`. Kalau suatu hari enjin diselaraskan untuk
kes ni, ujian tu akan GAGAL , itu isyarat padam ujian, bukan bug.

### Ringkasan kiraan

- Konstan/takrif dibanding: 10 baris.
- SAMA: 6 (REMIT_PENDING_DAYS, COD_VALUES, INTEGRITY_EXC, AGED,
  PREPAID_SUCCESS_STATUS, awb_valid), tambah botol + confirmed-paid yang selari.
- LARI asal: 4. DITUTUP: D1 (TODAY, `recon.ts` kini baca env `RECON_TODAY` secara lazy),
  D2 (guard AWB), D3 (skop prepaid), D4 (sentinel NONE, disahkan divergen sebenar lalu
  diport 2026-07-23).
- Pusingan kedua (audit reconTrust 2026-07-27): D5 (pembundaran half-up), D6
  (`all_trk` terlalu ketat), D7 (tarikh, ditutup di pintu ingest) , SEMUA DITUTUP.
- Pusingan ketiga (baki reconTrust, verify 2026-07-30, tindakan 2026-07-31): D8 (tarikh
  songsang + mod runtuh CASCADE, DIBAIKI dalam enjin), D9 (sentinel whitespace,
  DIDOKUMEN sebagai gap sedar, enjin tak disentuh) , SEMUA DITANGANI.
- Kedudukan sekarang: TIADA divergen terbuka. Yang tinggal cuma 3 gap SEDAR yang
  dikunci ujian (`TestGapDialekSen`, `TestGapTarikhBukanKanonik`,
  `TestGapSentinelWhitespace`), ketiga tiganya 0 baris pada data sebenar dan ketiga
  tiganya ditutup di pintu ingest, bukan di enjin.

### Penggera kekal (jangan buang)

Sebelum 2026-07-27, TIADA ujian automatik yang banding `reconcile.py` lawan
`reconSql.py`: `scripts/parityDump.py` import `reconSql` sahaja, jadi gelung parity
rasmi banding E2 lawan E3 , dua dua di sebelah teks-mentah yang sama , dan boleh
"LULUS" atas nombor yang bercanggah dengan rujukan kebenaran. Lubang tu kini ditutup:

| Fail | Apa dijaga |
|---|---|
| `webApp/api/engine/tests/testReconEdgeCases.py` | 43 ujian: E1 lawan E2 (sqlite) baris demi baris atas fixture kes tepi sintetik + tiga gap didokumen + penjaga anti-cascade tarikh + kawalan sempadan sen (99.995, 0.005 selari) + tarikh tepi kalendar (hujung bulan 31/30, tahun lompat 29 Feb, hujung tahun, NULL/NaT aging) |
| `webApp/scripts/testReconEdgeCases.ts` | 24 semakan: E3 atas dev PG, suntik baris perangkap, semak kategori + `CONF_SQL`, buang balik, termasuk kunci pembundaran sen sisi POSTGRES (100.005->100.01, 99.995->100.00, 0.005->0.01) selari oracle |
| `webApp/api/engine/tests/testIngestParsers.py` (`TestFighterDateGuard`) | tarikh dikanonikkan / ditolak di pintu |

Ketiga tiga dijalankan oleh `npm test` (`scripts/testAll.mjs`).

---

## Urutan penyatuan

Matlamat: satu enjin, satu sumber kebenaran, tiada salinan yang boleh senyap lari.
Tiap langkah boleh disahkan harness parity sedia ada:

```
cd webApp
python3 scripts/parityDump.py > scripts/parityPython.json   # RECON_TODAY=2026-06-18
npx tsx scripts/parityCheck.ts
```

Prinsip: ubah `reconcile.py` (rujukan kebenaran) DULU, sahkan parity, baru rambat ke
`reconSql.py` dan `recon.ts`. Jangan SQL-ify prematur (peraturan HANDOVER).

### Langkah 1. Tutup D2 (guard AWB dikongsi) dalam reconSql.py

Paling bahaya, buat dulu. Tambah guard shared-AWB ke `reconSql.py` supaya ia betul betul
salinan setia `reconcile.py`. Dalam SQL, tambah subquery kira bilangan order dalam skop
yang kongsi tracking sama (corak dah ada di `recon.ts:135`), jatuh ke `amount_mismatch`
bila > 1.

Verify: parity kekal LULUS pada data dev (tiada kes shared, jadi tiada regres), DAN
`python reconcile.py` (baseline courier=jnt) keluar nilai baseline IDENTIK. Untuk uji
guard sebenar, tambah kes shared-AWB ke fixture dev, sahkan ketiga enjin keluar
`amount_mismatch` sama.

### Langkah 2. Selesaikan D1 (TODAY) , SELESAI 2026-07-23

`recon.ts` dah dinyahbeku: `reconToday()` baca env `RECON_TODAY` dengan fallback hari
sebenar (zon Asia/Kuala_Lumpur), padan `db.py:40`. `webApp/scripts/reconEnv.ts` kunci
`RECON_TODAY=2026-06-18` untuk run parity supaya ia kekal deterministik.

Verify (DIBUAT): parity LULUS dengan `RECON_TODAY=2026-06-18` (kedua sisi beku sama).

### Langkah 3. Putus keputusan D3 (recon prepaid) , SELESAI 2026-07-23

Keputusan owner = (a) PORT `reconcile_prepaid` ke `recon.ts` sebagai laluan prepaid
(`PrepaidKey`), "pay buckets" KEKAL sebagai lapisan paparan berasingan (bukan pengganti).
Siap: `mSqlPrepaid` + `buildTmpMPrepaid` + `streamPrepaidSummaryImpl` dalam `recon.ts`,
page `/impact/streams/chip` hidup dengan nota bank Dicci Group, parity diperluas ke
stream `chip` (dump + check).

Verify (DIBUAT): `npx tsc --noEmit` LULUS; `parityDump.py > parityPython.json` +
`parityCheck.ts` LULUS termasuk `[chip] PADAN (kat={"belum_bayar":120})`; `npm test`
SEMUA LULUS; baseline suci kekal `RM 63,912.00 (369 order)`; route `/impact/streams/chip`
respond (307 Clerk gate = route wujud).

### Langkah 4. Sahkan atau tutup D4 (sentinel NONE) , SELESAI 2026-07-23

DISAHKAN divergen SEBENAR lewat kes sintetik, lalu diport (bukan sekadar dinormalkan
masa ingest, supaya semantik sepadan `reconcile.py` walau data lama sudah tersimpan).
Fragmen `not_sentinel` / `NOT_SENTINEL` menyekat JOIN sentinel-ke-sentinel dan
mengeluarkan sentinel dari set tracking dikenali di `reconSql._m_sql_courier` DAN
`recon.mSqlCourier`. Lihat D4 di atas untuk butiran + bukti.

Verify (DIBUAT): baseline suci kekal `RM 63,912.00 (369 order)`; kes sintetik SQLite
`reconcile.py` == `reconSql.py` (takde_awb_jnt+1, duit_hantu+1, tally kekal); suntikan
sentinel ke dev PG, `reconSql`(postgres) == `recon.ts` PADAN via parityCheck, baris
sintetik dibuang dan dev PG disahkan bersih; parity penuh LULUS pada data dev bersih
(`parityPython.json` tak berubah = sifar regres); `npx tsc --noEmit` bersih untuk
`recon.ts`.

### Langkah 5. Gabung jadi satu enjin

Selepas D1 hingga D4 selari (parity LULUS row-by-row untuk semua stream), barulah
gabungkan. Cadangan arah (selari HANDOVER "recon jadi SQL view" fasa Next.js): jadikan
`reconSql.py` / `recon.ts` (laluan SQL) sebagai enjin tunggal, kekalkan `reconcile.py`
sebagai oракel ujian sahaja (jana baseline untuk parity), bukan laluan live. Setiap
perubahan logik lepas ni: ubah oracle dulu, jana semula `parityPython.json`, sahkan
`recon.ts` padan, deploy.

Verify akhir: parity LULUS + `python reconcile.py` baseline IDENTIK + smoke test webApp
tiga stream.

---

## Penemuan bug baru

> Status: DITUTUP 2026-07-23 (Langkah 1 penyatuan). Seksyen ni dikekalkan sebagai rekod
> bagaimana bug tu ditemui, bukan sebagai kerja terbuka.

D2 (guard AWB dikongsi tiada dalam `reconSql.py`) adalah BUG BARU yang ditemui masa
inventori ni, bukan sekadar divergen konstan. `reconSql.py` sepatutnya salinan setia
`reconcile.py` (dinyatakan sendiri di `reconSql.py:9`), tapi guard double-count yang
ditambah dalam commit `ddd1f82` tak pernah dirambat ke `reconSql.py`. Kesan: potensi
kira tally berganda (duit satu parcel dikira dua kali) bila ada order kongsi tracking.
Disorok sekarang sebab data dev tiada kes shared-AWB dalam skop COD, jadi parity lulus
palsu. IKUT ARAHAN, tiada kod dipinda; ini dicatat sebagai penemuan untuk penyelaras
putuskan (dicadang tutup di Langkah 1 penyatuan).
