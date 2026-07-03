#!/usr/bin/env python3
"""Muat data sampel (backup CSV) ke dev Postgres embedded untuk webApp.

Guna schema SEBENAR dari db.py (rujukan kebenaran) supaya app Next.js dibina
atas bentuk jadual yang sama dengan produksi. Sekali gus jadi latihan restore
dari snapshot backup.py.

Guna:  python3 scripts/loadDevDb.py [folder_backup]
       (default: folder backup terkini dalam ../backups/)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # dicciGroupFinance/
sys.path.insert(0, str(ROOT))
os.environ["DATABASE_URL"] = "postgresql://dev:dev@localhost:5433/dicci"

import pandas as pd
from sqlalchemy import text

import db

# Lajur bukan-teks per jadual (selebihnya dipaksa str supaya masuk kolum TEXT).
NUMERIC = {
    "orders": {"selling_price": float, "sales_commission": float, "item_count": "Int64"},
    "order_skus": {"qty": "Int64"},
    "cod_bills": {},
    "cod_bill_lines": {"cod_amount": float, "fee": float},
    "prepaid_payments": {"amount": float, "fee": float},
    "wallet_txns": {"amount": float},
    "sku_bottles": {"paid": "Int64", "free": "Int64"},
}

def main():
    backups = sorted((ROOT / "backups").glob("*/manifest.json"))
    if len(sys.argv) > 1:
        folder = Path(sys.argv[1])
    elif backups:
        folder = backups[-1].parent
    else:
        sys.exit("Tiada folder backup dijumpai.")
    print(f"Sumber: {folder}")

    db.init_db()
    eng = db.get_engine()
    with eng.connect() as conn:
        for t in NUMERIC:
            conn.execute(text(f"DELETE FROM {t}"))
        conn.commit()

    for t, numcols in NUMERIC.items():
        f = folder / f"{t}.csv"
        if not f.exists():
            print(f"  {t:<18} (tiada fail, skip)")
            continue
        df = pd.read_csv(f, dtype=str)
        for col, typ in numcols.items():
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
                if typ == "Int64":
                    df[col] = df[col].astype("Int64")
        df = df.where(pd.notna(df), None)
        if len(df):
            df.to_sql(t, eng, if_exists="append", index=False)
        print(f"  {t:<18} {len(df):,} baris")

    with eng.connect() as conn:
        n = conn.execute(text("SELECT COUNT(*) FROM orders")).scalar()
    print(f"Siap. orders = {n:,}")

if __name__ == "__main__":
    main()
