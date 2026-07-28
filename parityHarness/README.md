# parityHarness , penggera parity 3 enjin recon

Projek ni ada **tiga** salinan logik recon yang mesti sentiasa bersetuju. Kalau
salah satu terlari, angka duit di app boleh salah tanpa sesiapa perasan. Harness
ni jalankan ketiga tiga enjin atas data yang SAMA, lepas tu banding keputusan
setiap order satu persatu.

| Enjin | Fail | Peranan |
|---|---|---|
| E1 | `reconcile.py` | pandas, **rujukan kebenaran** |
| E2 | `reconSql.py` | laluan SQL, dua dialek: sqlite + postgres |
| E3 | `webApp/lib/recon.ts` | laluan TypeScript app Next.js |

Analogi: tiga akauntan kira buku yang sama. Harness ni bos yang bandingkan tiga
tiga helaian jawapan baris demi baris. Kalau ada satu nombor lain, dia jerit.

Sebelum ni harness duduk dalam scratchpad `/tmp`, maksudnya ia lenyap bila Mac
restart. Sekarang ia hidup dalam repo (syarat 1 Jarvis untuk buka mod tangan fleet).

## Cara jalan

Syarat: dev Postgres embedded port 5433 mesti hidup.

```bash
cd webApp && nohup node scripts/devDb.mjs > /tmp/devDb.log 2>&1 &
# tunggu lebih kurang 12 saat
```

Lepas tu, dari root repo:

```bash
bash parityHarness/jalan.sh                          # fixture default
bash parityHarness/jalan.sh /laluan/fixtureLain.db   # fixture lain
```

Exit code 0 = parity **LULUS**. Bukan sifar = ada beza atau setup gagal.

Env pilihan:

- `PARITY_PG_DB` , nama database Postgres kerja (default `parity_tapak`)
- `PARITY_OUT_PREFIX` , awalan nama fail dump, guna kalau tak nak timpa dump run sebelum ini
- `RECON_TODAY` , tarikh aging dikunci (default `2026-06-18`, jangan tukar tanpa sebab)

Output run terakhir yang dijangka atas `fixture.db`:

```
jnt 932 baris (tally 369) , dhl 33 , ninja 53 , chip 176
PARITY 3 ENJIN: LULUS
```

## Apa yang jalan.sh buat

1. Sahkan **baseline suci** dulu: `data/baselineRecon.db` mesti keluar
   `RM 63,912.00 (369 order)`. Kalau tak, harness berhenti terus.
2. Sedia `node_modules` (symlink ke `webApp/node_modules`).
3. Salin fixture jadi salinan kerja, jadi fixture asal kekal tak disentuh.
4. Jana `reconMirror.ts` dari `webApp/lib/recon.ts` (lihat bawah).
5. Muat fixture ke database Postgres dev **berasingan** (`parity_tapak`).
6. Dump kategori per order: E1 (sqlite), E2 sqlite, E2 postgres, E3 (postgres).
7. `banding.py` bandingkan 4 dump sebagai multiset per order.

## Keselamatan (baca sebelum ubah)

- **HARAM sentuh Neon.** `dumpPy.py`, `dumpTs.mts` dan `jalan.sh` ada guard tolak
  mana mana `DATABASE_URL` yang mengandungi "neon". Jangan buang guard tu.
- **Jangan sentuh db dev owner** bernama `dicci`. `loadFixtureToPg.py` dan
  `jalan.sh` tolak nama tu. Harness bina semula db sendiri setiap run.
- **Jangan jalankan `npm test`** bersama kerja dev yang belum simpan, ia memadam
  data dev PG. Harness ni sendiri tidak memadam db `dicci`.
- Repo ni **PUBLIC**. Fail data (fixture, dump JSON, mirror) mengandungi order
  sebenar, semuanya gitignored. Skrip sahaja yang dicommit.

## Fail

Skrip (dicommit):

- `jalan.sh` , wrapper resipi penuh hujung ke hujung
- `banding.py` , banding dump multiset per order, exit 1 kalau ada beza
- `dumpPy.py` , dump kategori per order dari enjin Python (`e1` atau `e2`)
- `dumpTs.mts` , dump sama bentuk dari enjin TypeScript
- `buatMirror.mjs` , jana mirror `recon.ts`
- `loadFixtureToPg.py` , muat fixture sqlite ke db Postgres dev berasingan
- `buatHarness.mjs` , jana `parityDumpAny.py` + `parityCheckAny.ts` dari harness rasmi webApp
- `parityDumpAny.py` , `parityCheckAny.ts` , harness AGREGAT (lihat bawah)

Data (gitignored, dalam `data/`):

- `fixture.db` , fixture bersih
- `fixture2.db` , fixture rosak sengaja (untuk bukti penggera menggigit)
- `e1.json`, `e2sqlite.json`, `e2pg.json`, `e3.json` , dump run terakhir
- `s_e1.json`, `s_e2sqlite.json`, `s_e2pg.json`, `s_e3.json` , dump rujukan `fixture2.db`
- `reconMirror.ts`, `kerjaFixture.db` , fail jana, boleh buang bila bila

## Kenapa ada "mirror" recon.ts

Harness perlu panggil fungsi dalaman `buildTmpM` / `buildTmpMPrepaid`. Daripada
mengubah repo untuk dedah fungsi tu, `buatMirror.mjs` jana satu salinan
`recon.ts` di `data/reconMirror.ts` dengan **dua perubahan mekanikal sahaja**:

1. import relatif (`"./db"`) ditukar jadi laluan absolut ke fail repo yang SAMA
2. satu baris re-export ditambah, HANYA untuk fungsi yang sumber belum export

Mirror dijana semula setiap run, jadi ia mustahil basi. Skrip cetak bilangan
baris berubah dan mati kalau perubahan lebih daripada yang dibenarkan. Sejak
27 Jul `recon.ts` dah export sendiri dua dua fungsi tu, jadi biasanya 0 baris
ditambah.

## Fixture datang dari mana

`fixture.db` ialah **salinan byte identik** `data/baselineRecon.db` (baseline
suci projek). Jana semula:

```bash
cp data/baselineRecon.db parityHarness/data/fixture.db
```

`fixture2.db` ialah `fixture.db` tambah 5 baris sintetik yang sengaja pecahkan
3 kelas logik: AWB dikongsi dua order, sentinel `NONE` sebagai tracking, dan
bil tanpa order padan. Jana semula:

```bash
cp parityHarness/data/fixture.db parityHarness/data/fixture2.db
sqlite3 parityHarness/data/fixture2.db <<'SQL'
INSERT INTO orders (order_id, order_date, seller_name, status, payment_method,
  shipping_provider, tracking, selling_price, item_count, skus, source_file)
VALUES
 ('SYN-SHARED-A','2026-06-01 00:00:00','SYN STOKIS','Completed','COD',
  'J&T Express','9990000001',100.0,1,'1x TESTSKU','syn'),
 ('SYN-SHARED-B','2026-06-01 00:00:00','SYN STOKIS','Completed','COD',
  'J&T Express','9990000001',100.0,1,'1x TESTSKU','syn'),
 ('SYN-NONE','2026-06-01 00:00:00','SYN STOKIS','Completed','COD',
  'J&T Express','NONE',100.0,1,'1x TESTSKU','syn');
INSERT INTO cod_bill_lines (bill_id, awb, cod_amount, fee, pickup_date,
  delivered_date, source_file)
VALUES
 ('JTMY031691','9990000001',100.0,2.0,'2026-06-01 00:00:00','2026-06-01 00:00:00','syn'),
 ('JTMY031691','NONE',100.0,2.0,'2026-06-01 00:00:00','2026-06-01 00:00:00','syn');
SQL
```

Jangkaan `fixture2.db`: `jnt` naik jadi 936 baris dengan
`amount_mismatch 2`, `duit_hantu 1`, `takde_awb_jnt 1`, dan ketiga tiga enjin
tetap **setuju sesama sendiri** (parity LULUS, cuma kategorinya berbeza).

## Harness agregat (lapisan kedua, pilihan)

`banding.py` bandingkan kategori **per order**. Harness rasmi webApp
(`webApp/scripts/parityDump.py` + `parityCheck.ts`) pula bandingkan **agregat**
(daily, per bill, stokis, botol) tapi ia terkunci pada db dev `dicci`.
`buatHarness.mjs` jana versi yang hormat `DATABASE_URL`, jadi boleh jalan atas
db fixture:

```bash
node parityHarness/buatHarness.mjs parityHarness            # jana semula
DATABASE_URL="postgresql://dev:dev@localhost:5433/parity_tapak" \
  python3 parityHarness/parityDumpAny.py > parityHarness/data/parityPython.json
cd parityHarness && DATABASE_URL="postgresql://dev:dev@localhost:5433/parity_tapak" \
  PARITY_REF_DIR="$PWD/data" ../webApp/node_modules/.bin/tsx parityCheckAny.ts
```

`parityDumpAny.py` dan `parityCheckAny.ts` adalah fail JANA. Kalau
`webApp/scripts/parity*` berubah, jana semula (`buatHarness.mjs` akan mati kalau
corak gantian tak jumpa, jadi ia takkan senyap jalan atas harness separuh betul).

## Bila kena jalankan

- Sebelum commit apa apa yang sentuh `reconcile.py`, `reconSql.py`, atau
  `webApp/lib/recon.ts`
- Sebagai gate alur fleet mod tangan, bersama `npm test` penuh
