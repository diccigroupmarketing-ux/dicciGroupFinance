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

## Status sekarang

- [x] Borak, kunci skop + keputusan Fasa 1.
- [x] Sampel sebenar diproses, logik TERVALIDASI: 186/186 padan tepat, 0 exception integriti.
- [x] Milestone 1 sistem siap: DB SQLite + ingest idempotent + reconcile DB-backed. Baseline reproduce 186/RM32,919, idempotency lulus.
- [x] UI web Streamlit (`app.py`) siap, upload + papar di localhost:8501. Adi test sendiri dari browser.
- [x] Milestone 2: UI berjenama Dicci penuh (tema teal+emas, Fraunces+Manrope, overview+drill-down, buang sidebar). `theme.py` reusable. Logik recon tak berubah.
- [x] Milestone 3: Deploy LIVE ke Streamlit Cloud (private) + Neon Postgres persistent. `db.py` di-port ke SQLAlchemy.
- [x] Milestone 4: tab Per Stokis + foundation pengesahan duit (feed di-upload berasingan, extension point `db.confirmed_paid_order_ids`). Recon output identik baseline.
- [x] Milestone 5: shell berbilang anak syarikat (button nav, tiada sidebar) + UI English penuh + feed registry. Enjin tak disentuh, output identik baseline. Blueprint architecture dikunci.
- [ ] Wire feed courier seterusnya (DHL, Ninja Van): perlu PDF sampel dari Adi dulu.
- [ ] Wire feed prepaid (CHIP/transfer) + TikTok: perlu bentuk export dari Adi.
- [ ] Hardening keselamatan: rotate kredential DB Neon + audit akses team.
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
