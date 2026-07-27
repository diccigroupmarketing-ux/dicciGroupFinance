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

### Ringkasan kiraan

- Konstan/takrif dibanding: 10 baris.
- SAMA: 6 (REMIT_PENDING_DAYS, COD_VALUES, INTEGRITY_EXC, AGED,
  PREPAID_SUCCESS_STATUS, awb_valid), tambah botol + confirmed-paid yang selari.
- LARI asal: 4. DITUTUP: D2 (guard AWB), D3 (skop prepaid), D4 (sentinel NONE,
  disahkan divergen sebenar lalu diport 2026-07-23). BAKI: D1 TODAY (sedang dibaiki
  sesi 2026-07-23).
- Pusingan kedua (audit reconTrust 2026-07-27): D5 (pembundaran half-up), D6
  (`all_trk` terlalu ketat), D7 (tarikh, ditutup di pintu ingest) , SEMUA DITUTUP.

### Penggera kekal (jangan buang)

Sebelum 2026-07-27, TIADA ujian automatik yang banding `reconcile.py` lawan
`reconSql.py`: `scripts/parityDump.py` import `reconSql` sahaja, jadi gelung parity
rasmi banding E2 lawan E3 , dua dua di sebelah teks-mentah yang sama , dan boleh
"LULUS" atas nombor yang bercanggah dengan rujukan kebenaran. Lubang tu kini ditutup:

| Fail | Apa dijaga |
|---|---|
| `webApp/api/engine/tests/testReconEdgeCases.py` | E1 lawan E2 (sqlite) baris demi baris atas fixture kes tepi sintetik + dua gap didokumen |
| `webApp/scripts/testReconEdgeCases.ts` | E3 atas dev PG: suntik baris perangkap, semak kategori, buang balik |
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

### Langkah 2. Selesaikan D1 (TODAY) sepenuhnya

Kerja selari sesi 2026-07-23 dah nyahbeku `recon.ts` baca `RECON_TODAY`. Sahkan
`recon.ts:18` baca env dengan fallback hari sebenar, padan `db.py:40`. Buang komen
"baseline beku" bila dah selari.

Verify: parity LULUS dengan `RECON_TODAY=2026-06-18` (kedua sisi beku sama). Uji tambahan
tanpa env: kedua enjin patut guna hari sebenar dan masih padan.

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

D2 (guard AWB dikongsi tiada dalam `reconSql.py`) adalah BUG BARU yang ditemui masa
inventori ni, bukan sekadar divergen konstan. `reconSql.py` sepatutnya salinan setia
`reconcile.py` (dinyatakan sendiri di `reconSql.py:9`), tapi guard double-count yang
ditambah dalam commit `ddd1f82` tak pernah dirambat ke `reconSql.py`. Kesan: potensi
kira tally berganda (duit satu parcel dikira dua kali) bila ada order kongsi tracking.
Disorok sekarang sebab data dev tiada kes shared-AWB dalam skop COD, jadi parity lulus
palsu. IKUT ARAHAN, tiada kod dipinda; ini dicatat sebagai penemuan untuk penyelaras
putuskan (dicadang tutup di Langkah 1 penyatuan).
