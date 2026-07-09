#!/usr/bin/env python3
"""backfillAutoSkus.py , daftar SKU yang dah ada dalam order_skus tapi belum
ada dalam katalog sku_bottles, guna corak nama SAMA dengan auto-daftar masa
ingest (ingest.derive_bottles). Corak tak difahami dilangkau (kekal unmapped).

Guna:
    python3 backfillAutoSkus.py            # DATABASE_URL semasa (default SQLite lokal)
    DATABASE_URL=postgresql://... python3 backfillAutoSkus.py
"""
from sqlalchemy import text

import db
import ingest


def main():
    with db.get_engine().connect() as conn:
        keys = [r[0] for r in conn.execute(
            text("SELECT DISTINCT sku FROM order_skus WHERE sku IS NOT NULL"))]
        added = ingest.register_new_skus(conn, keys)
        conn.commit()
        rows = conn.execute(text(
            "SELECT sku, paid, free FROM sku_bottles "
            "WHERE product_name = :pn ORDER BY sku"), {"pn": ingest.AUTO_SKU_NOTE})
        print(f"{added} SKU baru didaftar (auto). Semua SKU bertanda auto:")
        for r in rows:
            print(f"  {r[0]:<20} paid={r[1]} free={r[2]}")
        left = conn.execute(text(
            "SELECT COUNT(DISTINCT sku) FROM order_skus WHERE sku NOT IN "
            "(SELECT UPPER(TRIM(sku)) FROM sku_bottles WHERE sku IS NOT NULL)")).scalar()
        print(f"Masih unmapped (corak tak difahami): {left}")


if __name__ == "__main__":
    main()
