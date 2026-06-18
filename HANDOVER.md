# HANDOVER , dicciGroupFinance

Tarikh mula: 2026-06-18

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

## Status sekarang

- [x] Borak, kunci skop + keputusan Fasa 1.
- [x] Sampel sebenar diproses, logik TERVALIDASI: 186/186 padan tepat, 0 exception integriti.
- [x] Milestone 1 sistem siap: DB SQLite + ingest idempotent + reconcile DB-backed. Baseline reproduce 186/RM32,919, idempotency lulus.
- [x] UI web Streamlit (`app.py`) siap, upload + papar di localhost:8501. Adi test sendiri dari browser.
- [x] Milestone 2: UI berjenama Dicci penuh (tema teal+emas, Fraunces+Manrope, overview+drill-down, buang sidebar). `theme.py` reusable. Logik recon tak berubah.
- [ ] Adi kumpul SEMUA bil COD J&T cover period (+ nama fail kekal ada bill no + tarikh) untuk recon penuh.
- [ ] Run period penuh: Tier 2 (397 sekarang) patut mengecut bila bil ditambah; tala REMIT_PENDING_DAYS dari lag remit sebenar.
- [ ] Review dengan Adi (pilih order dia tahu, sahkan kategori betul).
- [ ] Bila enjin terbukti: port schema ke Supabase + dashboard Next.js + multi-courier (DHL, Ninja Van).

## Risiko / checkpoint terbuka

- Recon period penuh perlu SEMUA bil COD period. Satu bil sahaja buat "belum_remit_atau_hilang" nampak besar (false alarm).
- Lag remit (delivered -> masuk bil) belum terukur, perlu banyak bil + tarikh settlement. Transit pickup->delivered median 1 hari sahaja.
- Courier lain (Ninja Van 37 order RM6.7k, DHL 30 order RM6.2k dalam sampel) dan income lain = fasa kemudian.

## Diparkir (luar skop Fasa 1)

- Struktur inter-company baru (jualan ke anak syarikat, naik ke Group).
- Reconciliation baki bank penuh.
- Laluan bank komisyen Impact (duit Impact sebenarnya komisyen).
- Income stream lain (TikTok affiliate, stokis prepaid) dan anak syarikat lain (Flux, Group).
