# Inventori Divergen 3 Enjin Recon

Dokumen ni langkah pertama tangga 2 "satu gudang" (proposal d22e5a): satukan 3 enjin
recon jadi 1. Sebelum boleh satukan, kita kena tahu DENGAN TEPAT di mana ketiga tiga
enjin dah lari sesama sendiri. Dokumen ni inventori sahaja, SIFAR perubahan kod.

Analogi ringkas: bayangkan 3 orang kira duit guna 3 buku nota berasingan. Sepatutnya
salin ayat demi ayat dari buku "rujukan kebenaran", tapi lama lama ada ayat tertinggal
masa salin. Dokumen ni senaraikan setiap ayat yang tertinggal atau berubah, supaya
bila kita gabung jadi satu buku, tiada silap kira duit yang terbawa masuk.

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
| TODAY | `db.py:40` baca env `RECON_TODAY`, fallback hari sebenar (import `reconcile.py:22`) | `db.py:40` sama (import `reconSql.py:30`) | `recon.ts:18` BEKU `2026-06-18`, tiada baca env | LARI (sedang dibaiki sesi 2026-07-23) |

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
| Ada bil + Completed + AWB DIKONGSI >1 order | `amount_mismatch` (guard, `reconcile.py:134`) | TIADA guard, jatuh ikut amaun (`reconSql.py:143`) | `amount_mismatch` (guard, `recon.ts:135`) |
| Ada bil + Returned | `duit_masuk_order_returned` (`reconcile.py:138`) | sama (`reconSql.py:145`) | sama (`recon.ts:142`) |
| Ada bil + Rejected | `duit_masuk_order_rejected` (`reconcile.py:140`) | sama (`reconSql.py:146`) | sama (`recon.ts:143`) |
| Ada bil + status lain | `in_bil_tapi_intransit` (`reconcile.py:141`) | sama (`reconSql.py:147`) | sama (`recon.ts:144`) |
| Takde bil + Completed + tracking tak sah | `no_awb_cat` per courier (`reconcile.py:145`) | sama (`reconSql.py:153`) | sama (`recon.ts:150`) |
| Takde bil + Completed + umur > pending_days | `hilang_lewat` (`reconcile.py:147`) | `hilang_lewat` (`reconSql.py:155`) | `hilang_lewat` (`recon.ts:152`) |
| Takde bil + Completed + masih muda | `belum_remit` (`reconcile.py:149`) | sama (`reconSql.py:156`) | sama (`recon.ts:153`) |
| Takde bil + Returned/Rejected/lain | `returned`/`rejected`/`pending` (`reconcile.py:151`) | sama (`reconSql.py:158`) | sama (`recon.ts:155`) |
| Baris bil tanpa order, awb wujud sebagai tracking order | `match_luar_skop` (`reconcile.py:130`) | sama, `known_trk` (`reconSql.py:172`) | sama (`recon.ts:169`) |
| Baris bil tanpa order, awb tak dikenali | `duit_hantu` (`reconcile.py:130`) | sama (`reconSql.py:173`) | sama (`recon.ts:170`) |

Ambang aging: ketiga tiga guna formula sama, `(TODAY - order_date).hari > pending_days`.
`reconcile.py:147` kira terus atas `umur_hari`; `reconSql.py:67` `_cutoff` tukar jadi
`order_date <= TODAY - (pending_days+1)`; `recon.ts:94` `cutoff` ulang formula sama.
Formula IDENTIK, cuma nilai `TODAY` yang lari (lihat Divergen D1).

### Baldi prepaid (gateway: CHIP)

Sisi padanan: order lawan bayaran prepaid di-merge ikut order_id = order_ref.

| Keadaan baris | reconcile.py | reconSql.py | recon.ts |
|---|---|---|---|
| Ada bayaran + amaun padan | `tally` (`reconcile.py:223`) | `tally` (`reconSql.py:201`) | TIADA laluan prepaid recon |
| Ada bayaran + amaun tak padan | `amount_mismatch` (`reconcile.py:223`) | `amount_mismatch` (`reconSql.py:201`) | TIADA |
| Bayaran tanpa order | `duit_hantu` (`reconcile.py:221`) | `duit_hantu` (`reconSql.py:213`) | TIADA |
| Order tanpa bayaran | `belum_bayar` (`reconcile.py:224`) | `belum_bayar` (`reconSql.py:203`) | TIADA |

`recon.ts` tak port fungsi recon prepaid langsung (StreamKey = `jnt`/`dhl`/`ninja`
sahaja, `recon.ts:49`). Sebaliknya webApp guna "pay buckets" jujur
(`recon.ts:520` `payBucketCase`) yang derive baldi bayaran dari payment_method +
kehadiran feed, BUKAN kira kategori tally/mismatch prepaid. Lihat Divergen D3.

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

- `db.py:432` `confirmed_paid_order_ids`: COD (tracking wujud dalam
  `cod_bill_lines.awb`) union prepaid (order_ref padan + status dalam
  PREPAID_SUCCESS_STATUS + amount > 0).
- `reconSql.py:432` `CONF_SQL`: EXISTS `cod_bill_lines` OR EXISTS prepaid dengan
  `_PREPAID_OK`. Logik sama.
- `recon.ts:494` `CONF_SQL`: sama. SAMA merentas tiga.

---

## Divergen disahkan

Empat divergen ditemui. Tiga LARI membawa kesan sebenar, satu sedang dibaiki.

### D1. TODAY beku dalam recon.ts (LARI, sedang dibaiki sesi 2026-07-23)

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

Status: kerja selari sesi 2026-07-23 sedang nyahbeku `recon.ts` supaya baca env
`RECON_TODAY` (fallback hari sebenar), selari dengan `db.py:40`. Selepas siap, D1 patut
jadi SAMA.

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

### D3. recon.ts tiada laluan recon prepaid (LARI, skop, CHIP dorman)

- reconcile.py + reconSql.py: ada fungsi recon prepaid penuh
  (`reconcile.py:191` `reconcile_prepaid`, `reconSql.py:179` `_m_sql_prepaid`) yang
  keluar kategori `tally`/`amount_mismatch`/`duit_hantu`/`belum_bayar` untuk gateway
  prepaid (CHIP).
- recon.ts: TIADA. StreamKey terhad `jnt`/`dhl`/`ninja` (`recon.ts:49`). WebApp guna
  derivasi "pay buckets" jujur (`recon.ts:520`) atas payment_method + kehadiran feed,
  bukan kategori recon prepaid.

Kesan finance: SEKARANG sifar, sebab CHIP DORMAN (tiada feed CHIP live). Tapi bila CHIP
diaktifkan, webApp TAKDE laluan yang keluarkan kategori recon prepaid setara enjin
Python. Tangga penyatuan kena putuskan: port recon prepaid ke webApp, atau tetapkan
"pay buckets" sebagai pengganti rasmi dan buang recon prepaid dari enjin Python.

### D4. Layanan sentinel tracking NONE tak selari (LARI, laten, kepercayaan rendah)

- reconcile.py: SENTINEL_TRK = `{"NAN", "NONE", ""}` (`reconcile.py:36`). Digunakan dua
  tempat: kunci merge (`reconcile.py:45` `_no_match_keys`) supaya tracking sentinel tak
  padan sesama sendiri, dan `all_trk` (`reconcile.py:94`) untuk beza
  `match_luar_skop` lawan `duit_hantu`.
- reconSql.py + recon.ts: hanya guard kosong + `'NAN'` dalam semakan awb sah
  (`reconSql.py:55` `present_ok`, `recon.ts:120`), dan bergantung pada persamaan JOIN
  `l.awb = s.tracking` untuk padanan. Nilai literal `'NONE'` TIDAK disekat.

Kesan finance: kalau ingest pernah simpan nilai tracking literal `'NONE'` (contoh dari
sel kosong yang di-stringify), `reconcile.py` halang ia padan (jadi order left_only,
baris bil right_only), tapi SQL/TS boleh JOIN dua `'NONE'` jadi satu padanan palsu,
tukar kategori. Kepercayaan rendah: bergantung sama ada data sebenar ada literal
`'NONE'`. Parity lulus sekarang bermakna data dev tiada kes ni. Perlu sahkan dengan
tinjau nilai tracking sebenar sebelum satukan.

### Ringkasan kiraan

- Konstan/takrif dibanding: 10 baris.
- SAMA: 6 (REMIT_PENDING_DAYS, COD_VALUES, INTEGRITY_EXC, AGED,
  PREPAID_SUCCESS_STATUS, awb_valid), tambah botol + confirmed-paid yang selari.
- LARI: 4 (D1 TODAY, D2 guard AWB dikongsi, D3 skop prepaid, D4 sentinel NONE).

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

### Langkah 2. Selesaikan D1 (TODAY) sepenuhnya

Kerja selari sesi 2026-07-23 dah nyahbeku `recon.ts` baca `RECON_TODAY`. Sahkan
`recon.ts:18` baca env dengan fallback hari sebenar, padan `db.py:40`. Buang komen
"baseline beku" bila dah selari.

Verify: parity LULUS dengan `RECON_TODAY=2026-06-18` (kedua sisi beku sama). Uji tambahan
tanpa env: kedua enjin patut guna hari sebenar dan masih padan.

### Langkah 3. Putus keputusan D3 (recon prepaid)

Keputusan owner diperlukan sebelum kod: (a) port `reconcile_prepaid` ke `recon.ts`
sebagai StreamKey prepaid, ATAU (b) iktiraf "pay buckets" sebagai pengganti rasmi dan
buang recon prepaid dari enjin Python. Sebab CHIP dorman, ini boleh tunggu selepas
Langkah 1 dan 2, tapi mesti diputus sebelum CHIP diaktifkan.

Verify: kalau (a), tambah kes prepaid ke parity dump/check. Kalau (b), dokumen keputusan
dalam HANDOVER dan tanda fungsi prepaid Python sebagai deprecated.

### Langkah 4. Sahkan atau tutup D4 (sentinel NONE)

Tinjau nilai tracking sebenar dalam DB dev/prod. Kalau ada literal `'NONE'`, selaraskan:
tambah `'NONE'` ke guard SQL/TS (`reconSql.py:55`, `recon.ts:120`) ATAU normalkan
`'NONE'` jadi NULL masa ingest. Kalau tiada, dokumen sebagai "tidak berlaku pada data
sebenar" dan teruskan.

Verify: parity LULUS. Tambah baris tracking `'NONE'` ke fixture, sahkan ketiga enjin
layan sama.

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

D2 (guard AWB dikongsi tiada dalam `reconSql.py`) adalah BUG BARU yang ditemui masa
inventori ni, bukan sekadar divergen konstan. `reconSql.py` sepatutnya salinan setia
`reconcile.py` (dinyatakan sendiri di `reconSql.py:9`), tapi guard double-count yang
ditambah dalam commit `ddd1f82` tak pernah dirambat ke `reconSql.py`. Kesan: potensi
kira tally berganda (duit satu parcel dikira dua kali) bila ada order kongsi tracking.
Disorok sekarang sebab data dev tiada kes shared-AWB dalam skop COD, jadi parity lulus
palsu. IKUT ARAHAN, tiada kod dipinda; ini dicatat sebagai penemuan untuk penyelaras
putuskan (dicadang tutup di Langkah 1 penyatuan).
