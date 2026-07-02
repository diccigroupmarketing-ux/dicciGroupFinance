#!/usr/bin/env python3
"""syncFromNeon.py , tarik data LIVE (Neon Postgres) turun ke recon.db lokal.

Tujuan: localhost papar data sama dengan app live, tapi kekal sandbox SELAMAT,
upload/reset di localhost kena pada recon.db lokal sahaja, Neon tak terusik.
Sync ni SEHALA (Neon -> lokal) dan MENGGANTIKAN isi recon.db lokal.

Sumber URL Neon: kunci `NEON_SYNC_URL` dalam .streamlit/secrets.toml (gitignored)
atau env var NEON_SYNC_URL. JANGAN guna kunci DATABASE_URL untuk ini, nanti app
localhost terus menulis ke Neon produksi.

Baseline verification TIDAK terjejas: salinan data sampel asal disimpan di
data/baselineRecon.db, lihat CLAUDE.md untuk arahan verify.

Guna:
    python3 syncFromNeon.py          # tunjuk ringkasan + minta pengesahan
    python3 syncFromNeon.py --yes    # terus jalan
"""
import os
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text

import db
from backup import TABLES

CHUNK = 50_000


def _neon_url():
    url = os.environ.get("NEON_SYNC_URL")
    if url:
        return url
    secrets = Path(__file__).parent / ".streamlit" / "secrets.toml"
    if secrets.exists():
        import toml
        url = toml.load(secrets).get("NEON_SYNC_URL")
    if not url:
        sys.exit("NEON_SYNC_URL tak jumpa (letak dalam .streamlit/secrets.toml "
                 "atau env var). Ambil connection string dari console Neon.")
    return url


def main():
    src = create_engine(_neon_url(), pool_pre_ping=True)
    dst = create_engine(f"sqlite:///{db.DB_PATH}")

    with src.connect() as s:
        counts = {t: s.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                  for t in TABLES}
    print("Data LIVE (Neon):")
    for t, n in counts.items():
        print(f"  {t:<18} {n:,}")
    print(f"\nIni akan GANTIKAN isi {db.DB_PATH} (lokal sahaja, Neon tak diubah).")

    if "--yes" not in sys.argv:
        if input("Taip YA untuk teruskan: ").strip().upper() != "YA":
            sys.exit("Batal.")

    with dst.connect() as d:
        for stmt in db.SCHEMA.split(";"):
            if stmt.strip():
                d.execute(text(stmt))
        for t in TABLES:
            d.execute(text(f"DELETE FROM {t}"))
        with src.connect() as s:
            for t in TABLES:
                total = 0
                for chunk in pd.read_sql(text(f"SELECT * FROM {t}"), s,
                                         chunksize=CHUNK):
                    if len(chunk):
                        chunk.to_sql(t, d.connection, if_exists="append",
                                     index=False)
                        total += len(chunk)
                print(f"  {t:<18} {total:,} baris disalin")
        d.commit()

    print("\nSiap. Localhost sekarang papar data sama dengan app live.")
    print("Run semula bila bila untuk tarik data terkini dari Neon.")


if __name__ == "__main__":
    main()
