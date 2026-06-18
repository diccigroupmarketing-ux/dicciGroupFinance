# dicciGroupFinance

Sistem automation Finance Dicci Group. Fasa 1: reconciliation duit masuk J&T COD untuk Dicci Impact. Semak duit masuk J&T COD tally dengan order Fighter, ikut nombor tracking.

Milestone 1: enjin recon dengan stor berkekalan (SQLite). Schema serasi Postgres, sedia untuk port ke Supabase bila app penuh dibina.

## Setup

```
pip install pandas openpyxl streamlit
```

## Cara guna

1. Drop fail mentah dalam `data/inbox/`:
   - Export Fighter (jadual "Orders"), .xlsx atau .csv
   - Bil COD J&T (export "COD账单"), .xlsx atau .csv
   (Sistem auto kenal Fighter vs J&T ikut lajur, tak kisah nama fail.)

2. Ingest ke stor:
   ```
   python ingest.py
   ```
   Idempotent: re-run fail sama tak double count (kunci = Order ID / AWB). Fail siap diproses dipindah ke `data/archive/`.

3. Jalankan reconciliation:
   ```
   python reconcile.py
   ```
   Hasil: `output/report.txt` (ringkasan + exception + pecahan stokis + diagnostik) dan `output/exceptions.csv`.

## Cara guna (web)

```
streamlit run app.py
```
Buka http://localhost:8501. Struktur: OVERVIEW sentiasa di atas (pemilih tempoh, hero Net Remit, band exception, KPI sekunder, chart trend), kemudian tab drill-down (Per Tempoh, Per Bil, Audit, SKU). Upload fail, slider aging, dan reset stor semua dalam panel operasi di sidebar.

## Logik ringkas

- `orders` (Fighter) = apa yang sepatutnya. `cod_bill_lines` (bil J&T) = realiti duit yang dah remit.
- Padan ikut tracking: `orders.tracking` <-> `cod_bill_lines.awb`.
- Skop Fasa 1: order COD + Shipping Provider J&T Express sahaja (DHL, Ninja Van = fasa lain).
- Amount padan TEPAT: Selling Price (Fighter) == COD Amount (J&T).
- Kategori: tally, duit_hantu (duit masuk takde order), amount_mismatch, belum_remit (normal kalau baru), hilang_lewat (alert > X hari), returned/rejected/pending.
- Net remit = COD Amount tolak Total Processing Fee (fee J&T ~1.4%).

## Fail

- `db.py` , schema + sambungan + helper + konstan skop.
- `ingest.py` , parse + normalise + upsert idempotent.
- `reconcile.py` , padan + kategori + report.
- `app.py` , UI web Streamlit (overview + tab drill-down).
- `theme.py` , lapisan persembahan berjenama Dicci (palet teal + emas dengan neutral
  hangat + status diharmonikan, font Fraunces + Manrope, atmosfera CSS, header, jalur
  hero, band alert bocor, kad KPI, chart Altair, cip kategori). Dibuat BOLEH GUNA
  SEMULA, sebab page ni nanti jadi satu page dalam dashboard besar, page lain cukup
  panggil helper yang sama. Logik recon tak bergantung pada fail ni.
- `.streamlit/config.toml` , tema asas Streamlit (warna brand).
- `assets/logoDicci.png` , logo cache (auto-download dari dicci.com.my kalau hilang).

Tema guna Altair (dibundel dengan Streamlit) dan font Inter (web), jadi tiada
dependency baru perlu dipasang.

Lihat `HANDOVER.md` untuk konteks penuh, keputusan terkunci, dan status.
