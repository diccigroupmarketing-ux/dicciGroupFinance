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
  zero-downtime + Cara B reset + flag TLS verify-full); lepas tu rancang penutupan
  Streamlit. Next.js kini cover 100% view Streamlit (jurang parity terakhir ditutup 6/7 Jul).

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
  - **Sidebar collapse toggle** , owner suka sidebar sekarang, cuma nak butang collapse untuk
    big picture. Buat selepas Export.

### Arahan dev webApp (untuk sesi kerja)
- Dev DB: `cd webApp && node scripts/devDb.mjs` (background; Postgres embedded port
  5433, data kekal dalam devPgData/) lalu `python3 scripts/loadDevDb.py` (muat snapshot
  backups/ terkini).
- App lokal: `npm run dev` (atau `npm run build && npm run start`), buka localhost:3000.
  `.env.local`: DATABASE_URL=dev PG + INGEST_MODE=local (upload guna enjin root terus).
- Parity (WAJIB bila logik recon disentuh): `python3 scripts/parityDump.py >
  scripts/parityPython.json && npx tsx scripts/parityCheck.ts` , mesti LULUS.
- Enjin berubah? `bash scripts/syncEngine.sh` (sync salinan api/engine/) sebelum deploy.
- Deploy: `cd webApp && vercel deploy --prod --yes` (deploy TAK auto dari git push).

## Status sekarang

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
