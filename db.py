"""
db.py , dicciGroupFinance

Stor berkekalan + helper kongsi + skema, guna SQLAlchemy supaya SATU kod jalan
atas SQLite (lokal dev) DAN Postgres/Supabase (deploy).

Pilihan engine automatik:
- Kalau env `DATABASE_URL` atau st.secrets["DATABASE_URL"] ada -> guna itu (Postgres Supabase).
- Kalau tak -> fallback SQLite lokal `recon.db`.
"""

import os
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text

# ====================================================================
# Paths
# ====================================================================
BASE = Path(__file__).parent
DATA_DIR = BASE / "data"
INBOX = DATA_DIR / "inbox"
ARCHIVE = DATA_DIR / "archive"
OUTPUT_DIR = BASE / "output"
DB_PATH = BASE / "recon.db"

# ====================================================================
# Scope + constants Fasa 1
# ====================================================================
COD_VALUES = {"COD"}
JNT_PROVIDER = {"J&T Express"}
COMPLETED, RETURNED, REJECTED, IN_TRANSIT = "Completed", "Returned", "Rejected", "In Transit"

REMIT_PENDING_DAYS = 14
TODAY = pd.Timestamp("2026-06-18")

# ====================================================================
# Helpers (vektor, untuk pandas Series)
# ====================================================================
def norm_trk(s: pd.Series) -> pd.Series:
    return (
        s.astype(str).str.strip().str.upper()
        .str.replace(r"\s+", "", regex=True)
        .str.replace(r"\.0$", "", regex=True)
    )


def to_num(s: pd.Series) -> pd.Series:
    cleaned = s.astype(str).str.replace(r"[^0-9.\-]", "", regex=True).replace("", "0")
    return pd.to_numeric(cleaned, errors="coerce").fillna(0)


def parse_dt(s: pd.Series, dayfirst: bool) -> pd.Series:
    return pd.to_datetime(s, dayfirst=dayfirst, errors="coerce")


def is_real_awb(t: str) -> bool:
    t = str(t)
    return t.isdigit() and len(t) >= 10


def to_records(df: pd.DataFrame):
    """DataFrame -> list of dict, NaN/NaT jadi None, numpy scalar jadi native Python.
    Perlu supaya psycopg2 (Postgres) tak tercekik dengan numpy.int64/float64."""
    df = df.where(pd.notna(df), None)
    out = []
    for rec in df.to_dict("records"):
        clean = {}
        for k, v in rec.items():
            if v is None:
                clean[k] = None
            elif hasattr(v, "item") and not isinstance(v, (str, bytes)):
                clean[k] = v.item()  # numpy scalar -> python
            else:
                clean[k] = v
        out.append(clean)
    return out


# ====================================================================
# Skema (serasi SQLite + Postgres). DOUBLE PRECISION supaya presisi
# duit konsisten dua dua dialek (Postgres REAL = 4-byte, elak).
# ====================================================================
SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    order_id          TEXT PRIMARY KEY,
    order_date        TEXT,
    status            TEXT,
    seller_name       TEXT,
    payment_method    TEXT,
    shipping_provider TEXT,
    tracking          TEXT,
    selling_price     DOUBLE PRECISION,
    sales_commission  DOUBLE PRECISION,
    skus              TEXT,
    item_count        INTEGER,
    source_file       TEXT,
    ingested_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking);

CREATE TABLE IF NOT EXISTS sku_bottles (
    sku          TEXT PRIMARY KEY,
    product_name TEXT,
    paid         INTEGER DEFAULT 0,
    free         INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cod_bills (
    bill_id         TEXT PRIMARY KEY,
    courier         TEXT,
    settlement_date TEXT,
    source_file     TEXT,
    ingested_at     TEXT
);

CREATE TABLE IF NOT EXISTS cod_bill_lines (
    awb            TEXT PRIMARY KEY,
    bill_id        TEXT,
    cod_amount     DOUBLE PRECISION,
    fee            DOUBLE PRECISION,
    delivered_date TEXT,
    pickup_date    TEXT,
    source_file    TEXT,
    ingested_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_lines_bill ON cod_bill_lines(bill_id);
"""

DEFAULT_SKU_BOTTLES = [
    ("KK-JAQ-1-1", "KORBAN 1+1", 1, 1),
    ("KK-JAQ-2-1", "KORBAN 2+1", 2, 1),
    ("KK-JAQ-4-2", "KORBAN 4+2", 4, 2),
    ("KK-JAQ-6-2", "KORBAN 6+2", 6, 2),
    ("JAG-T-1", "Jus Arabic Gold (Bulk)", 1, 0),
    ("JAG-MY-1", "Jus AG (MY) 1 Botol", 1, 0),
    ("JAG-MY-2", "Jus AG (MY) 2 Botol", 2, 0),
    ("JUS-SG-3", "Jus AG (SG) 3 Botol", 3, 0),
    ("RAYA-JAG-2", "Kempen Raya 2 Botol", 2, 0),
]


# ====================================================================
# Engine + sambungan
# ====================================================================
def _db_url():
    url = os.environ.get("DATABASE_URL")
    if not url:
        try:
            import streamlit as st
            url = st.secrets.get("DATABASE_URL")
        except Exception:
            url = None
    if not url:
        return f"sqlite:///{DB_PATH}"
    return url


_ENGINE = None


def get_engine():
    global _ENGINE
    if _ENGINE is None:
        url = _db_url()
        if url.startswith("sqlite"):
            _ENGINE = create_engine(url, connect_args={"check_same_thread": False})
        else:
            _ENGINE = create_engine(url, pool_pre_ping=True)
    return _ENGINE


def is_postgres():
    return get_engine().dialect.name == "postgresql"


def get_conn():
    return get_engine().connect()


def init_db(conn=None):
    own = conn is None
    conn = conn or get_conn()
    for stmt in SCHEMA.split(";"):
        if stmt.strip():
            conn.execute(text(stmt))
    conn.commit()
    _migrate(conn)
    _seed_sku_bottles(conn)
    conn.commit()
    if own:
        conn.close()


def _migrate(conn):
    # Hanya perlu untuk DB SQLite lama yang mungkin kurang lajur. Postgres fresh
    # dah ada semua lajur dari SCHEMA.
    if conn.engine.dialect.name == "sqlite":
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(orders)")).fetchall()]
        if "skus" not in cols:
            conn.execute(text("ALTER TABLE orders ADD COLUMN skus TEXT"))
        if "item_count" not in cols:
            conn.execute(text("ALTER TABLE orders ADD COLUMN item_count INTEGER"))


def _seed_sku_bottles(conn):
    n = conn.execute(text("SELECT COUNT(*) FROM sku_bottles")).scalar()
    if n == 0:
        conn.execute(
            text("INSERT INTO sku_bottles (sku, product_name, paid, free) "
                 "VALUES (:sku, :pn, :paid, :free)"),
            [{"sku": s, "pn": pn, "paid": p, "free": f} for s, pn, p, f in DEFAULT_SKU_BOTTLES],
        )


def get_sku_map(conn=None):
    own = conn is None
    conn = conn or get_conn()
    df = pd.read_sql(text("SELECT sku, paid, free FROM sku_bottles"), conn)
    if own:
        conn.close()
    return {str(r.sku).strip().upper(): (int(r.paid or 0), int(r.free or 0)) for r in df.itertuples()}


def save_sku_map(df, conn=None):
    own = conn is None
    conn = conn or get_conn()
    conn.execute(text("DELETE FROM sku_bottles"))
    rows = []
    for _, r in df.iterrows():
        sku = str(r.get("sku", "")).strip()
        if not sku or sku.lower() == "nan":
            continue
        pn = r.get("product_name")
        pn = "" if pd.isna(pn) else str(pn)
        rows.append({"sku": sku, "pn": pn, "paid": int(r.get("paid") or 0), "free": int(r.get("free") or 0)})
    if rows:
        conn.execute(
            text("INSERT INTO sku_bottles (sku, product_name, paid, free) "
                 "VALUES (:sku, :pn, :paid, :free) "
                 "ON CONFLICT(sku) DO UPDATE SET product_name=excluded.product_name, "
                 "paid=excluded.paid, free=excluded.free"),
            rows,
        )
    conn.commit()
    if own:
        conn.close()


def reset_db(conn=None):
    own = conn is None
    conn = conn or get_conn()
    for t in ("orders", "cod_bill_lines", "cod_bills"):
        conn.execute(text(f"DELETE FROM {t}"))
    conn.commit()
    if own:
        conn.close()
