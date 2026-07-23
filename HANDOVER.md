# HANDOVER , dicciGroupFinance

Tarikh mula: 2026-06-18

## Status
- progress: (23 Jul, SEMUA LIVE) 4 divergen 3 enjin recon DITUTUP (TODAY dinamik zon KL per-request, guard shared AWB, recon prepaid CHIP + page /impact/streams/chip LIVE, sentinel NONE), sidebar 5 kumpulan + company switcher Dicci, pemburuan bug 10/14 dibaiki (delete selamat order_uploads, kuarantin bill_line_conflicts + Needs attention, variance Close Pack, log Price change), npm test + check:engine + 47 ujian parser, panduan finance lengkap, barisan proposal bersih, peta v1.6, graf UA segar 377 node. 26 commit PUSHED + 3 deploy Vercel READY malam sama. Laporan Jarvis: inbox laporanDicciFinance20260723. Sebelum tu: Fasa 1 pada dasarnya siap. WebApp Next.js LIVE di Vercel (diccigroupfinance.vercel.app), terkunci belakang Clerk auth (allowlist), cover 100% view Streamlit lama. Ciri terkini (22 Jul, LIVE): tapis client di Stockists + Uploads + tapis order dalam StockistModal (TableFilter kongsi; pintu carian Dashboard + link sidebar "Find order" DIBUANG atas arahan owner lepas test, page /impact/search kekal via URL terus), dan medan "Actual deposit date" dalam Bank Confirm + kolum Deposited dengan lag (+Nd) + masuk export (team TAK perlu adjust tarikh PDF J&T lagi). 3 feed disahkan dengan FAIL SEBENAR pertama kali (22 Jul, data/sampel/ gitignored): CHIP (112 paid masuk, 12 overdue ditolak, tekaan PREPAID_SUCCESS_STATUS SAH), DHL (UTF-16 .xls tepat jangkaan), Ninja (4 baris, nota: SOA campur baris caj bukan COD, akan nampak "pelik" dalam recon, bukan bug). Finance dah upload data sebenar (561 order, 2 bil J&T); 16 SKU live perlu masuk katalog di prod.
- fasa: WebApp Next.js production LIVE, mod handoff data-safe (prod Neon suci, semua ubah suai diuji atas dev DB dulu). Streamlit lama kekal hidup sebagai backup pasif (soft-retire, tak jadi delete).
- seterusnya: (0) SIAP 23 Jul malam: push + deploy Vercel LIVE (dpl BdJwkhXH, commit 39e61ee). Owner masih perlu BERITAHU team: angka aging kini hidup, order lama belum remit naik hilang_lewat, itu jangkaan bukan bug. (1) Rotate kredential Neon = GATE terakhir sebelum jemput finance upload data BETUL, runbook siap (runbookRotateNeon.md), bila rotate update env Vercel SAHAJA, owner tangguh lagi 22 Jul. (2) Minta CSV export Google Sheet team finance, lepas tu Fasa 0 Sheet check (skrip gate luar app: sahkan ada order ID + semak lajur botol/komisen, design penuh dikunci, lihat seksyen "Sesi 22 Jul"). (3) Owner beritahu team: BERHENTI adjust tarikh PDF J&T, guna medan Actual deposit date masa Confirm. (4) Push 3 commit tertunggak ke GitHub (deploy dah jalan, decoupled). (5) Owner sahkan takrif kempen botol KJS-3-1 & KJS-4-2. (6) Clerk production (perlu domain custom, runbook siap). (7) Upload statement CHIP tally penuh (Batch D) tangguh sampai finance nak. Export Fasa B + komisen enrich = HOLD. Backlog baru: butang "Report mismatch" (lepas Sheet check terbukti).
- nota (2026-07-09): peta Arkitektur (Understand-Anything) untuk projek ni DAH wujud di `.understand-anything/knowledge-graph.json` (221 node, 451 edge, 7 layer nama Melayu, tour 12 langkah, output BM), sudah di-gitignore jadi repo public selamat (52 fail data peribadi/secrets/build di-skip sengaja). HUD modul Arkitektur render terus (endpoint `/api/arch/ua` terima root). Refresh bila kod berubah: run `/understand` dalam projek ni (incremental, fingerprint baseline dah ada).
- nota Jarvis (2026-07-19): KEPUTUSAN ARCHITECTURE DIKUNCI owner lepas 2x /timbang: multi syarikat = SATU database Neon dikongsi, company_id + RLS FORCE fail closed, BUKAN database per syarikat. Tangga kerja 0 sampai 7 (0 = rotate Neon, selaras dengan gate sedia ada; 2 = satukan enjin recon 3 salinan jadi 1 SEBELUM company label; WAJIB akaun app berkuasa rendah sebab RLS tak terpakai pada owner role). Detail penuh: knowledgeVault decisions/dicciFinanceSatuGudang20260718.md. PETA ARCHITECTURE interaktif: `peta/` kini LOKAL SAHAJA (22 Jul: di-gitignore + dikeluarkan dari git atas keputusan owner, repo public + peta ada info dalaman bisnes; backup rasmi = knowledgeVault/raw/petaDicciFinanceV*.html). Peta v1.4 (skema versi titik mulai 22 Jul): 8 flow (+ swimlane "Berlapis" 4 lorong), drill L0 sampai L3, mod Semasa vs Sasaran, ujian 190 pass. Buka: peta/buka.command port 4100; refresh: /petaDicci. JANGAN edit renderer masa refresh, ganti blok PETA_DATA sahaja, dan JANGAN commit/push peta.
- kemaskini: 2026-07-23

## Sesi 23 Jul (enjin selaras + sidebar baru, SEMUA push + deploy LIVE malam sama)

Sesi paling produktif setakat ini, semua kerja via subagent Opus, semua lulus gate:

- **Barisan proposal agenticOs dibersihkan**: 13 proposal dicciGroupFinance semua terminal.
  6 dilaksana sesi ini, 2 rejected (superseded/duplicate), worktree + branch proposal dibuang.
- **Jaring keselamatan baru**: `npm test` (webApp/scripts/testAll.mjs, 5 suite + restore,
  RECON_TODAY auto pin), `npm run check:engine` (checkEngineSync.mjs, gagal bila api/engine
  lari dari root), 33 ujian regresi parser (webApp/api/engine/tests/testIngestParsers.py,
  fixture sintetik, tanpa DB).
- **4 divergen enjin DITUTUP dalam hari sama** (inventori: docs/enjinReconDivergen.md):
  D1 jam TODAY recon.ts dinyahbeku (baca RECON_TODAY, fallback hari sebenar; harness pin
  2026-06-18 dua belah via scripts/reconEnv.ts + parityDump setdefault). D2 guard shared
  AWB diport ke reconSql.py (bug: laluan SQL boleh double count duit satu parcel). D3
  laluan recon prepaid penuh dalam recon.ts (`streamPrepaidSummary`), page
  /impact/streams/chip LIVE dengan nota "duit CHIP masuk bank Dicci Group bukan Impact";
  CHIP SENGAJA tak masuk roll-up tunai Impact. D4 sentinel "NONE" disekat dalam JOIN
  reconSql + recon.ts (bug sebenar: NONE=NONE boleh jadi tally palsu). Langkah 1 tangga 2
  penyatuan enjin SELESAI.
- **Sidebar webApp disusun semula**: company switcher Dicci (Group/Impact/Flux/Hub/Empyre,
  4 page Coming soon jujur di /group /flux /hub /empyre), 5 kumpulan dropdown (Money in:
  Dashboard/J&T/DHL/Ninja/CHIP/Bank Transfer(Soon), Money out: Soon, Operations, Tools,
  Settings: Soon), state localStorage, collapse rail kekal. 6 lint error
  set-state-in-effect dibaiki (useSyncExternalStore, sifar ubah behavior).
- **Dokumen**: panduanFinance.md + seksyen 5 baldi bayaran jujur (label persis UI).
  Peta lokal v1.5 (CHIP live), 190 ujian lulus, backup vault raw.
- **AWAS deploy**: bila deploy Vercel, jam TODAY jadi dinamik di LIVE, order lama belum
  remit akan naik hilang_lewat serentak. Beritahu team dulu sebelum deploy.
- Keputusan owner sesi ini: Flux = syarikat kedua paling berat nanti (data TikTok,
  mekanisme lain, fasa akan datang). Duplicate upload = bukan isu (upsert ikut order_id,
  sedia idempotent); yang perlu perhalusi nanti ialah dedup sisi feed bayaran.

## Sesi 23 Jul malam (pemburuan bug: 4 pemburu + 1 penyangkal, 4 fix LOKAL belum push)

Tangga murah dulu (semua gate automatik hijau), lepas tu 4 subagent pemburu sasaran
(upload/API, UI, tarikh/timezone, enjin) + 1 penyangkal sahkan. 14 calon, 4 dibaiki:

- **B1 delete upload selamat** (b90dbc7, severity TINGGI): jadual jejak baru
  `order_uploads` (additive), delete hanya buang order EKSKLUSIF fail itu; order kongsi
  dikekalkan + source_file di-re-point; order legacy (tanpa jejak) TAK dipadam senyap,
  dilapor "kept". PENTING prod: jadual mula kosong, semua order sedia ada = legacy,
  padam-selamat penuh hanya lepas finance re-upload fail Orders (idempotent).
- **D1 to_num kurungan** (15813c8): "(30.00)" kini -30 (dulu +30). Ninja net negatif
  selamat.
- **D2 CHIP dup** (15813c8): 2 bayaran berjaya order sama dalam 1 statement dijumlah
  (bukan last-wins), lebihan naik amount_mismatch untuk siasat.
- **A1 variance Close Pack** (f38cb0c): variance kira atas bil CONFIRMED sahaja
  (selaras BillsTable), tiada lagi isyarat bocor palsu period separa confirm.

Susulan lewat malam (semua siap juga): C1+C2 DITUTUP (reconToday() per-request, zon
Asia/Kuala_Lumpur eksplisit, 1840e30), 2 kosmetik dibaiki (Activity waktu Malaysia +
export StockistModal ikut penapis, d7e7754), dan D3 diselesai ikut keputusan owner
(b959397): BUKAN migrasi PK, tapi kuarantin, parcel sama disebut dalam 2 bil berbeza
= baris baru diparkir jadual `bill_line_conflicts` (additive), seksyen "Needs
attention" di page Uploads papar Order ID + dua dua bil + amaun; re-upload bil sama
kekal senyap idempotent. Bonus: perubahan selling_price antara upload dilog Activity
sebagai "Price change" (log sahaja, tak menahan). Kiraan akhir pemburuan: 10 daripada
14 calon dibaiki, baki 4 kosmetik/laten direkod sahaja.

## Penutup 23 Jul (otak segar)
Peta lokal naik v1.6 (2 kabinet baru order_uploads + bill_line_conflicts, 195 ujian
pass, backup vault raw). Graf kod Understand-Anything dibina semula penuh: 105 fail,
377 node, 745 edge, 7 lapisan Melayu, tour 14 langkah, fingerprint baseline segar
(commit 465b952). docs/panduanFinance.md dikemaskini dengan Needs attention + Price
change + perangai delete baru (pushed).

## Cara run

```
cd webApp && npm run dev
```

## Apa projek ni

Automation Finance Dicci Group untuk semak duit masuk harian tally dengan rekod. Skop penuh besar, dipecah step by step. Ini Fasa 1.

## Skop Fasa 1 (dikunci)

- Syarikat: Dicci Impact sahaja.
- Duit masuk: J&T COD sahaja.
- Soalan teras: duit yang patut masuk, betul betul masuk, dan tally dengan order?
- Tujuan: tangkap bocor duit awal, bukan bina dashboard cantik.

## Dua sumber data

- Fighter: "apa yang sepatutnya" (order, harga produk, stokis, payment type).
- J&T: "apa yang sebenarnya jadi" (status hantar, COD dikutip, remit ke bank).
- Penghubung: nombor tracking. Padanan dua hala.

## Keputusan yang dikunci (dari borak 2026-06-18)

1. Sumber "duit masuk" = laporan remit J&T sahaja. Bank statement DIPARKIR.
2. Padanan ikut tracking. Mostly 1 order = 1 tracking, tapi ada kes 1 order banyak tracking (kena handle).
3. Amount Fighter = harga produk SAHAJA. Caj pos customer TAK DIREKOD (bukan flat rate pun). Jadi semakan harga = munasabah (COD >= harga produk), BUKAN padanan tepat.
4. Kiriman J&T campur COD + prepaid. Fighter ada field payment type, tapis COD je.
5. Struktur fee J&T belum pasti, di-infer dari sampel (beza COD dikutip vs remit).
6. Akses data belum pasti, berkemungkinan campur. Fasa 1 guna export manual dua dua.

## Struktur data sebenar (disahkan dari sampel)

- Fighter (export "Orders", 852 baris Mei): Order ID, Date, Status (Completed/Returned/Rejected/In Transit), Seller Name (stokis), Payment Method (COD/CHIP/Bank Transfer), Shipping Provider (J&T Express/Ninja Van/DHL eCommerce/Self Pickup), Tracking Number, Selling Price (= COD penuh), Sales Commission (= komisyen Impact).
- J&T (export "COD账单", satu bil settlement, 186 baris): AWB No., COD Amount, Total Processing Fee (Service + 6% Tax), Delivery Signature Date, Date | Pick Up.
- Padanan: Fighter `Tracking Number` <-> J&T `AWB No.`

## Andaian yang DIBETULKAN oleh data sebenar

- Amount padan TEPAT: Selling Price (Fighter) == COD Amount (J&T), 186/186 dalam sampel. Selling Price = Member Price + Sales Commission, dah merangkumi caj pos. Bukan lagi sekadar sanity bound.
- Fee J&T diketahui: Total Processing Fee (~1.43% COD, lantai ~RM2.12 sekeping). Net remit = COD tolak fee.
- Bukan semua COD lalu J&T: ada Ninja Van (prefix NV) dan DHL eCommerce (placeholder MYHTB). Tapis Shipping Provider = "J&T Express" untuk skop Fasa 1.
- J&T datang sebagai BIL settlement COD (hanya parcel delivered + remitted). Takde lajur remit khusus.
- PENTING (kata Adi): tarikh "duit masuk" untuk aliran tunai = `Delivery Signature Date` parcel (waktu COD dikutip), BUKAN tarikh settlement bil. Aliran tunai harian dikumpul ikut tarikh delivery signature. Net remit = COD tolak fee = jumlah patut mendarat bank.
- Matlamat utama Adi: aliran tunai HARIAN dipadan dengan akaun bank, automatik. Data bank harian sedang diminta dari Finance (akan tambah lajur bank sebenar + sepadan).

## Kategori reconciliation (model bil COD)

- tally: AWB dalam bil + order Completed + Selling Price == COD. (Sampel: 186, bersih.)
- amount_mismatch: dalam bil tapi Selling Price != COD. (Sampel: 0.)
- duit_hantu: AWB dalam bil, takde order Fighter. PALING BAHAYA. (Sampel: 0.)
- duit_masuk_order_returned / rejected: duit masuk untuk order batal/return. Anomali. (Sampel: 0.)
- belum_remit_atau_hilang: order J&T COD Completed, takde dalam bil ni. Normal kalau baru, siasat kalau lama. (Sampel: 397, tinggi sebab cuma 1 bil.)
- returned / rejected / pending: tiada duit dijangka. Normal.

## Sistem (milestone 1, dah siap)

Stor berkekalan tempatan (SQLite, `recon.db`) + enjin Python. Schema sengaja serasi
Postgres supaya senang port ke Supabase bila app penuh dibina (foundation tak buang kerja).

Fail:
- `db.py` , sambungan + schema (jadual `orders`, `cod_bills`, `cod_bill_lines`) + helper + konstan skop.
- `ingest.py` , baca `data/inbox/`, auto kenal Fighter vs bil J&T ikut lajur, normalise, upsert idempotent, pindah fail ke `data/archive/`.
- `reconcile.py` , baca DB, padan ikut tracking, kategori + aging, tulis `output/report.txt` + `output/exceptions.csv`.
- `app.py` , UI web Streamlit (localhost:8501). Struktur baru (Milestone 2): OVERVIEW sentiasa di atas (pemilih tempoh, hero Net Remit, band exception, KPI sekunder, chart trend) + tab drill-down "Per Tempoh", "Per Bil", "Audit", "SKU / Botol". Upload + tetapan + status stor dalam satu expander "Panel operasi" di atas halaman utama. TIADA sidebar.
- `theme.py` , lapisan persembahan berjenama Dicci, boleh guna semula (lihat Milestone 2). Logik recon tak bergantung pada fail ni.
- Botol: jadual `sku_bottles` (paid + free berasingan, contoh KORBAN 4+2 = 4 paid + 2 free). Free = giveaway, diasingkan sebab nak kira kos nanti. Botol dikira per order dari `orders.skus` x mapping masa reconcile (bukan masa ingest, supaya edit mapping terus reflect). SKU tak dipetakan = flag dalam tab SKU.

Cara guna (CLI):
1. Drop fail mentah (export Fighter atau bil COD J&T) dalam `data/inbox/`.
2. `python ingest.py`  (selamat re-run, tak double count, kunci = order_id / awb).
3. `python reconcile.py`  (hasil dalam `output/`).

Cara guna (web): `streamlit run app.py`, buka http://localhost:8501, upload fail terus dalam browser.

Schema kunci: `orders.tracking` <-> `cod_bill_lines.awb`. Satu AWB = satu baris (di-remit sekali).
Aging: order J&T COD Completed tak masuk mana mana bil lepas REMIT_PENDING_DAYS (default 14) = `hilang_lewat`.
Report dua tier: Tier 1 = exception integriti (masalah betul), Tier 2 = aged unmatched (didominasi artifak bil tak cukup buat masa ni).

## Milestone 2: UI berjenama Dicci (siap, 2026-06-18)

Rombakan visual + kedudukan penuh, ikut research 2 subagent (tema + IA) dan skill UI
Anthropic (frontend-design). Audience dua dua (alat kerja harian + boleh ditunjuk management).

- **Brand:** teal `#0A3D45` + emas `#D6B467` (dari dicci.com.my, terkunci baseline),
  tambah neutral hangat + status diharmonikan (positive hijau `#1E7A5E`, danger merah
  bata `#A8312A`, caution emas) + palet data-viz. Font **Fraunces** (display/hero) +
  **Manrope** (body/data, tabular nums), ganti Inter. Atmosfera CSS: bayang bertona teal,
  hairline gradient, grain kertas, glow sudut. Logo: `assets/logoDicci.png`
  (auto-download dari dicci.com.my via `theme.ensure_logo`).
- **Struktur:** overview lead (hero Net Remit = bintang) + drill-down tabs. Upload,
  tetapan, status stor dalam expander "Panel operasi" di halaman utama.
- **Keputusan: BUANG sidebar.** Sidebar Streamlit ada bug, bila ditutup butang buka balik
  boleh hilang (digabung CSS header + cache browser). Semua kawalan dipindah ke expander
  main page yang toggle dia reliable. `initial_sidebar_state="collapsed"`.
- **`theme.py` boleh guna semula:** bila page ni jadi sebahagian dashboard besar, page
  lain cukup panggil `page_header / hero_band / alert_band / kpi_row / section /
  bar_chart_brand / style_kategori`.
- **Verifikasi:** screenshot headless (chrome-headless-shell dari cache ms-playwright +
  node CDP) sahkan render; `AppTest` tiada exception; `reconcile.py` output IDENTIK
  baseline (logik enjin langsung tak tersentuh, ini lapisan persembahan sahaja).
- **Nota dev:** `.streamlit/config.toml` tema TAK hot-reload, restart server bila tukar.
  Streamlit cache aset agresif, guna incognito / hard refresh bila uji perubahan UI.

## Milestone 3: Deploy (live, 2026-06)

- App di-deploy ke **Streamlit Community Cloud**, diset **PRIVATE** (viewer allowlist
  team finance, mereka sign in dengan email yang dijemput).
- DB produksi: **Neon Postgres** (persistent, region Singapore). `db.py` di-port ke
  **SQLAlchemy**, auto pilih Postgres (env/secret `DATABASE_URL`) atau fallback SQLite
  lokal. Output `reconcile.py` IDENTIK baseline, ingest idempotent (diuji atas SQLite).
  Asalnya pilih Supabase tapi project creation Supabase down masa deploy, tukar Neon
  (kod Postgres-agnostic, drop-in).
- **Python 3.12** wajib di Streamlit Cloud (3.14 pecahkan import altair).
- Push ke GitHub = **auto-redeploy** Streamlit Cloud. Lokal kekal guna SQLite untuk dev.
- Detail operasi (akaun, URL app, secret, langkah pending) disimpan dalam memory peribadi
  + `CLAUDE.md` tempatan (di-gitignore), TAK dimasukkan ke HANDOVER sebab repo ini public.

## Milestone 4: Paparan Botol Per Stokis + foundation pengesahan duit (2026-06-19)

Tab baru "Per Stokis" untuk tengok botol setiap stokis (paid = jualan, free = kos giveaway).

- **Skop:** SEMUA order stokis (semua courier, semua payment), bukan J&T sahaja. Sebab
  stokis hantar lintas courier, kira J&T je akan undercount botol dia.
- **Apa dipapar:** jadual ringkas (satu baris per stokis: order disahkan, botol paid,
  botol free, botol total, botol belum disahkan) + drill-down pilih stokis tengok order
  satu satu berserta status duit (disahkan / belum disahkan).

### Keputusan seni bina (PENTING untuk fasa depan): pengesahan "duit dah masuk"

- **Fighter = foundation / "apa yang sepatutnya".** Fighter sahaja TAK boleh sahkan duit
  dah masuk, dia cuma kata order ni sepatutnya berlaku.
- **Pengesahan "dah paid" datang dari feed duit sebenar, di-upload BERASINGAN:** bil
  courier untuk order COD (J&T sekarang, Ninja/DHL nanti), report CHIP / online transfer
  untuk order prepaid. Satu order kira botol bila dipadan dengan feed duitnya.
- **Botol dikira HANYA bila order Completed DAN duit disahkan.** Yang belum ada feed =
  "belum disahkan", dan flip jadi disahkan AUTOMATIK bila feed masing masing di-upload,
  tanpa rework.
- **Titik sambungan TUNGGAL:** `db.confirmed_paid_order_ids(conn)`. Hari ni ia padan
  order ke `cod_bill_lines` (J&T COD) ikut tracking. Nak tambah feed baru nanti, cukup
  union set order_id di sini, semua paparan yang guna fungsi ni update sendiri.

### Fail / fungsi (TAMBAH sahaja, logik recon tak disentuh)

- `db.confirmed_paid_order_ids(conn)` , set order_id yang duitnya disahkan (extension point).
- `reconcile.bottles_per_order(conn)` , botol per order untuk SEMUA order + flag
  `duit_disahkan` / `botol_dikira`. ASING dari `reconcile()`, guna semula `_bottles_for_skus`.
- `app.py` , tab "Per Stokis" (import + 1 panggilan + 1 tab). Tiada perubahan schema.

### Verifikasi

- `python reconcile.py` output IDENTIK baseline (logik enjin langsung tak disentuh).
- Cross-check: botol dikira (369 order, 1099 botol) == J&T COD tally dari recon (369/1099),
  sahkan set "disahkan" hari ni betul betul = set duit J&T dalam bil.
- AppTest tiada exception, 5 tab render. Snapshot data semasa: 1208 order, 369 disahkan,
  selebihnya belum disahkan (courier lain / prepaid / J&T belum masuk bil).

## Milestone 5: Shell berbilang anak syarikat + UI English (2026-06-22)

Rombak app dari satu page recon J&T jadi **shell dashboard berbilang anak syarikat**,
langkah bina pertama dari blueprint architecture (lihat bawah). Enjin recon TAK disentuh.

- **Navigasi (tiada sidebar, butang + `st.session_state`):** landing peringkat Group
  papar kad per anak syarikat (Dicci Impact aktif; Flux/HUB/Dicci Group "coming soon").
  Tekan "Open" → page anak syarikat.
- **Page Impact:** butang "← All companies", Operations panel (upload/tetapan/status),
  strip "Income streams" (J&T COD live; DHL/Ninja Van/CHIP/Bank Transfer/TikTok slot
  "coming soon" disabled), kemudian dashboard recon J&T sedia ada di bawah.
- **UI English sepenuhnya** (ikut preference owner, produk kerja default English): shell +
  semua bahagian sedia ada ditukar. Kod kategori recon kekal (enjin), tapi DIPAPAR English
  via `theme.KAT_LABEL_EN` + `theme.kat_label` (`style_kategori` guna `Styler.format`,
  warna kekal ikut kod). Header jadual relabel via `st.column_config` (nama lajur dalaman
  kekal). `reconcile.py` report.txt KEKAL BM (artifak CLI, itu baseline regression).
- **Feed registry:** `ingest.detect()` jadi senarai `FEEDS` (tandatangan lajur → nama).
  Tambah courier/feed baru = daftar satu entry, tingkah laku jnt/fighter kekal.

### Fail disentuh
- `app.py` , rewrite jadi shell (router + render_group_landing / render_impact /
  render_jnt_stream / render_stream_placeholder / render_ops_panel / render_stream_strip).
- `theme.py` , `KAT_LABEL_EN` + `kat_label` + `style_kategori` format English + string
  `alert_band`/tooltip chart English.
- `ingest.py` , `detect()` jadi registry `FEEDS`.
- `db.py`, `reconcile.py` , TIDAK disentuh.

### Verifikasi
- `python reconcile.py` output IDENTIK baseline (enjin tak tersentuh).
- AppTest tiada exception untuk semua view (group landing, Impact+J&T, placeholder
  DHL/TikTok/Flux), 5 tab render. `detect()` registry kekal kenal jnt/fighter/None.
- Screenshot headless (chrome-headless-shell + node CDP) sahkan dua dua page render
  cantik, English, navigasi butang berfungsi.

## BLUEPRINT ARCHITECTURE (vision penuh, walkthrough owner 2026-06-21/22)

Skop projek diperluas: dari alat recon J&T jadi **satu sistem dashboard finance untuk
seluruh Dicci Group**. Keputusan seni bina dikunci:

- **Struktur:** Dicci **Group** = induk. Anak syarikat: **Impact**, **Flux** (= team HQ
  in-house yang run ads), **HUB**, dll. Roadmap: Impact dulu → Flux/HUB → Group. Dashboard
  = button per anak syarikat → page upload + tengok angka. Pengguna = team finance.
- **Fasa 1 DIPERLUAS:** bukan J&T COD sahaja, tapi **SEMUA duit masuk Dicci Impact**.
  J&T siap; sambung DHL, Ninja Van, prepaid (CHIP/transfer), TikTok satu satu.
- **Model bisnes Impact:** Sistem Fighter = app pihak ketiga, sumber kebenaran order.
  Sejak ~Mac 2026 setiap anak syarikat ada Fighter sendiri (Impact bersih). Hampir semua
  duit tercatat di Fighter KECUALI TikTok (standalone, takde padanan). Setiap saluran
  bayaran = "feed duit masuk" direkonsiliasi lawan Fighter ikut tracking.
- **Platform berperingkat (TERKUNCI):** kekal Streamlit untuk Fasa 1 (guna semula enjin
  terbukti, murah), reka data model multi-syarikat + terasing dari sekarang, migrate ke
  **Next.js + Vercel** bila enjin semua stream terbukti (di situ keselamatan penuh:
  firewall/WAF, auth, pengasingan data). **Keselamatan = tiang reka bentuk** (owner nak
  hardened in future). Reset password Neon = sebahagian security hygiene ni.
- **Diperlukan dari owner (langkah seterusnya):** PDF sampel J&T/DHL/Ninja Van + bentuk
  export TikTok & report CHIP/online transfer, untuk bina parser feed setiap saluran.
- **Diparkir:** laluan komisen sebenar Impact (duit Impact hakikatnya komisen), 2 bank
  Impact, jualan offline, operasi anak syarikat lain.

## ARCHITECTURE TERKUNCI (kunci 2026-06-23)

Prinsip teras + keputusan skala, dikunci selepas borak owner. Ini "architecture solid"
rujukan untuk semua kerja seterusnya.

**1. Lapisan KEKAL vs SEMENTARA (paling penting):**
- DURABLE (hidup merentas platform, dalam Neon Postgres): schema/model jadual kongsi
  normalized, index, dan (nanti) recon sebagai SQL view. Constant untuk Streamlit DAN Next.js.
- SEMENTARA (Streamlit-only, terbuang bila pindah): `@st.cache_data`, vectorize pandas
  engine, had paparan `st.dataframe`, semua kod UI Streamlit.
- **Prinsip: LABUR pada lapisan DB + fasa Next.js. JANGAN over-invest optimization khas Streamlit.**

**2. Corak feed (auto-detect):**
- Satu titik upload. Tiap fail: KATEGORI dulu (cap jari lajur unik) → HALA ke parser →
  NORMALISE → simpan ke jadual betul (idempotent).
- Cap jari: Fighter=`Order ID`, J&T=`AWB No.`, DHL=`DHL Parcel ID` (UTF-16), Ninja=
  `Global Shipper ID`, CHIP=`Reference Nr.`.
- Tambah courier/feed baru = daftar parser + nilai courier, **SIFAR perubahan schema**.
- Fail tak dikenal = ditanda, tiada ditulis. Upload ulang = tak double count.

**3. Model data (jadual kongsi normalized , JANGAN pecah per courier):**
- `orders` (Fighter), `cod_bills` + `cod_bill_lines` (courier COD, dibeza lajur `courier`),
  `prepaid_payments` (gateway prepaid), `sku_bottles`.
- Pecah jadual per courier = anti-pattern (UNION kompleks, tambah jadual tiap courier).

**4. Pengesahan duit:**
- Fighter = sumber kebenaran order. Courier COD padan ikut **tracking**; prepaid padan ikut
  **order_id**; TikTok standalone. `db.confirmed_paid_order_ids` = titik sambungan TUNGGAL.

**5. Skala (ratus ribu+ baris):**
- Bukan masalah saiz DB (Postgres boleh juta baris). Bottleneck = recompute tiap rerun Streamlit.
- Jawapan skala SEBENAR = **fasa Next.js**: push recon ke SQL view/aggregation + index;
  frontend cuma query ringkasan.
- JANGAN SQL-ify sekarang , logik recon masih berkembang (pandas lagi senang iterate).
  Konsisten dgn keputusan asal "jangan SQL view lagi".
- Perf Streamlit (cache/vectorize) = TANGGUH, buat HANYA kalau Streamlit betul betul lembab.

**6. Subsidiary scoping:**
- CHIP = duit mendarat bank Dicci GROUP, bukan Impact. Dikekalkan DORMAN bawah Impact
  (`active=False`), diaktif bila subsidiary Group dibina.

**7. UI / nav:**
- Nav kiri guna KOLUM biasa (bukan `st.sidebar`), boleh buka/tutup jadi rail ikon , immune
  dari bug `st.sidebar` collapse. Dashboard roll-up = default. UI English penuh.

## Milestone 6: Pas keselamatan pra-handoff + pelan handoff data-safe (2026-07-01)

Tujuan: pass app ke team finance untuk TRIAL (upload data betul, tengok gambaran besar),
tanpa data hilang bila kita adjust nanti (supaya mereka tak perlu upload banyak kali).
Cadangan dijana + ditapis 3 pusingan judge-refine multi-agent (agent baca kod sebenar).

Prinsip teras: data hidup dalam Neon Postgres, redeploy kod TAK sentuh data (`init_db`
guna `CREATE TABLE IF NOT EXISTS` + seed hanya bila kosong). Yang perlu dijaga = beberapa
laluan tertentu yang boleh hilang / rosakkan data.

**SIAP (commit 9d86267 + 88eba88, live):**
- `app.py`: butang "Reset store" disorok di belakang secret `ADMIN_MODE` (absent = tersembunyi,
  fail-safe). Finance tak nampak. Set `ADMIN_MODE` di Streamlit Secrets bila nak wipe sengaja.
- `app.py`: caption amaran upload ("upload export PENUH terkini je") , elak upsert overwrite
  senyap status/tracking/harga bila fail lama/ditapis di-upload.
- `app.py`: rollback per fail dalam loop ingest , satu fail rosak tak cascade-gagalkan yang lain.
- `app.py`: caption tarikh rujukan aging (18 Jun 2026) , finance tak salah baca bucket lewat.
- `backup.py` BARU: `python backup.py` snapshot + `--verify` content-hash semua table durable
  ke `backups/` (gitignored). Kesan wipe / overwrite senyap / re-point awb, bukan setakat wipe.
- Enjin recon (`db.py`/`reconcile.py`/`ingest.py`) TAK disentuh, output identik baseline (369 / RM63,912).

**PENDING (perlu tindakan owner / data betul):**
- ⛔ **GATE (keputusan owner 2026-07-01):** rotate ditangguh buat masa ni (DB kosong = risiko
  rendah). Trial dengan data dummy/throwaway OK tanpa rotate. TAPI **JANGAN jemput finance
  upload data BETUL sebelum Langkah 4 (rotate) selesai** , saat data betul masuk, kredential
  perlu dah bersih.
- [ ] **Langkah 4 (owner, Neon console):** rotate kredential Neon (security hygiene). Buat
  role/password baru -> update secret `DATABASE_URL` Streamlit -> reboot -> sahkan reconnect ->
  baru revoke yang lama (revoke-old-last = zero downtime). Simpan salinan URL di tempat selamat
  (password manager) selain Streamlit Secrets. Catat PITR window free tier + ada branching ke
  tak. BUAT SEBELUM finance upload data betul.
- [ ] **Verify seed-immune:** JANGAN gate pada "ada row" , `_seed_sku_bottles` auto-insert 9
  `sku_bottles` pada DB kosong, jadi DB salah/kosong pun nampak "ada row". Green-light betul =
  `SELECT COUNT(*) FROM orders` == N tepat yang finance upload (rekod di HANDOVER masa upload)
  DAN `COUNT(*) cod_bill_lines > 0`.
- [ ] **Langkah 5-6:** handoff ke finance; catat `COUNT(orders)` tepat selepas upload pertama.
- [ ] **Langkah 7-9:** `python backup.py` lawan Neon SEBELUM tiap deploy kita + rehearse restore
  sekali. Fail-loud kalau bukan Postgres (app.py request-path, BUKAN import-time raise). Nota OPS
  (satu uploader satu masa; disiplin nama fail; collision awb antara courier sebab
  `cod_bill_lines` PK = awb tanpa prefix courier).
- Ditangguh ke Next.js: staging DB, upsert newer-wins, composite PK, CI schema guard, export nightly.

## Milestone 7: Foundation ingestion komisen stokis (Fighter Wallet) (2026-07-01)

Konteks: finance nak rekonsiliasi komisen stokis (tally dengan Fighter + duit dibayar ke
stokis). Sumber "duit keluar" = export Fighter Wallet (dompet komisen per stokis; Fighter
DAH kira komisen ikut level = lajur `Seller Role`: FIGHTER / FIGHTER PRO / MASTER / LEADER).

**SIAP (commit e5db432, live, additive, enjin recon TAK disentuh):**
- `db.py`: jadual durable `wallet_txns` (txn_id PK, order_id, seller_role, txn_type IN/OUT,
  source Sales/Recruitment/Withdraw/Transfer, status, amount, dll) + index order_id/seller_name.
- `ingest.py`: parser `ingest_wallet` + daftar dalam FEEDS. Signature `Transaction ID` (diletak
  SEBELUM fighter sebab Wallet ada `Order ID` juga). Idempotent by txn_id; order_id dinormal
  supaya join `orders.order_id`.
- Diuji: detect=wallet, 768 baris idempotent, join Sales->orders 427 sepadan, output recon identik.
- **View Commission SIAP (commit 2223891):** nav "💰 Commission" bawah Impact, papar earned vs
  paid + level per stokis (record-only, guna angka Fighter terus; finance nak rekod + tally
  dengan pembayaran). Read-only, additive.

**PENDING (tunggu finance):** Tally penuh vs order (confirmed-paid). Tally A = komisen Wallet vs order
confirmed-paid (recon sedia ada). Tally B = earned(IN) vs withdraw(OUT) = baki dompet.
Tunggu 2 jawapan finance (Withdraw dalam Wallet vs transfer bank; percaya vs sahkan angka
Fighter) + 1 set data period sama (Google Sheet + Wallet + export order Fighter).

## Insiden ops: crash selepas deploy reconSql (2026-07-03, SELESAI)

- Gejala: app live crash masa boot, `AttributeError` pada `db.ensure_order_skus`. Punca:
  Streamlit Cloud sync kod baru TANPA restart proses Python, jadi app.py baru jalan dengan
  modul db.py lama dalam memori. Kod repo + data Neon tak terjejas langsung.
- SOP bila jadi lagi: **Reboot app** dari share.streamlit.io (akaun diccigroupmarketing).
  Push tambahan TAK menyelesaikan (punca memang sync-tanpa-restart). PENTING: reboot TAK
  memadam data, data duduk dalam Neon, bukan dalam container app.
- Disahkan lepas reboot: Neon connected (heartbeat `app_meta.last_app_boot` hidup, boleh
  semak dari terminal), dashboard kira betul (J&T 369 parcel, net remit RM 63,036.17,
  0 exception, padan baseline).
- Keadaan data live Neon masa insiden ditutup: masih data SAMPEL ujian (1,208 orders,
  1 bil J&T dengan 369 baris, 768 wallet txns, 0 prepaid), BUKAN kosong. Kalau nak mula
  bersih untuk finance, kena Reset store (secret ADMIN_MODE) atau padam via SQL,
  reboot sahaja tak mengosongkan apa apa.
- **Hardening SIAP (2026-07-03, commit 503fe70):** guard self-heal dalam app.py. Setiap
  run kesan 2 isyarat: handshake `db.MODULE_REV` (proses zaman pra-guard) + mtime fail
  modul berubah sejak dimuatkan (deploy seterusnya). Bila basi: reload semua modul projek
  ikut urutan dependency (db → reconcile → ingest → reconSql → theme) + clear cache data.
  Gagal reload = fallback tingkah laku lama (Reboot manual). Diuji AppTest: boot normal,
  simulasi basi handshake, simulasi basi mtime, run selepas heal, semua lulus; baseline
  recon identik. Import app.py ditukar ke bentuk modul (`ingest.ingest_buffer`) supaya
  resolve masa panggil, dan import INTEGRITY_EXC/AGED yang tak diguna dibuang.
- **Store live DIKOSONGKAN SENGAJA (2026-07-03, arahan Adi):** backup penuh dulu ke
  `backups/20260703-091755` (semua table + content hash), kemudian `db.reset_db()` lawan
  Neon dari terminal. Selepas padam: semua table transaksi = 0, `sku_bottles` kekal (9).
  Nota cache: padam dari luar app TAK invalidate `st.cache_data` (TTL 1 jam), jadi app
  perlu 1 reboot lagi untuk papar kosong serta merta. Restore kalau perlu: CSV dalam
  folder backup tu.

## FASA NEXT.JS DIMULAKAN (keputusan owner 2026-07-03)

Owner mahu tinggalkan Streamlit SEKARANG, sebab utama = kualiti UI/UX. Ini selari dengan
blueprint terkunci (Streamlit memang lapisan sementara), cuma timing diawalkan, tak
tunggu semua stream terbukti. Lapisan DURABLE tak terjejas: Neon + schema + logik recon
SQL (reconSql) dibawa terus.

**4 keputusan dikunci (dipersetujui Adi):**
1. **Strategi:** bina SELARI. Streamlit kekal live (dah stabil + ada guard self-heal)
   sepanjang pembinaan; tutup hanya bila Next.js capai parity dan Adi puas hati.
2. **Ingest:** UI upload dalam Next.js, fail dihantar ke **Python serverless functions
   di Vercel** yang guna semula parser `ingest.py` sedia ada (DHL UTF-16, CHIP header
   terkubur, upsert idempotent), sifar penulisan semula parser = sifar regression risk.
3. **Auth:** **Clerk** (managed, Vercel Marketplace, allowlist email team finance, MFA).
4. **Proses design:** mockup diluluskan DULU baru tulis kod app.

**Mockup v1 (2026-07-03):** artifact `https://claude.ai/code/artifact/c5ee1e1d-0c20-4b22-992a-fafcc21117cf`
, 2 skrin interaktif (Dashboard + stream J&T COD, nav kiri boleh klik). Design language:
brand terkunci (teal #0A3D45 + emas #D6B467, Fraunces/Manrope), sidebar gelap teal,
hero band net remit, KPI tiles, chart emas gelap #A8853B (lulus validator kontras),
chip status (Clean/Awaiting bill/Aged), jadual audit tabular-nums. **DILULUSKAN Adi.**

**App v1 DIBINA (2026-07-03, folder `webApp/`):** Next.js 16 + TypeScript, App Router,
CSS tokens dari mockup (tanpa Tailwind), font next/font (Fraunces + Manrope).
- Laluan: `/impact` (dashboard roll-up), `/impact/streams/[jnt|dhl|ninja]`,
  `/impact/commission`. Server components baca terus Neon (pg Pool).
- `lib/recon.ts` = port SETIA reconSql.py (Postgres sahaja, tiada fork SQLite; corak
  tmp table SATU transaksi + rollback dikekalkan, selamat pooler Neon).
  **PARITY LULUS**: `scripts/parityDump.py` + `scripts/parityCheck.ts` banding agregat
  TS lawan Python atas data sampel, ketiga tiga stream PADAN (kat_n, daily, per_bill,
  lines, tally). PERATURAN kekal: ubah reconcile.py dulu > reconSql.py > lib/recon.ts.
- Dev tanpa sentuh Neon produksi: `scripts/devDb.mjs` (Postgres EMBEDDED dalam
  node_modules, port 5433) + `scripts/loadDevDb.py` (muat snapshot backups/ ke dev DB,
  sekali gus latihan restore). `.env.local` tunjuk ke dev DB.
- Jalan lokal: `node scripts/devDb.mjs` (background) -> `npm run dev` atau
  `npm run build && npm run start` -> localhost:3000.
- **DEPLOYED KE PRODUCTION (2026-07-03): `https://diccigroupfinance.vercel.app`**
  (projek Vercel `diccigroupfinance`, team DICCI IMPACT SDN BHD, env DATABASE_URL
  production = Neon). Smoke check lulus: / redirect, /impact render empty state
  (Neon memang kosong), stream + commission 200.
- ~~⛔ GATE: app Vercel belum ada auth~~ **SELESAI 2026-07-04, lihat entri CLERK LIVE
  bawah.** Gate tinggal SATU sebelum finance upload data betul: rotate kredential Neon.
- **INGEST SIAP (2026-07-03): upload berfungsi penuh dalam app Vercel.** Seni bina:
  browser -> route Next `/api/upload` (tanpa token di browser) -> function Python
  `/api/pyIngest` (guard `UPLOAD_TOKEN`, env production) -> parser `ingest.py` SEBENAR
  (salinan setia dalam `webApp/api/engine/`, sync via `scripts/syncEngine.sh`, JANGAN
  edit salinan terus) -> upsert idempotent ke Neon. Dev lokal: `INGEST_MODE=local`
  dalam .env.local -> route spawn `scripts/devIngest.py` (enjin rujukan root, tulis ke
  dev PG embedded). Had fail 4MB/fail (had body function Vercel).
  Diuji: E2E lokal fighter 852 baris idempotent (count tak berganda) + fail tak
  dikenali = tiada tulis; produksi: function tanpa token = 401, laluan penuh dengan
  fail tak dikenali = kind null TANPA tulis, Neon disahkan kekal 0 orders.
- **PARITY FEATURE SIAP (2026-07-04):** page `/impact/stockists` (botol per stokis +
  drill-down order, port setia stockist_bottles/stockist_orders, MASUK parity harness
  dan LULUS) + `/impact/skus` (paparan mapping SKU, read-only sampai Clerk, edit
  kekal di Streamlit sementara) + grain switcher chart Daily/Weekly/Monthly
  (dashboard & stream, label paksi pintar bila bar banyak). Parity checker turut
  diperketat: stable stringify rekursif (compare lama boleh langkau nested senyap).
- **Fix modal upload (2026-07-04, commit bf64441):** modal terperangkap belakang kad
  (sidebar sticky+overflow = stacking context; bug ketara di Safari). Fix: createPortal
  ke document.body + z-index 1000. Disahkan atas produksi.
- **STATUS DATA PRODUKSI (2026-07-04):** Adi upload data sampel melalui app baru
  (upload BERFUNGSI; bug tadi visual sahaja). Neon kini ada ~1,208 orders / RM63k
  (set sampel Mei-Jun). ~~NOTA: app public tanpa auth~~ SELESAI: sejak Clerk LIVE
  (2026-07-04) data dah terlindung belakang sign-in, keputusan wipe tak perlu lagi.
- **CLERK LIVE (2026-07-04): app Vercel TERKUNCI penuh belakang sign-in.** Cara pasang:
  Vercel Marketplace (`vercel integration add clerk`, resource `clerk-cinereous-sail`
  bawah team DICCI IMPACT, billing bersatu, TIADA akaun Clerk berasingan), keys auto
  masuk semua env Vercel. Kod: `proxy.ts` (Next 16 guna proxy.ts, BUKAN middleware.ts;
  clerkMiddleware lindung SEMUA laluan kecuali `/sign-in` dan `/api/pyIngest` yang
  kekal guard UPLOAD_TOKEN sendiri sebab dipanggil server-to-server tanpa cookie),
  ClerkProvider dalam layout root, page `/sign-in` berjenama Dicci (SignIn appearance:
  colorPrimary teal; nota v7: variable `colorForeground`, BUKAN colorText), guard
  `await auth()` dalam `/api/upload` (defense in depth), user chip sebenar + sign out
  dalam Sidebar. Sign-up DIKUNCI allowlist sahaja (PATCH /v1/instance/restrictions via
  Backend API), allowlist semasa: impactdicci@gmail.com + diccigroupmarketing@gmail.com.
  Tambah team finance: dashboard Clerk ATAU POST /v1/allowlist_identifiers guna
  CLERK_SECRET_KEY. Disahkan produksi: /impact redirect sign-in (browser sebenar;
  curl nampak 404 `dev-browser-missing`, itu normal instance dev), Adi berjaya masuk
  guna email. NOTA: instance Clerk = DEVELOPMENT (banner "Development mode" pada kad
  sign-in), instance production Clerk perlukan custom domain, tak boleh atas
  .vercel.app; okay untuk internal sementara. Kosmetik pending: rename app dalam
  dashboard Clerk (sekarang "clerk-cinereous-sail"), enable MFA. AWAS dev lokal:
  `vercel env pull` / `vercel integration add` OVERWRITE .env.local, kena restore
  DATABASE_URL dev + INGEST_MODE=local selepasnya.
- **SKU EDITOR + ADMIN RESET LIVE (2026-07-04 bina, 2026-07-05 deploy):** page
  `/impact/skus` kini BOLEH EDIT (dulu read-only). Env `ADMIN_EMAILS` prod DAH
  DISET di Vercel: `impactdicci@gmail.com,aimandicci07@gmail.com` (aiman juga dalam
  allowlist Clerk). Deploy disahkan: /impact, /impact/skus, /api/skus,
  /api/admin/reset semua terlindung (404 tanpa sesi, tiada mutasi), /sign-in 200. Seni bina: `lib/mutations.ts`
  (port setia db.py: `saveSkuMap` = ganti PENUH sku_bottles macam save_sku_map tapi
  dibungkus transaksi rollback-safe; `resetStore` = padam 6 jadual transaksi, KEKAL
  sku_bottles macam reset_db; `isAdmin` = allowlist env ADMIN_EMAILS). Route:
  `PUT /api/skus` (semua ahli sign-in boleh edit mapping) + `POST /api/admin/reset`
  (admin sahaja, perlu confirm:true). Dua dua guard `await auth()` + admin guna
  `currentUser()` email lawan ADMIN_EMAILS. UI: `SkuEditor.tsx` (edit inline, add/
  delete row, validasi SKU kosong/pendua case-insensitive, Save/Revert) +
  `StoreDanger.tsx` (danger zone admin, checkbox confirm, papar kiraan store).
  NOTA penting: ubah sku_bottles TAK perlu rebuild order_skus , botol dikira SQL
  join `UPPER(TRIM(sb.sku))=os.sku` masa recon, jadi nilai baru auto diambil.
  Ini BUKAN ubah logik recon (cuma data config), parity harness tak terjejas.
  Diuji: `scripts/testMutations.ts` (16 assertion LULUS atas dev PG , saveSkuMap
  self-restoring, resetStore betul + restore via loadDevDb, isAdmin; skrip ada
  guard tolak DATABASE_URL bukan localhost). Auth gating disahkan: PUT/POST tanpa
  sesi = 307 sign-in, DB tak berubah.
  PENDING kecil (perlu login Adi ke Clerk Dashboard, TAK boleh via API):
  (a) semak visual editor + danger zone dalam browser bila sign-in;
  (b) rename app Clerk `clerk-cinereous-sail` -> "Dicci Group Finance" (buang nama
      pelik atas kad sign-in), Dashboard > Application settings;
  (c) enable MFA (User & Authentication > Multi-factor). API Backend Clerk tak
      dedah nama app / MFA, jadi kedua dua kerja Dashboard.
- **PERF FIX region (2026-07-05, commit 5cb1726):** dashboard dulu delay ~4s.
  Punca: function Vercel jalan iad1 (US East) tapi Neon di Singapura, ~18 round-trip
  SQL berturut per stream × 3 stream merentas US<->SG (~220ms/round-trip). Fix:
  `regions:["sin1"]` dalam vercel.json (Hobby benarkan 1 region pilihan), function
  serumah Neon. Disahkan `x-vercel-id` compute = sin1 (dulu iad1). Zero perubahan
  logik recon. Nota masa depan kalau data membesar/masih terasa lag: recon masih
  ~18 round-trip sequential/stream, lever seterusnya = cache hasil recon antara
  upload (revalidateTag) SEBELUM SQL-ify (rujuk CLAUDE.md "jangan over-invest perf").
- **POLISH BATCH (2026-07-05, belum deploy):** hasil audit 3 subagent. Dibetulkan
  (semua lokal, tak sentuh logik recon, build + 16 assertion lulus):
  (1) BUG copy empty-state , dulu suruh guna Streamlit untuk upload, kini tunjuk
      butang Upload sidebar (upload webApp memang dah live);
  (2) `lib/db.ts` , tambah `pool.on('error')` (elak crash bila Neon tutup client
      idle) + max 8 + connectionTimeout 10s;
  (3) `app/impact/loading.tsx` skeleton (klik nav/grain tak lagi nampak beku) +
      `app/impact/error.tsx` sempadan error berjenama + butang cuba semula;
  (4) modal upload a11y , Escape tutup + fokus masuk/pulang + aria-modal;
  (5) `--faint` digelapkan (#8A9698 -> #61706F) lulus kontras AA;
  (6) `mutations.ts`/`skus route` , guard elemen null + had 2000 baris;
  (7) SKU input `aria-invalid`.
- **BANK CONFIRMATION LIVE (2026-07-05, deploy disahkan):** TUTUP gelung Fasa 1.
  Granulariti PER BIL (satu bil courier = satu payout = satu deposit bank).
  Jadual baru `bank_deposits` (bill_id PK, actual_amount, deposited_on, note,
  entered_by, updated_at) , additive, ditambah ke `db.py` schema (sumber kebenaran)
  + `lib/bank.ts` ensureTable cipta lazily dari webApp (tak bergantung boot
  Streamlit). Route `PUT/DELETE /api/bank` (auth + entered_by dari currentUser).
  UI: `components/BillsTable.tsx` (client) ganti jadual Settlement bills statik ,
  kolum "In bank" boleh edit inline + "Variance" (net dijangka tolak bank sebenar;
  chip Matched/Awaiting/beza berwarna) + ringkasan (X dari Y bil disahkan, jumlah
  bank vs jangka, variance keseluruhan). Variance bukan sifar = tanda bocor.
  BUKAN ubah logik recon (lapisan atas). Diuji: `scripts/testBank.ts` 8 assertion
  LULUS (ensureTable, upsert, guard negatif, padam, tiada baris berganda), auth
  gating 307 tanpa tulis, PARITY harness LULUS (recon identik selepas tambah jadual).
- **AUDIT BACKLOG (dari 3 subagent, ikut nilai-usaha):**
  BESAR: ~~(a) bank confirmation~~ SIAP (lihat atas); (b) cache recon `revalidateTag` invalidate
  masa upload/reset/sku-save , lever perf yang HANDOVER dah namakan.
  PARITY (blok tutup Streamlit): by-bill parcel drill (`bill_parcels`), audit tab
  penuh (`stokis_kat`/`other_courier`/`unmapped_skus`), commission drill
  (`commission_breakdown`/`commission_names`), aging control (REMIT_PENDING_DAYS).
  CEPAT: ~~CSV export exceptions~~ SIAP + ~~freshness pill~~ SIAP (2026-07-05,
  belum deploy: `lib/recon.ts` lastIngest MAX(ingested_at) merentas feed ->
  header pill "Data as of ..."; `components/ExportCsv.tsx` muat turun CSV
  client-side dari s.integ, butang pada kad Integrity exceptions; parity LULUS).
  ~~order/tracking search~~ SIAP (deploy 5 Jul, /impact/search + searchOrders).
  ~~audit log~~ SIAP (belum deploy): jadual additive `app_events` (db.py +
  `lib/audit.ts` logEvent best-effort, tak pernah lempar) diwayar 4 route mutasi;
  page `/impact/activity` + nav "Activity".
  ~~port Streamlit~~ SIAP (belum deploy): billParcels drill (BillsTable expand),
  commissionBreakdown drill (CommissionTable), AgingControl ?pending=, unmappedSkus
  amaran di SKU page. Route on-demand /api/billParcels + /api/commission. ~~LAGI belum
  diport~~ SIAP + DEPLOYED 6/7 Jul (dpl_5GFMo3): stokis_kat cross-tab + other_courier table
  ditambah ke stream page (lib/recon.ts streamSummary + [stream]/page.tsx) = jurang
  parity TERAKHIR lawan Streamlit ditutup, Next.js cover 100% view Streamlit. Parity
  harness diperluas cover kedua dua (banding code-point), LULUS + build hijau.
  ~~cache recon~~ SIAP (belum deploy): unstable_cache tag "recon" bungkus 7 agregat
  (versi *Impl dieksport untuk skrip parity/test sebab unstable_cache perlu konteks
  request Next), revalidateTag("recon",{expire:0}) pada upload/sku-save/reset =
  read-your-writes; drill/search/bank tak di-cache. revalidate 3600s backstop.
  FIX bonus: buang ';' dalam komen SQL db.py (pecahkan pemisah statement init_db,
  akan pecah boot Streamlit juga).
  DEPLOYED 5 Jul (batch): gate + region sin1 utuh, semua route baru terlindung
  (404 tanpa sesi), sign-in 200. ✅ Cache: render authed DISAHKAN 6/7 Jul (Adi buka empat page di produksi,
  render elok, cache batch 3 tak pecah). Substantif turut disahkan lokal: build +
  parity + smoke 9 fungsi cached tak lempar. Kalau nanti pecah, cache boleh dibuka
  balik (recon.ts: tukar export cached jadi fungsi biasa). Parity LULUS setiap langkah.
  FLAG (perlu keputusan, ubah output):
  TLS verify-full masa rotate Neon; cutoff `TODAY` tz-dependent (fix ikut parity);
  frozen aging date 18 Jun 2026 bila baseline dibuka semula dengan Adi.
- PENDING fasa seterusnya: rotate kredential Neon (GATE terakhir sebelum finance upload
  data betul, RUNBOOK SIAP di `rotateNeonRunbook.md` root gitignored, Cara A role baru
  zero-downtime + Cara B reset + flag TLS verify-full). Bila rotate: **update env Vercel
  SAHAJA** (keputusan 8 Jul, lihat seksyen "keputusan Streamlit lama"); Streamlit dibiar
  basi = bersara sendiri, tak perlu formal delete. Next.js kini cover 100% view Streamlit
  (jurang parity terakhir ditutup 6/7 Jul).

## Sesi 6/7 Jul (lanjutan): Export finance (Fasa A + C LIVE)

Owner pilih bentuk **Hybrid + Close Pack** (via panel timbang 3 lensa). Turutan A -> C -> B.

- **Fasa A LIVE (commit e23c34f, deploy dpl_5bDZL):** butang Download CSV pada jadual
  yang page DAH pegang lengkap , settlement bills, parcels drill, stokis x kategori,
  stockist bottles + drill, search results. `ExportCsv` dijadikan generik (elak isu index
  signature interface) + isyarat **N-of-M** untuk view bercap (search 50, drill 10k) supaya
  tak menipu "lengkap". **Surface komisen SENGAJA dilangkau** (on hold, lihat bawah).
- **Fasa C LIVE (sama commit):** page `/impact/export` (Export Center) + **Close Pack CSV**
  , per stream per period (bulan settlement): parcels, COD, fee, **net remit (dijangka)** vs
  **banked (bank_deposits)** + **variance** (tanda bocor) + exceptions + grand total.
  `lib/closePack.ts` = komposisi `streamSummary` (cached) + `getBankDeposits`, SIFAR logik
  recon baru. Nav "Export" ditambah (Sidebar). Subsidiary + period first-class. Cop as-of
  dalam nama fail + header. "X of Y" (bukan "X/Y") elak Excel baca jadi tarikh.
- **Verify:** build hijau, PARITY LULUS (recon tak disentuh), closePack invariant
  (`sum(perBill.cod) == linesCod`) disahkan, net remit J&T RM63,036.17 padan baseline.
  Smoke prod: sign-in 200, /impact/export 404 (curl, normal Clerk dev), region sin1.
- **BELUM buat , Fasa B** (nilai sederhana): lapisan server `/api/export/[dataset]` +
  helper `toCsv()` + provenance IN-FILE + dataset penuh yang lebih besar dari cap page
  (exceptions penuh merentas stream, stockist orders penuh) + log `app_events`.
- **HOLD (tunggu borak owner, rekod dalam auto-memory):**
  - **Komisen** , enrich. G1 (murah, tak sentuh commissionSummaryImpl, tak parity): propagate
    chip "record-only/unverified" semua permukaan, status verification eksplisit, coverage
    period, diagnostik (source roll-up, level, Pending/Rejected asing, flag balance negatif).
    G2 (permata, perlu keputusan finance): leak detector komisen atas order BUKAN
    confirmed-paid. Dev: join `wallet_txns.order_id`->`orders` ~88% (381/431 Sales-IN-Approved),
    ~21% komisen atas order bukan-Completed/takde = calon leak. Gate G2: (a) percaya Fighter
    as-is vs sahkan; (b) "Withdraw" wallet = transfer bank keluar?
  - **Free gift** (giveaway/botol `free` + kos) , borak berasingan.
  - **Sidebar collapse toggle** , ✅ SIAP + LIVE 8 Jul (lihat subseksyen bawah).

### Sidebar collapse (icon rail) , LIVE 8 Jul 2026

Owner suka sidebar sedia ada, cuma nak butang collapse untuk big picture. Pilih bentuk
**icon rail** (bukan full-hide) supaya nav kekal satu klik.

- Butang chevron di kanan atas jenama. Klik = sidebar mengecut dari 250px jadi rail ~64px:
  teks/label hilang, ikon kekal (center), upload jadi ikon emas, avatar + sign out bertindan.
  Klik lagi = buka balik penuh.
- Pilihan disimpan `localStorage` (`dicci.sideRailed`). Inline script kecil dalam
  `app/impact/layout.tsx` set keadaan **sebelum paint** supaya tiada flash buka->tutup bila
  reload. Grid transition 200ms, dihormati `prefers-reduced-motion`. Mobile (≤940px) tak
  disentuh (butang toggle disorok, layout kekal top-bar).
- **Murni UI, recon/data langsung tak disentuh** (tiada parity perlu). Fail: `Sidebar.tsx`,
  `UploadModal.tsx`, `app/impact/layout.tsx`, `app/globals.css` (blok `:root.sideRailed`).
- Verify: `tsc` + `npm run build` hijau; browser (harness CSS+markup sebenar) sahkan
  collapse/expand, persistence reload tanpa flash, round-trip.

### Arahan dev webApp (untuk sesi kerja)
- Dev DB: `cd webApp && node scripts/devDb.mjs` (background; Postgres embedded port
  5433, data kekal dalam devPgData/) lalu `python3 scripts/loadDevDb.py` (muat snapshot
  backups/ terkini).
- App lokal: `npm run dev` (atau `npm run build && npm run start`), buka localhost:3000.
  Override dev (DATABASE_URL=dev PG port 5433 + INGEST_MODE=local) duduk dalam
  `webApp/.env.development.local` (gitignored), BUKAN lagi `.env.local` , Next utamakan
  fail ni dalam mod dev dan `vercel env pull` cuma tulis ke `.env.local`, jadi override
  dev takkan ditimpa (lihat sesi debug 11 Jul bawah).
- **WAJIB restart `npm run dev` selepas ubah mana mana fail `.env*`** , env dibaca sekali
  masa boot dan pool DB dimemo pada globalThis, betulkan env tanpa restart tak cukup.
- Parity (WAJIB bila logik recon disentuh): `python3 scripts/parityDump.py >
  scripts/parityPython.json && npx tsx scripts/parityCheck.ts` , mesti LULUS.
- Enjin berubah? `bash scripts/syncEngine.sh` (sync salinan api/engine/) sebelum deploy.
- Deploy: `cd webApp && vercel deploy --prod --yes` (deploy TAK auto dari git push).

## Sesi 8 Jul: Free gift (giveaway) tracking (LIVE)

Finance nak tahu KOS (COGS) gift percuma yang diberi (kurma, arabic gold massage,
tote, dll) supaya nampak kos/bocor. Direka lewat panel `/timbang` (3 lensa) + mockup
yang owner lulus. **Keputusan owner terkunci:**
- Gift **terikat SKU** (bukan tag per order). Finance config sekali per SKU, kos
  **auto-derive** per order dari SKU. Cermin corak `sku_bottles`.
- **Inline per SKU** (bukan katalog kongsi). **Derive live** (bukan snapshot) , konsisten
  dgn botol/recon yang recompute dari config semasa.
- Fasa 1: **gift manual je** (kurma/dll). Botol juice free (KORBAN 4+2) kekal kiraan
  tanpa kos buat masa ni.
- Kos dipapar **split confirmed vs at-risk** (gift atas order Returned/Rejected/tak-confirmed
  = potensi bocor).

**Bina (murni UI + config, SIFAR kesan parity/recon):**
- `db.py` SCHEMA: jadual `sku_gifts (sku, gift_name, unit_cost, qty; PK sku+gift_name)`.
  Config macam `sku_bottles`: **KEKAL bila reset**, jadual asing supaya `save_sku_map`
  Streamlit (DELETE+INSERT 4 lajur) tak wipe gift. Sync ke `api/engine/db.py`.
- `webApp/lib/giftsSchema.ts` `ensureGiftTable()` (cermin audit.ts) , cipta di Neon auto
  tanpa migrasi manual.
- `webApp/lib/recon.ts`: `skuGiftsList` + `giftCostSummary` (confirmed/at-risk + byGiftType)
  + `stockistGifts`. **Semua query BERASINGAN, TAK join query botol** (elak N-gift fan-out
  gandakan kiraan botol , guard sudah disahkan).
- `webApp/lib/mutations.ts` `saveGifts` (ganti gift per SKU, transaksi) + `app/api/gifts/route.ts`
  (validate, `revalidateTag recon`, `logEvent`).
- UI: `components/GiftEditor.tsx` (senarai SKU + **modal pop-up per SKU**) + page
  `app/impact/gifts/page.tsx` + nav "Free gifts" (Sidebar, bawah People) + lajur chip
  "Free gifts" + "Giveaway cost" di Stockists + subline kos giveaway di Dashboard hero.
- **Verify:** `tsc` + `npm run build` hijau; ujian data dev DB LULUS (kos derive betul +
  **GUARD: total botol IDENTIK sebelum/selepas seed gift = sifar fan-out**).
- **Pending fasa depan:** gift luar order (bukan terikat order), kos botol juice free masuk
  COGS, snapshot/period-freeze (kalau finance nak tutup buku bulanan). Nota: dev DB ada
  placeholder gift yang diseed masa ujian (boleh clear dari editor).

### Add SKU terus dari page Free gift (8 Jul, LIVE)

Owner nak finance tak payah loncat ke page SKU semata mata nak cipta SKU baru. Ditambah butang
**"+ Add SKU"** dalam page Free gift: modal cipta SKU **LENGKAP** (kod + nama + botol paid/free)
+ boleh terus lampir gift sekali. Reka bentuk penting: SKU dicipta dengan **botol betul** (bukan
0 senyap), sebab join recon `UPPER(TRIM)` , SKU 0-botol akan salah kira botol.
- `lib/mutations.ts` `addSku` , upsert SATU baris `sku_bottles` (additive, BUKAN ganti penuh
  macam `saveSkuMap`). Tolak kalau SKU dah wujud (case-insensitive) , elak baris case-variant
  = double count botol. Error "sudah wujud" -> route balas **409**.
- `app/api/skus/route.ts` , handler **POST** baru (auth + `revalidateTag recon` + logEvent `sku_add`).
- `components/GiftEditor.tsx` , butang "+ Add SKU" + modal mode-tambah (guna semula UI gift rows;
  medan sku/nama/botol muncul bila mode tambah). Save = POST /api/skus, lepas tu PUT /api/gifts
  kalau ada gift diisi.
- **Verify:** `tsc` + `npm run build` hijau; `testMutations.ts` +5 assertion LULUS (tambah betul,
  botol betul, tolak dup case-insensitive, tak timpa SKU sedia ada, restore ke 9). SIFAR kesan
  recon/parity (lapisan config). Semak visual browser (localhost, dev DB) DISAHKAN Adi.
  **DEPLOYED 8 Jul (dpl_Hei9F8firXAfLHzxkJLKmWQxAzun):** smoke lulus (sign-in 200, /impact/gifts
  + /api/skus 404 via curl = terlindung). Butang "+ Add SKU" hidup di app live.

## Sesi 8 Jul (lanjutan): keputusan Streamlit lama + rotate Neon

Borak owner pasal butang reset data + nasib app Streamlit lama. Keputusan dikunci:

- **Neon vs Supabase: KEKAL Neon.** Ditanya owner, disahkan tak tukar. Neon dah live,
  Postgres tulen, recon SQL biasa. Tukar Supabase = migrasi kosong (sifar untung fungsi);
  batteries Supabase (auth/storage/realtime) tak perlu sebab auth dah Clerk.
- **App Streamlit lama TAK jadi dibuang (kekal buat masa ni).** Ia redundant (Next.js dah
  cover 100%) TAPI harmless: dua app baca Neon yang SAMA, biar hidup pun tak ganggu data,
  free tier tak makan kos, app private (allowlist). Delete boleh bila bila (2 minit).
- **Bila rotate Neon nanti: update env Vercel SAHAJA, ABAIKAN Streamlit.** Selepas rotate,
  password lama mati, jadi secret `DATABASE_URL` Streamlit jadi basi dan app Streamlit gagal
  connect sendiri (papar error) = cara halus ia "bersara". Tiada risiko data/keselamatan.
  Satu kesan sampingan sahaja: sesiapa yang buka URL Streamlit lama nampak error, bukan
  dashboard. Kalau nak elak kekeliruan tu langsung, baru berbaloi formal delete kemudian.
- **Lokasi butang RESET DATA (untuk rujukan):** app Next.js, page `/impact/skus`, kad
  "Store admin" (`components/StoreDanger.tsx` -> `POST /api/admin/reset` -> `resetStore`).
  Admin sahaja (env `ADMIN_EMAILS` = impactdicci@gmail.com + aimandicci07@gmail.com). Padam
  6 jadual transaksi, KEKAL `sku_bottles`/`sku_gifts`. Neon Console TIADA butang wipe satu klik.
- **Nota automation (kenapa Claude tak boleh delete Streamlit sendiri):** app Streamlit dimiliki
  akaun `diccigroupmarketing@gmail.com`, tapi extension Claude-in-Chrome TIADA dalam profile
  Chrome DC Group Marketing tu (dan takde versi Safari langsung). Yang ada extension: profile
  Chrome DC Impact di Mac (akaun impactdicci, 0 app Streamlit) + satu Chrome Windows. Jadi
  untuk apa apa tindakan pada app Streamlit, Adi kena buat sendiri (Claude pandu sahaja).

### Prod Neon bersih + PERATURAN KERJA data-safe (8 Jul 2026)

**Keadaan prod Neon disahkan 8 Jul (sambung terus, kira baris):** SEMUA jadual transaksi = 0
(orders, order_skus, cod_bills, cod_bill_lines, wallet_txns, prepaid_payments, sku_gifts).
`sku_bottles` = 9 (config seed, dikekalkan). `app_events` dibersihkan 8 Jul (2 rekod
store_reset 7 Jul dari impactdicci dibuang) supaya log audit finance mula dari kosong.
Data sampel ~1,208 order (nota lama) DAH TIADA , dikosongkan via butang reset webApp 7 Jul.
**Kesimpulan: prod sedia untuk finance upload data betul; upload mereka = satu satunya data.**
(Rotate Neon masih ditangguh , keputusan owner, bukan blok reset.)

**Objektif owner (8 Jul):** lepas finance mula upload, kerja harian mereka (upload fail) TAK
boleh terganggu bila kita adjust sistem, dan TAK payah reset data lagi. Cara capai =
peraturan kerja "dua buku":

- **Buku SEBENAR = prod Neon = data finance. SUCI.** Kita TAK PERNAH dev/test/eksperimen
  lawan prod. Butang Reset JANGAN sentuh lagi pada prod selama lamanya.
- **Kill-switch reset (15 Jul 2026):** route /api/admin/reset pulang 403 melainkan env ALLOW_STORE_RESET=1. Prod Vercel TIDAK set env ini, jadi butang Reset mustahil padam data finance; dev set dalam webApp/.env.local.
- **Buku LATIHAN = dev DB (embedded PG port 5433 + snapshot).** Semua ubah suai diuji di sini
  dulu: `node scripts/devDb.mjs` + `python3 scripts/loadDevDb.py`, ubah, test, parity kalau
  sentuh recon, baru deploy.
- **Schema TAMBAH sahaja** (jadual/lajur baru; `CREATE TABLE IF NOT EXISTS`, `ensureTable`
  lazily, seed-bila-kosong). JANGAN drop/rename destruktif , data lama tak musnah.
- **`python backup.py` sebelum deploy berisiko** (snapshot + content-hash ke backups/).
- **Deploy = kod sahaja, tak sentuh data.** Vercel tukar versi atomik ~zero downtime + rollback
  segera, jadi finance boleh terus upload masa kita deploy tanpa terganggu.

## Sesi 8 Jul: Mini page stokis (modal drill + penapis tarikh) (LIVE)

Owner nak drill-down stokis jadi **MODAL "mini page"** yang bagi potret penuh satu stokis
(bukan sekadar senarai order). Direka lewat mockup artifact diluluskan berperingkat (4 blok +
penapis tarikh + blok botol). SEMUA **additive + read-only**, **SIFAR kesan parity** (guna semula
`CONF_SQL`; TIDAK sentuh `stockistBottlesImpl`/`streamSummary`/`CONF_SQL`).

Kandungan modal (ikut tempoh dipilih):
- **Money accountability** , Expected (Σ selling_price) vs Confirmed net remit (cod_amount−fee +
  prepaid net) vs Awaiting + feed coverage + flag "duit collected on Returned" (leak).
- **Bottles moved** , Total + split Paid/Free + split Confirmed/Unconfirmed.
- **Order health** , Completed/Returned/Rejected/other + return rate + botol atas returned/rejected.
- **Commission** , earned/paid/balance + flag komisen atas order BUKAN confirmed-paid (leak).
- **Products & gifts** , top SKU ikut botol + gift confirmed + at-risk cost.
- **Orders** , senarai + lajur RM (Expected/Net remit) + Download CSV.
- **Penapis tarikh:** preset (This month / Last month / 90 days / All time) + julat From→To;
  blok order-based ikut `order_date`, komisen ikut `txn_date` (`LEFT(...,10)` immune bahagian masa).

Fail: `lib/recon.ts` (`stockistDetail` baru + `stockistOrders` diperkaya RM/tarikh),
`app/api/stockist/route.ts` (GET on-demand, auth), `components/StockistModal.tsx` (client,
createPortal, fetch per tempoh), `app/globals.css` (blok `.stk*`), `app/impact/stockists/page.tsx`
(drill inline -> `<StockistModal>`). `scripts/testStockistDetail.ts` (smoke + cross-check).

Verify: `tsc` + `npm run build` hijau; **PARITY LULUS** (recon terkunci tak berubah);
`testStockistDetail` cross-check botol confirmed/unconfirmed PADAN `stockistBottles` + penapis tarikh
berfungsi; visual localhost disahkan Adi. **DEPLOYED 8 Jul (dpl_6ngMnR1H2noTG2t4dWwrcVJvy2oQ)**,
smoke lulus (sign-in 200, /impact/stockists + /api/stockist terlindung).

## Sesi 9 Jul: Auto-daftar SKU + page Uploads (delete per fail)

Finance dah upload data betul (561 order, 2 bil J&T) tapi popup stokis papar botol 0.
Siasatan: BUKAN bug sambungan DB, tapi 16 SKU live (MYS-JAG*, MYSE-JAG*, BULK-TT-*, KJS-*)
tiada dalam katalog `sku_bottles` (hanya 9 SKU seed lama), SKU unmapped = 0 botol. Fix 3 lapis:

1. **Auto-daftar SKU masa ingest** (`ingest.py`: `derive_bottles` + `register_new_skus`,
   dipanggil dalam `ingest_fighter`). Corak nama SKU → (paid, free): `...-4-2` = 4+2,
   `...1PLUS1` = 1+1, `...JAG2-AGM1` = 2+1 (AGM = produk minyak, dikira unit free,
   keputusan owner), `...-2` = 2+0. Corak sepadan 100% dengan 9 SKU manual sedia ada.
   SKU baru dapat `product_name` penanda "Auto-added from upload, review bottle counts"
   supaya finance semak di page SKUs. Corak tak difahami TIDAK didaftar (kekal unmapped).
   Engine disync ke `webApp/api/engine`. `backfillAutoSkus.py` (root) = backfill one-off
   untuk SKU yang dah terlanjur masuk order_skus; DAH run atas dev DB, **prod Neon BELUM**
   (classifier blok tulisan prod terus), cara prod: re-upload fail Orders sama (idempotent)
   ATAU `DATABASE_URL=<neon> python3 backfillAutoSkus.py`.
2. **Amaran unmapped dalam popup stokis** (`stockistDetail` pulang `unmappedSkus[]`,
   `StockistModal` papar banner + link page SKUs bila ada SKU dikira 0).
3. **Page Uploads** (`/impact/uploads`, nav Setup): senarai fail upload (dari `source_file`
   semua jadual) + **Delete per fail** untuk fix fail tersalah upload. Semua user sign-in
   boleh (keputusan owner), TAPI dua langkah (butang → panel confirm + checkbox → butang akhir),
   audit log `upload_delete`, revalidate cache. `deleteUpload` (mutations.ts) = satu transaksi:
   orders + order_skus (ikut order_id) + cod_bill_lines + cod_bills (termasuk orphan) +
   prepaid + wallet. `scripts/testUploads.ts` = 12 PASS atas dev PG.

Nota admin: `ADMIN_EMAILS` prod DAH ada aimandicci07@gmail.com (diset 4 Jul), Aiman boleh
reset store dari page SKUs. Verify: `tsc` hijau, baseline recon kekal RM 63,912.00 (369 order),
testUploads 12/12, popup stokis dev tunjuk botol betul (MANZ VENTURE 355 total).

## Sesi 11 Jul: Debug "localhost nampak kosong" + guard dev DB (SELESAI)

Gejala: dev localhost papar dashboard kosong walaupun dev DB ada data. Punca dua lapis:
(a) Postgres embedded dev (`node scripts/devDb.mjs`, port 5433) tak dijalankan; (b) lebih
penting, `vercel env pull` pernah TIMPA `webApp/.env.local` dan buang override dev
(DATABASE_URL localhost + INGEST_MODE=local), jadi proses `next dev` yang start masa tu
pegang env basi dan baca Neon **prod** (kosong) bukan dev DB. Pool `pg` dimemo pada
`globalThis`, jadi betulkan `.env` tanpa restart penuh tak cukup , **WAJIB restart
`npm run dev`**.

**Penyelesaian kekal (dua lapis pertahanan):**
1. Fail baru `webApp/.env.development.local` (gitignored) berisi 4 override dev
   (DATABASE_URL localhost:5433, INGEST_MODE=local, NEXT_PUBLIC_CLERK_SIGN_IN_URL,
   ADMIN_EMAILS). Next utamakan fail ni dalam mod dev, dan `vercel env pull` hanya tulis
   ke `.env.local`, jadi override dev takkan ditimpa lagi.
2. DEV GUARD dalam `webApp/lib/db.ts` `getPool()` (dibina serentak oleh sesi lain, siap
   hari ni): bila `NODE_ENV=development` dan hostname `DATABASE_URL` bukan
   localhost/127.0.0.1/::1, terus `throw Error` dengan mesej jelas. Lapisan kedua supaya
   dev secara fizikal tak boleh sambung ke Neon prod walau env rosak. TAK aktif langsung
   dalam produksi (`NODE_ENV=production`).

**Workflow dev betul (rekod untuk sesi lain):** dua terminal , (1) `cd webApp && node
scripts/devDb.mjs` biar hidup, (2) `cd webApp && npm run dev`. Data dev persistent dalam
`webApp/devPgData`. Lepas ubah mana mana fail `.env*`, WAJIB restart `npm run dev` (env
dibaca sekali masa boot + pool DB dimemo).

**Nota data:** masa siasatan, fail test `fighterSample.xlsx` (852 baris) pernah di-ingest
ke dev DB dan SUDAH dibuang guna logik `deleteUpload` sebenar, kiraan dev DB kembali
baseline (orders=561, order_skus=568, sku_bottles=25). Prod Neon TAK disentuh langsung
sepanjang sesi.

**Peringatan kekal:** password Neon masih PENDING rotate (terdedah masa setup dulu) = gate
sebelum finance upload data sebenar, masih belum dibuat.

## Sesi 19 Jul: Honest breakdown baldi bayaran + accordion per-kurier + CHIP (LIVE)

Bermula dari aduan finance "1 botol tak tally" (MANZ VENTURE, kes KAKYAH, 10 Jul).
**Punca sebenar (owner sahkan):** order 6672624 (MANZ VENTURE, J&T Express, RM145)
dibayar guna gateway **CHIP** (prepaid), jadi ia TAK masuk bil COD J&T, tersangkut
"unconfirmed" selama lamanya dalam recon COD, botolnya tak masuk kiraan confirmed. Baldi
kabur "unconfirmed" tu yang mengelirukan finance , dia campur "belum remit COD" dengan
"dibayar prepaid, memang bukan COD".

**Keputusan owner (terkunci):**
- Untuk isu CHIP: pilih **"hilangkan kekeliruan sahaja"** (baldi jujur), BUKAN upload
  statement CHIP. Tally penuh CHIP (Batch D, upload statement) DITANGGUH sampai finance nak.
- **TOLAK pendekatan "percaya Fighter Payment Status = Paid"** , itu racun keupayaan
  tangkap bocor. Jalan sah = padan lawan statement CHIP sebenar. CHIP kekal `active=False`.
- Corak UI per-kurier = **accordion inline** (ditimbang panel 3 lensa, sepakat bulat),
  BUKAN popup (elak modal-dalam-modal). Owner pilih variant "label CHIP + warna + paytag".

**Deploy 1 , commit `d69489d` (Batch A/B/C, enjin + paparan):**
- **(A) Honest breakdown baldi bayaran:** pecah baldi kabur "unconfirmed" jadi baldi jujur
  , **Confirmed COD / Confirmed prepaid / Awaiting COD remittance / Awaiting prepaid
  statement / No payment feed** , diturunkan dari `payment_method`. PAPARAN sahaja, logik
  recon tak berubah.
- **(B) Banner semak SKU** auto-added + flag harga/botol rendah (bantu finance semak SKU
  yang di-auto-daftar masa ingest).
- **(C) Tebalkan feed CHIP dorman** , betulkan 3 bug terpendam: `confirmed_paid_order_ids`
  kini confirm prepaid HANYA bila status berjaya DAN `amount>0`; `ingest_chip` tapis baris
  berjaya sahaja; `_num` tak lagi jatuh senyap ke RM0. CHIP kekal `active=False`.
- **Sync salinan enjin `webApp/api/engine`** , sebelum ni salinan itu BASI (audit fix
  ddd1f82 tak pernah di-sync). Ingat: sync selepas ubah enjin root.

**Deploy 2 , commit `45838e5` (UI):**
- **Accordion pecahan per-kurier** untuk baldi COD (confirmed_cod, awaiting_cod) , buka
  inline tunjuk J&T / DHL / Ninja Van (BUKAN popup).
- Label CHIP jelas: "Awaiting prepaid statement" -> **"Awaiting CHIP statement"** + warna
  indigo (token `--info`).
- **Paytag pill** (COD / CHIP / Bank Transfer) sentiasa on.
- Fail baru: `components/CourierBreakdown.tsx`, `scripts/checkBuckets.ts` (guardrail
  `sum(byCourier)==total`). Buang `lib/useShowTags.ts`.

**Verify (kedua dua deploy):** baseline COD **RM63,912 / 369 order IDENTIK**, parity harness
LULUS, data Neon TAK disentuh, CHIP tak diaktifkan.

**PENEMUAN PENTING (rekod, banyak perlu owner/finance):**
1. **KJS-3-1 "botol free hantu" TAK sahih** , audit tunjuk amaran RM145 sebahagian artifak
   order belum selesai; order lengkap (RM297) sokong 4 botol. Perlu owner sahkan definisi
   kempen. KJS-4-2 pun perlu disahkan. KJS-1/KJS-2/MYS/MYSE ok. **Botol hantu TAK menular.**
2. **Bank Transfer (6 order) takde feed langsung** , kekal "No payment feed, cannot verify"
   sampai ada feed baru.
3. **Gap data:** `payment_status` (Paid/Unpaid) dan nama pakej penuh (Product & Variations)
   TAK disimpan , cuma kod SKU. Hadkan audit SKU. Nama pakej ada dalam fail Fighter mentah je.
4. **Clerk masih "Development mode"** , production WAJIB domain custom (bukan .vercel.app)
   + DNS; integrasi Marketplace boleh overwrite kunci manual. Runbook: `clerkProductionRunbook.md`.
5. Salinan enjin `webApp/api/engine` pernah BASI , sentiasa sync selepas ubah enjin root.
6. **Parity harness WAJIB `RECON_TODAY=2026-06-18`** (kalau tak, cutoff drift, parity gagal palsu).

**Runbook (gitignored, TAK di-commit):** `clerkProductionRunbook.md` (baru),
`runbookRotateNeon.md` (dah wujud, kemas nota). `.gitignore` ada +1 baris
(clerkProductionRunbook.md) belum commit. Laporan audit SKU: scratchpad `auditSkuBotol.md`
(ephemeral).

**Pending (semua perlu owner/finance):** sahkan botol KJS-3-1 & KJS-4-2; rotate Neon
(runbook siap, tiada blocker); Clerk production (perlu domain dulu); upload statement CHIP
(finance, bila mereka nak tally penuh).

## Status sekarang

- [x] Honest breakdown baldi bayaran + accordion per-kurier + label CHIP + paytag LIVE
  (19 Jul, commit d69489d + 45838e5). Punca aduan "botol tak tally" = order dibayar CHIP,
  bukan bug. Baseline COD RM63,912/369 identik, parity LULUS (seksyen "Sesi 19 Jul").
- [x] Borak, kunci skop + keputusan Fasa 1.
- [x] Sampel sebenar diproses, logik TERVALIDASI: 186/186 padan tepat, 0 exception integriti.
- [x] Milestone 1 sistem siap: DB SQLite + ingest idempotent + reconcile DB-backed. Baseline reproduce 186/RM32,919, idempotency lulus.
- [x] UI web Streamlit (`app.py`) siap, upload + papar di localhost:8501. Adi test sendiri dari browser.
- [x] Milestone 2: UI berjenama Dicci penuh (tema teal+emas, Fraunces+Manrope, overview+drill-down, buang sidebar). `theme.py` reusable. Logik recon tak berubah.
- [x] Milestone 3: Deploy LIVE ke Streamlit Cloud (private) + Neon Postgres persistent. `db.py` di-port ke SQLAlchemy.
- [x] Milestone 4: tab Per Stokis + foundation pengesahan duit (feed di-upload berasingan, extension point `db.confirmed_paid_order_ids`). Recon output identik baseline.
- [x] Milestone 5: shell berbilang anak syarikat (button nav, tiada sidebar) + UI English penuh + feed registry. Enjin tak disentuh, output identik baseline. Blueprint architecture dikunci.
- [x] Milestone 6 (2026-07-01): handoff selamat, butang Reset disorok belakang secret ADMIN_MODE, amaran upsert overwrite, rollback per fail, `backup.py` snapshot + verify.
- [x] Milestone 7 (2026-07-03): (a) Neon reconnect DISAHKAN hidup, guard fail-loud bila app jatuh ke SQLite ephemeral + heartbeat `app_meta` (bukti app live menulis ke Neon, boleh semak dari terminal); (b) prestasi: batch upsert Postgres, init sekali per proses, cache bacaan, nav callback 1 rerun; (c) SKALA 1 JUTA: recon dipindah ke SQL dalam DB (`reconSql.py`), jadual normalized `order_skus`, terbukti 1,000,000 order synthetic (RAM 0.23GB vs 1.48GB pandas, ~10s cache-miss, klik biasa cached), parity IDENTIK row-by-row lawan enjin pandas disahkan pada SQLite + Neon Postgres. `reconcile.py` KEKAL rujukan kebenaran (CLI baseline 369/RM63,912 tak berubah).
- [x] Fasa Next.js LIVE (`webApp/`, Vercel `diccigroupfinance`): Clerk auth allowlist,
  ingest (parser Python sebenar), 100% cover view Streamlit, bank confirmation, audit log,
  cache recon, search, SKU editor, stokis_kat/other_courier. **Export finance LIVE
  (6/7 Jul): CSV per-page (N-of-M) + Close Pack rekonsiliasi** (seksyen "Sesi 6/7 Jul").
- [x] Sidebar collapse (icon rail) LIVE (8 Jul): butang chevron, mengecut jadi rail ~64px,
  simpan localStorage, no-flash pra-paint, mobile tak disentuh. Murni UI (seksyen bawah).
- [x] Free gift (giveaway) tracking (8 Jul): jadual `sku_gifts`, page /impact/gifts (senarai
  SKU + modal per SKU), kos auto-derive per SKU, split confirmed vs at-risk, chip+kos di
  Stockists + subline Dashboard. Murni UI+config, guard fan-out lulus (seksyen "Sesi 8 Jul").
- [x] Add SKU dari page Free gift (8 Jul, LIVE dpl_Hei9F8f...): modal cipta SKU lengkap
  (kod+nama+botol) + gift, `addSku` upsert additive, tolak dup case-insensitive.
- [x] Mini page stokis (modal drill + penapis tarikh) LIVE (8 Jul, dpl_6ngMnR1H...): 6 blok
  (money/bottles/order health/commission/products+gifts/orders) ikut tempoh. Additive,
  parity LULUS, cross-check botol padan (seksyen "Mini page stokis").
- [ ] Export Fasa B (lapisan server dataset penuh) + komisen enrich:
  HOLD/tangguh (lihat seksyen "Sesi 6/7 Jul" + auto-memory).
- [ ] Wire feed courier seterusnya (DHL, Ninja Van): perlu PDF sampel dari Adi dulu.
- [ ] Wire feed prepaid (CHIP/transfer) + TikTok: perlu bentuk export dari Adi.
- [ ] Hardening keselamatan: rotate kredential DB Neon + audit akses team.
- [ ] Adi kumpul SEMUA bil COD J&T cover period (+ nama fail kekal ada bill no + tarikh) untuk recon penuh.
- [ ] Run period penuh: Tier 2 (397 sekarang) patut mengecut bila bil ditambah; tala REMIT_PENDING_DAYS dari lag remit sebenar.
- [ ] Review dengan Adi (pilih order dia tahu, sahkan kategori betul).
- [ ] Bila enjin terbukti: port schema ke Supabase + dashboard Next.js + multi-courier (DHL, Ninja Van).

## Skala (Milestone 7): macam mana recon kekal laju pada jutaan order

- App TIDAK lagi tarik semua row ke pandas. `reconSql.py` kira kategori + agregat DALAM
  database (temp table dalam SATU transaksi, selamat dengan pooler Neon), app terima
  ringkasan + baris exception sahaja (cap: 5k exception, 20k parcel per bil, 10k drill).
- `order_skus` = bentuk normalized lajur `orders.skus`, diisi masa ingest (+backfill auto
  masa boot untuk DB lama). Botol dikira SQL join `sku_bottles` ikut mapping semasa.
- **PERATURAN bila ubah logik recon:** ubah `reconcile.py` (rujukan kebenaran) dulu,
  jalankan parity harness (scratchpad `parityCheck.py`, banding row-by-row), BARU sync
  `reconSql.py`. Kalau parity tak lulus, laluan SQL tak boleh deploy.
- Nota prestasi dialek ada dalam komen `reconSql.py` (anti-join NOT IN vs NOT EXISTS,
  jangan join subquery agregat tanpa index, dll). Ukuran: 1M order = jnt 9.6s, dhl 3.5s,
  ninja 2.7s per cache-miss di SQLite lokal; klik biasa guna cache (tak sentuh DB).

## Risiko / checkpoint terbuka

- Recon period penuh perlu SEMUA bil COD period. Satu bil sahaja buat "belum_remit_atau_hilang" nampak besar (false alarm).
- Lag remit (delivered -> masuk bil) belum terukur, perlu banyak bil + tarikh settlement. Transit pickup->delivered median 1 hari sahaja.
- Courier lain (Ninja Van 37 order RM6.7k, DHL 30 order RM6.2k dalam sampel) dan income lain = fasa kemudian.

## Diparkir (luar skop Fasa 1)

- Struktur inter-company baru (jualan ke anak syarikat, naik ke Group).
- Reconciliation baki bank penuh.
- Laluan bank komisyen Impact (duit Impact sebenarnya komisyen).
- Income stream lain (TikTok affiliate, stokis prepaid) dan anak syarikat lain (Flux, Group).

## Sesi 22 Jul 2026 (peta v1.1 sampai v1.4, feed sebenar disahkan, search + deposit date LIVE)

**Peta architecture (peta/, LOKAL SAHAJA):**
- v1.1 swimlane "Berlapis": toggle Atas pelan / Berlapis per flow, 4 lorong (Browser, Server, Gudang Data, Dashboard), tag `l` wajib pada setiap step FLOWS (kontrak PETA_DATA, ujian jaga).
- v1.2: flow CHIP dan Baldi Jujur + flow Padam Selamat, label fakta jujur (duit hantu vs luar skop, suis pengesahan, jam aging "ambang boleh tala", baseline beku bercop tarikh), pin RLS mod Sasaran "rancangan, belum dibina". Keputusan timbang: parity 3 enjin BUKAN flow (pre-obsolete oleh tangga 2, jadi tooltip je), RLS BUKAN flow (belum ada kod, pin je).
- v1.3 flow Mini Stokis (drill 1 stokis, isyarat bocor ditulis neutral). v1.4 flow Gabung Sumber (lineage 5 sumber jadi 1 dashboard, jawapan soalan owner "dashboard ni solid ke"). Skema versi tukar vN ke titik (v14 jadi v1.4). Ujian 176 jadi 190 pass.
- Keputusan owner: peta keluar dari git (repo public, peta ada info dalaman). 6 commit lama di-reset (backup branch: backupSebelumTarikPeta), HANDOVER+gitignore di-commit semula tanpa peta.
- Idea disimpan (trigger = pop up kedua siap): angkat corak drill pop up jadi cerita "fundamental" dalam peta.

**Feed sebenar disahkan (data/sampel/, gitignored):** CHIP statement, DHL payment advice (zip: pdf+xls, pdf disahkan salinan serupa), Ninja SOA. Ketiga tiga parser LULUS tanpa ubah kod. Yang sengaja tak disimpan (by design): 12 CHIP overdue (belum bayar), 35 baris disbursement CHIP (duit lintas ke bank Group, cerita ditangguh), 2 baris kosong Ninja. AWAS tafsir recon Ninja: SOA campur baris caj bukan COD (cod=0, net negatif).

**Sheet check (design DIKUNCI 2x timbang, belum bina, tunggu CSV):** Fasa 0 = skrip gate luar app (sahkan order ID + lajur botol/komisen dalam sheet; kalau agregat sahaja, turunkan janji ciri). Fasa 1 = sheet jadi feed via Upload biasa, staging sheet_rows berasingan (raw JSON, jangan cemari jadual feed), mapping lajur manual disahkan sekali (BUKAN auto-detect, bentuk tak stabil, berhenti bising bila berubah), page "Sheet check" 4 baldi (Matched senyap / Likely timing dilipat / Needs a look kelabu / Confirmed mismatch). Fasa 2 = pop up "Sheet says vs System sees" + Mark reviewed (log app_events). Prinsip: sistem = pembanding neutral bukan hakim, ragu = Needs a look, tiada peratus keyakinan. Butang "Report mismatch" = backlog selepasnya.

**webApp LIVE (commit 7b9edfd + 41eaf1b, deploy 22 Jul):** TableFilter + tapis Stockists/Uploads/StockistModal (order id + tracking), pintu Dashboard & sidebar dibuang atas arahan owner lepas test dev. Medan Actual deposit date (default hari ini) dalam Bank Confirm + kolum Deposited "18 Jun (+2d)" + export; deposited_on memang wujud dalam DB/API, UI je yang tak tanya. Punca asal: J&T transfer date vs duit masuk bank lag 1 sampai 3 hari, team dulu adjust PDF (amalan dihentikan).

**Nota drift peta:** commit 7b9edfd/41eaf1b sentuh webApp, driftCheck peta akan lapor drift lepas ni, run /petaDicci bila senang (perubahan UI sahaja, fakta enjin tak berubah, drift dijangka kecil).
