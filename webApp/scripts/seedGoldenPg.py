#!/usr/bin/env python3
"""
seedGoldenPg.py , muat fixture emas SINTETIK ke Postgres untuk parity CI.

KENAPA WUJUD (baca ni dulu)
---------------------------
`parityCheck.ts` banding E2 (reconSql.py) lawan E3 (lib/recon.ts) atas Postgres
yang SAMA. Dalam suite lokal penuh (testAll.mjs) data tu datang dari snapshot
backup SEBENAR (loadDevDb.py), yang GITIGNORED sebab repo ni PUBLIC, jadi
parityCheck TAK boleh jalan di CI awam. Akibatnya enjin TS (E3) tak pernah
diuji hujung ke hujung dalam CI , lubang besar, sebab E3 lah enjin yang webApp
guna di produksi.

Fail ni tutup lubang tu TANPA data sebenar: ia muat fixture emas SINTETIK
(genGoldenFixture, data 100% rekaan yang cetus SEMUA 15 kategori recon) ke dalam
Postgres yang ditunjuk DATABASE_URL. Lepas tu testCi.mjs jalankan parityDump.py
(E2) + parityCheck.ts (E3) atas fixture ni, jadi E2 lawan E3 diperiksa baris demi
baris atas data yang menyentuh setiap kategori. Ini melengkapkan segi tiga parity
di CI: E1 vs E2 (testGoldenParity.py) + E2 vs E3 (di sini).

SATU SUMBER KEBENARAN UNTUK DATA
--------------------------------
Baris fixture (ORDERS / LINES / PREPAID + pemalar) diimport TERUS dari
genGoldenFixture, jadi kalau seseorang ubah fixture, sisi sqlite (E1/E2) dan sisi
Postgres (E2/E3) dua dua ikut. Cuma dialek INSERT yang beza (sqlite3 `?` lawan
SQLAlchemy `:nama`); kalau schema berubah, INSERT ni gagal KUAT di CI (bukan
senyap), sebab lajur dirujuk eksplisit.

GUARD: hanya localhost. Skrip ni DELETE + INSERT, jadi ia enggan tunjuk ke Neon
produksi. Sama corak dengan semua skrip ujian menulis lain.

Guna:  DATABASE_URL="postgresql://dev:dev@localhost:5433/dicci" \
         python3 scripts/seedGoldenPg.py
"""
import os
import sys
from pathlib import Path

# Enjin recon (db.py) di ROOT repo. scripts -> webApp -> root = dua paras naik.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
for _p in (str(HERE), str(ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Bekukan tarikh aging SEBELUM import db (db.TODAY dibaca masa import), selari
# dengan parityDump.py / reconEnv.ts. Hormat env sedia ada.
os.environ.setdefault("RECON_TODAY", "2026-06-18")

_url = os.environ.get("DATABASE_URL", "")
if "localhost" not in _url:
    sys.exit("TOLAK: DATABASE_URL mesti dev lokal (localhost). Skrip ni menulis data.")

from sqlalchemy import text  # noqa: E402

import db  # noqa: E402
import genGoldenFixture as gold  # noqa: E402

# Jadual yang fixture emas sentuh. Dibersihkan dulu supaya seed idempotent
# (boleh jalan berulang, tiada baris tertinggal dari run sebelum).
TABLES = ["cod_bill_lines", "cod_bills", "prepaid_payments", "orders"]


def main():
    db.init_db()
    eng = db.get_engine()
    with eng.begin() as conn:
        for t in TABLES:
            conn.execute(text(f"DELETE FROM {t}"))

        conn.execute(
            text("INSERT INTO cod_bills (bill_id, courier, settlement_date,"
                 " source_file, ingested_at)"
                 " VALUES (:bill_id, :courier, :settlement_date, :source_file,"
                 " :ingested_at)"),
            {"bill_id": gold.BILL_JNT, "courier": gold.JNT,
             "settlement_date": "2026-06-12", "source_file": "goldenFixture.xlsx",
             "ingested_at": "2026-06-18 00:00:00"})

        conn.execute(
            text("INSERT INTO orders (order_id, order_date, status, seller_name,"
                 " payment_method, shipping_provider, tracking, selling_price,"
                 " sales_commission, skus, item_count, source_file, ingested_at)"
                 " VALUES (:order_id, :order_date, :status, :seller_name,"
                 " :payment_method, :shipping_provider, :tracking, :selling_price,"
                 " :sales_commission, :skus, :item_count, :source_file,"
                 " :ingested_at)"),
            [{"order_id": oid, "order_date": odate, "status": status,
              "seller_name": gold.SELLER, "payment_method": pay,
              "shipping_provider": prov, "tracking": trk, "selling_price": price,
              "sales_commission": 0.0, "skus": None, "item_count": 1,
              "source_file": "goldenFixture.xlsx", "ingested_at": "2026-06-18 00:00:00"}
             for oid, odate, status, prov, pay, trk, price in gold.ORDERS])

        conn.execute(
            text("INSERT INTO cod_bill_lines (awb, bill_id, cod_amount, fee,"
                 " delivered_date, pickup_date, source_file, ingested_at)"
                 " VALUES (:awb, :bill_id, :cod_amount, :fee, :delivered_date,"
                 " :pickup_date, :source_file, :ingested_at)"),
            [{"awb": awb, "bill_id": gold.BILL_JNT, "cod_amount": cod, "fee": 1.0,
              "delivered_date": gold.DELIVERED, "pickup_date": gold.PICKUP,
              "source_file": "goldenFixture.xlsx", "ingested_at": "2026-06-18 00:00:00"}
             for awb, cod in gold.LINES])

        conn.execute(
            text("INSERT INTO prepaid_payments (gateway, order_ref, amount, fee,"
                 " status, paid_on, settled_on, statement_id, source_file,"
                 " ingested_at)"
                 " VALUES (:gateway, :order_ref, :amount, :fee, :status, :paid_on,"
                 " :settled_on, :statement_id, :source_file, :ingested_at)"),
            [{"gateway": "chip", "order_ref": ref, "amount": amt, "fee": 0.0,
              "status": "paid", "paid_on": gold.DELIVERED, "settled_on": None,
              "statement_id": gold.STMT_CHIP, "source_file": "goldenFixture.xlsx",
              "ingested_at": "2026-06-18 00:00:00"}
             for ref, amt in gold.PREPAID])

    print(f"[golden dimuat ke Postgres] {len(gold.ORDERS)} order, "
          f"{len(gold.LINES)} baris bil, {len(gold.PREPAID)} prepaid "
          f"(liputan dijangka: {len(gold.EXPECTED_COVERAGE)} kategori)")


if __name__ == "__main__":
    main()
