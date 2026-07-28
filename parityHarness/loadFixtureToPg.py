#!/usr/bin/env python3
"""Muat SEBARANG fixture sqlite ke satu database Postgres dev BERASINGAN (port 5433).

Guna schema SEBENAR dari db.py (rujukan kebenaran), jadi bentuk jadual identik
dengan produksi. Database sasaran DIBUANG dan DIBINA SEMULA setiap run, supaya
tiap fixture bermula bersih dan agent lain tak berlanggar (guna nama db sendiri).

TIDAK menyentuh database `dicci` (data dev milik owner) melainkan awak namakan ia.

Guna:
  python3 loadFixtureToPg.py <fixture.db> <nama_db_pg>
Contoh (dari root repo):
  python3 parityHarness/loadFixtureToPg.py parityHarness/data/fixture.db parity_tapak
"""
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path("/Users/adizaini/dicciGroupFinance")

fixture = Path(sys.argv[1]).resolve()
dbname = sys.argv[2]
assert fixture.exists(), f"fixture tiada: {fixture}"
assert dbname.replace("_", "").isalnum(), "nama db: alnum + underscore sahaja"
assert dbname != "dicci", "JANGAN clobber db dev owner. Pilih nama lain."

PGBASE = "postgresql://dev:dev@localhost:5433"

# --- 1. bina semula database sasaran ---------------------------------------
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

adm = psycopg2.connect(f"{PGBASE}/postgres")
adm.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
with adm.cursor() as cur:
    cur.execute(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s",
        (dbname,))
    cur.execute(f'DROP DATABASE IF EXISTS "{dbname}"')
    cur.execute(f'CREATE DATABASE "{dbname}"')
adm.close()
print(f"db PG dibina semula: {dbname}")

# --- 2. schema dari db.py ---------------------------------------------------
os.environ["DATABASE_URL"] = f"{PGBASE}/{dbname}"
os.environ.setdefault("RECON_TODAY", "2026-06-18")
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402
from sqlalchemy import text  # noqa: E402

import db  # noqa: E402

db.init_db()
eng = db.get_engine()

# --- 3. salin setiap jadual yang wujud di kedua belah -----------------------
sq = sqlite3.connect(str(fixture))
src_tables = [r[0] for r in sq.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]

with eng.connect() as c:
    dst_tables = {r[0] for r in c.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public'"))}

for t in src_tables:
    if t not in dst_tables:
        print(f"  {t:<22} (tiada dalam schema db.py, skip)")
        continue
    df = pd.read_sql(f'SELECT * FROM "{t}"', sq)
    with eng.connect() as c:
        cols = {r[0] for r in c.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=:t"), {"t": t})}
        c.execute(text(f'DELETE FROM "{t}"'))
        c.commit()
    drop = [x for x in df.columns if x not in cols]
    if drop:
        print(f"  {t:<22} buang lajur tak dikenali: {drop}")
        df = df.drop(columns=drop)
    df = df.where(pd.notna(df), None)
    if len(df):
        df.to_sql(t, eng, if_exists="append", index=False)
    print(f"  {t:<22} {len(df):,} baris")

sq.close()
with eng.connect() as c:
    n = c.execute(text("SELECT COUNT(*) FROM orders")).scalar()
print(f"Siap. orders = {n:,}  ->  {PGBASE}/{dbname}")
