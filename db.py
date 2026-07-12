"""
db.py , dicciGroupFinance

Stor berkekalan + helper kongsi + skema, guna SQLAlchemy supaya SATU kod jalan
atas SQLite (lokal dev) DAN Postgres/Supabase (deploy).

Pilihan engine automatik:
- Kalau env `DATABASE_URL` atau st.secrets["DATABASE_URL"] ada -> guna itu (Postgres Supabase).
- Kalau tak -> fallback SQLite lokal `recon.db`.
"""

import os
import re
from pathlib import Path

import pandas as pd
from sqlalchemy import bindparam, create_engine, text

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
# TODAY default = tarikh sebenar hari ini supaya pengesan aging (hilang_lewat)
# bergerak dengan masa. Untuk run baseline deterministik, beku via env
# RECON_TODAY (contoh RECON_TODAY="2026-06-18").
_today_env = os.environ.get("RECON_TODAY")
TODAY = pd.Timestamp(_today_env) if _today_env else pd.Timestamp.now().normalize()

# Handshake untuk guard self-heal app.py (kesan proses lama selepas deploy tanpa
# restart). TAK perlu bump untuk deploy biasa, mtime fail yang jaga tu; nilai ni
# cuma tangkap proses dari zaman sebelum guard wujud (modul tanpa MODULE_REV).
MODULE_REV = 2

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


def _awb_present(t: str) -> bool:
    t = str(t).strip()
    return bool(t) and t.lower() != "nan"


# Config per courier income stream (Fasa 1). Tambah courier = tambah entry.
# provider       = nilai orders.shipping_provider untuk courier ni.
# courier_label  = nilai cod_bills.courier (padan masa ingest).
# awb_valid      = check tracking sah (J&T = 10+ digit; DHL/NV = ada nilai).
# no_awb_cat     = kategori bila order Completed tapi tracking tak sah.
COURIERS = {
    "jnt":   {"name": "J&T COD", "provider": {"J&T Express"},
              "courier_label": "J&T Express", "awb_valid": is_real_awb,
              "no_awb_cat": "takde_awb_jnt"},
    "dhl":   {"name": "DHL", "provider": {"DHL eCommerce"},
              "courier_label": "DHL eCommerce", "awb_valid": _awb_present,
              "no_awb_cat": "takde_tracking"},
    "ninja": {"name": "Ninja Van", "provider": {"Ninja Van"},
              "courier_label": "Ninja Van", "awb_valid": _awb_present,
              "no_awb_cat": "takde_tracking"},
}

# Config per gateway prepaid (bayar online, padan ikut order_id, BUKAN tracking).
# methods = nilai orders.payment_method untuk gateway ni.
PREPAID = {
    "chip": {"name": "CHIP", "methods": {"CHIP"}},
}


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

-- Free gift (giveaway) terikat SKU: satu SKU boleh ada beberapa gift (kurma,
-- arabic gold massage, dll), tiap satu kos sendiri. Kos giveaway per order
-- dikira order_skus.qty x sku_gifts.qty x unit_cost (corak sama sku_bottles).
-- Config (macam sku_bottles): KEKAL bila reset data, TAK sentuh logik recon.
CREATE TABLE IF NOT EXISTS sku_gifts (
    sku       TEXT,
    gift_name TEXT,
    unit_cost DOUBLE PRECISION DEFAULT 0,
    qty       INTEGER DEFAULT 1,
    PRIMARY KEY (sku, gift_name)
);
CREATE INDEX IF NOT EXISTS idx_sku_gifts_sku ON sku_gifts(sku);

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

-- Pengesahan bank: jumlah SEBENAR masuk akaun bank per bil settlement (satu bil
-- courier = satu payout). Additive, tak sentuh logik recon, dibanding dengan net
-- remit dijangka untuk tangkap variance (bocor duit). Diisi dari webApp.
CREATE TABLE IF NOT EXISTS bank_deposits (
    bill_id       TEXT PRIMARY KEY,
    actual_amount DOUBLE PRECISION,
    deposited_on  TEXT,
    note          TEXT,
    entered_by    TEXT,
    updated_at    TEXT
);

-- Jejak audit tindakan pengguna (upload, edit SKU, reset, sahkan bank). webApp
-- yang tulis (multi-user Clerk). event_id TEXT (uuid webApp) supaya agnostik
-- dialek. Additive, tiada kesan recon.
CREATE TABLE IF NOT EXISTS app_events (
    event_id TEXT PRIMARY KEY,
    ts       TEXT,
    actor    TEXT,
    action   TEXT,
    detail   TEXT
);

CREATE TABLE IF NOT EXISTS prepaid_payments (
    gateway      TEXT,
    order_ref    TEXT,
    amount       DOUBLE PRECISION,
    fee          DOUBLE PRECISION,
    status       TEXT,
    paid_on      TEXT,
    settled_on   TEXT,
    statement_id TEXT,
    source_file  TEXT,
    ingested_at  TEXT,
    PRIMARY KEY (gateway, order_ref)
);
CREATE INDEX IF NOT EXISTS idx_prepaid_ref ON prepaid_payments(order_ref);

CREATE TABLE IF NOT EXISTS wallet_txns (
    txn_id       TEXT PRIMARY KEY,
    txn_date     TEXT,
    order_id     TEXT,
    seller_id    TEXT,
    seller_name  TEXT,
    seller_role  TEXT,
    txn_type     TEXT,
    source       TEXT,
    status       TEXT,
    amount       DOUBLE PRECISION,
    managed_by   TEXT,
    reference    TEXT,
    note         TEXT,
    source_file  TEXT,
    ingested_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_wallet_order ON wallet_txns(order_id);
CREATE INDEX IF NOT EXISTS idx_wallet_seller ON wallet_txns(seller_name);

CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS order_skus (
    order_id TEXT,
    sku      TEXT,
    sku_raw  TEXT,
    qty      INTEGER,
    PRIMARY KEY (order_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_order_skus_sku ON order_skus(sku);

CREATE INDEX IF NOT EXISTS idx_orders_scope ON orders(payment_method, shipping_provider);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_name);
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
            # values_plus_batch: hantar upsert beratus row per round trip. Default
            # psycopg2 executemany = 1 trip per row, perit bila DB jauh dari app
            # (Streamlit Cloud US -> Neon Singapore ~0.2s setiap trip).
            # page_size 1000: fail besar (puluhan ribu row) = puluhan trip sahaja.
            _ENGINE = create_engine(url, pool_pre_ping=True,
                                    executemany_mode="values_plus_batch",
                                    executemany_batch_page_size=1000)
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


# ====================================================================
# order_skus: bentuk normalized lajur orders.skus (durable, untuk recon SQL).
# Parse SAMA seperti reconcile._bottles_for_skus (rujukan kebenaran, tak disentuh);
# parity harness sahkan output identik.
# ====================================================================
_SKU_QTY_RE = re.compile(r"(\d+)x\s*(.+)")


def parse_skus(skus_str):
    """'2x JAG-MY-1, KK-JAQ-1-1' -> [(key_upper, base_asal, qty), ...] (qty digabung
    kalau SKU sama berulang dalam satu order)."""
    if not isinstance(skus_str, str) or not skus_str.strip():
        return []
    acc = {}
    for part in skus_str.split(","):
        part = part.strip()
        if not part:
            continue
        mm = _SKU_QTY_RE.match(part)
        qty, base = (int(mm.group(1)), mm.group(2).strip()) if mm else (1, part)
        key = base.upper()
        if key in acc:
            acc[key] = (acc[key][0], acc[key][1] + qty)
        else:
            acc[key] = (base, qty)
    return [(k, raw, q) for k, (raw, q) in acc.items()]


def rebuild_order_skus(conn, pairs):
    """Bina semula baris order_skus untuk senarai (order_id, skus_str) diberi.
    Dipanggil dari ingest (batch yang diupload sahaja) dan backfill."""
    ids = [str(oid) for oid, _ in pairs]
    CHUNK = 500
    for i in range(0, len(ids), CHUNK):
        conn.execute(
            text("DELETE FROM order_skus WHERE order_id IN :ids")
            .bindparams(bindparam("ids", expanding=True)),
            {"ids": ids[i:i + CHUNK]},
        )
    rows = []
    for oid, skus_str in pairs:
        for key, raw, qty in parse_skus(skus_str):
            rows.append({"oid": str(oid), "sku": key, "raw": raw, "qty": qty})
    if rows:
        conn.execute(
            text("INSERT INTO order_skus (order_id, sku, sku_raw, qty) "
                 "VALUES (:oid, :sku, :raw, :qty)"), rows)


def ensure_order_skus(conn):
    """Backfill sekali: kalau orders dah ada isi tapi order_skus kosong (DB dari
    sebelum jadual ni wujud), bina dari orders.skus secara berchunk (jimat RAM)."""
    n_os = conn.execute(text("SELECT COUNT(*) FROM order_skus")).scalar()
    if n_os:
        return
    n_ord = conn.execute(text("SELECT COUNT(*) FROM orders")).scalar()
    if not n_ord:
        return
    for chunk in pd.read_sql(text("SELECT order_id, skus FROM orders"), conn,
                             chunksize=50_000):
        rebuild_order_skus(conn, list(zip(chunk["order_id"], chunk["skus"])))
    conn.commit()


def confirmed_paid_order_ids(conn):
    """Set order_id yang duitnya disahkan masuk oleh feed duit sebenar.

    Titik sambungan TUNGGAL untuk pengesahan paid. Hari ni cuma feed J&T COD wujud,
    jadi order disahkan = tracking ada dalam cod_bill_lines (duit dikutip + remit).
    Bila feed lain masuk nanti (settlement courier lain, report CHIP / online transfer),
    cukup union set order_id dia di sini, semua paparan yang guna fungsi ni update sendiri.
    """
    awb = set(pd.read_sql(text("SELECT awb FROM cod_bill_lines"), conn)["awb"].dropna())
    od = pd.read_sql(text("SELECT order_id, tracking FROM orders"), conn)
    cod_ids = set(od.loc[od["tracking"].isin(awb), "order_id"])
    # Prepaid (CHIP / online transfer): padan ikut order_ref = order_id.
    prepaid = set(pd.read_sql(text("SELECT order_ref FROM prepaid_payments"), conn)["order_ref"].dropna())
    return cod_ids | prepaid


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
    # Padam SEMUA data transaksi yang di-upload. Kekalkan sku_bottles (config mapping,
    # auto-seed) supaya penetapan SKU finance tak hilang bila reset data.
    own = conn is None
    conn = conn or get_conn()
    for t in ("orders", "order_skus", "cod_bill_lines", "cod_bills", "wallet_txns",
              "prepaid_payments"):
        conn.execute(text(f"DELETE FROM {t}"))
    conn.commit()
    if own:
        conn.close()
