"""
ingest.py , dicciGroupFinance

Baca fail mentah dalam data/inbox/, auto kenal Fighter vs bil J&T ikut lajur,
normalise, dan upsert ke recon.db. Idempotent: re-run fail sama tak double count.
Fail yang siap diproses dipindah ke data/archive/.

Guna: python ingest.py
"""

import warnings
warnings.filterwarnings("ignore")

import re
import shutil
from datetime import datetime

import pandas as pd
from sqlalchemy import text

import db

# Lajur sumber , Fighter
F_ORDER = "Order ID"
F_DATE = "Date"
F_STATUS = "Status"
F_SELLER = "Seller Name"
F_PAYMENT = "Payment Method"
F_PROVIDER = "Shipping Provider"
F_TRACK = "Tracking Number"
F_AMOUNT = "Selling Price"
F_COMM = "Sales Commission"
F_SKUS = "SKUs"
F_ITEMCOUNT = "Item Count"

# Lajur sumber , bil J&T
J_AWB = "AWB No."
J_COD = "COD Amount"
J_FEE = "Total Processing Fee"
J_DELIVERED = "Delivery Signature Date"
J_PICKUP = "Date | Pick Up"


def load(path):
    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path)
    df.columns = df.columns.str.strip()
    return df


def detect(df):
    if J_AWB in df.columns:
        return "jnt"
    if F_ORDER in df.columns:
        return "fighter"
    return None


def load_buffer(fileobj, filename):
    if filename.lower().endswith((".xlsx", ".xls")):
        df = pd.read_excel(fileobj)
    else:
        df = pd.read_csv(fileobj)
    df.columns = df.columns.str.strip()
    return df


def ingest_buffer(fileobj, filename, conn):
    """Ingest satu fail upload (untuk UI web). Pulang (kind, bilangan_baris)."""
    df = load_buffer(fileobj, filename)
    kind = detect(df)
    if kind == "fighter":
        return kind, ingest_fighter(df, filename, conn)
    if kind == "jnt":
        return kind, ingest_jnt(df, filename, conn)
    return None, 0


def iso(s):
    out = s.dt.strftime("%Y-%m-%d %H:%M:%S")
    return out.where(s.notna(), None)


def now_iso():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------- Fighter ----------
ORDERS_UPSERT = text("""
    INSERT INTO orders (order_id, order_date, status, seller_name, payment_method,
                        shipping_provider, tracking, selling_price, sales_commission,
                        skus, item_count, source_file, ingested_at)
    VALUES (:order_id, :order_date, :status, :seller_name, :payment_method,
            :shipping_provider, :tracking, :selling_price, :sales_commission,
            :skus, :item_count, :source_file, :ingested_at)
    ON CONFLICT(order_id) DO UPDATE SET
        order_date=excluded.order_date, status=excluded.status,
        seller_name=excluded.seller_name, payment_method=excluded.payment_method,
        shipping_provider=excluded.shipping_provider, tracking=excluded.tracking,
        selling_price=excluded.selling_price, sales_commission=excluded.sales_commission,
        skus=excluded.skus, item_count=excluded.item_count,
        source_file=excluded.source_file, ingested_at=excluded.ingested_at
""")


def ingest_fighter(df, source_file, conn):
    o = pd.DataFrame({
        "order_id": df[F_ORDER].astype(str).str.strip(),
        "order_date": iso(db.parse_dt(df[F_DATE], dayfirst=True)),
        "status": df[F_STATUS],
        "seller_name": df[F_SELLER],
        "payment_method": df[F_PAYMENT],
        "shipping_provider": df[F_PROVIDER],
        "tracking": db.norm_trk(df[F_TRACK]),
        "selling_price": db.to_num(df[F_AMOUNT]),
        "sales_commission": db.to_num(df[F_COMM]) if F_COMM in df.columns else 0,
        "skus": df[F_SKUS] if F_SKUS in df.columns else None,
        "item_count": db.to_num(df[F_ITEMCOUNT]).astype(int) if F_ITEMCOUNT in df.columns else 0,
        "source_file": source_file,
        "ingested_at": now_iso(),
    })
    rows = db.to_records(o)
    conn.execute(ORDERS_UPSERT, rows)
    conn.commit()
    return len(rows)


# ---------- J&T bil COD ----------
def parse_bill_meta(filename):
    bill_no = re.search(r"(JTMY\w+)", filename)
    bill_id = bill_no.group(1) if bill_no else filename.rsplit(".", 1)[0]
    d = re.search(r"(\d{8})", filename)
    settlement = None
    if d:
        try:
            settlement = datetime.strptime(d.group(1), "%Y%m%d").strftime("%Y-%m-%d")
        except ValueError:
            settlement = None
    return bill_id, settlement


BILLS_UPSERT = text("""
    INSERT INTO cod_bills (bill_id, courier, settlement_date, source_file, ingested_at)
    VALUES (:bill_id, :courier, :settlement_date, :source_file, :ingested_at)
    ON CONFLICT(bill_id) DO UPDATE SET
        courier=excluded.courier, settlement_date=excluded.settlement_date,
        source_file=excluded.source_file, ingested_at=excluded.ingested_at
""")

LINES_UPSERT = text("""
    INSERT INTO cod_bill_lines (awb, bill_id, cod_amount, fee, delivered_date,
                                pickup_date, source_file, ingested_at)
    VALUES (:awb, :bill_id, :cod_amount, :fee, :delivered_date,
            :pickup_date, :source_file, :ingested_at)
    ON CONFLICT(awb) DO UPDATE SET
        bill_id=excluded.bill_id, cod_amount=excluded.cod_amount, fee=excluded.fee,
        delivered_date=excluded.delivered_date, pickup_date=excluded.pickup_date,
        source_file=excluded.source_file, ingested_at=excluded.ingested_at
""")


def ingest_jnt(df, source_file, conn):
    bill_id, settlement = parse_bill_meta(source_file)
    conn.execute(BILLS_UPSERT, {
        "bill_id": bill_id, "courier": "J&T Express", "settlement_date": settlement,
        "source_file": source_file, "ingested_at": now_iso(),
    })

    l = pd.DataFrame({
        "awb": db.norm_trk(df[J_AWB]),
        "bill_id": bill_id,
        "cod_amount": db.to_num(df[J_COD]),
        "fee": db.to_num(df[J_FEE]),
        "delivered_date": iso(db.parse_dt(df[J_DELIVERED], dayfirst=False)),
        "pickup_date": iso(db.parse_dt(df[J_PICKUP], dayfirst=False)),
        "source_file": source_file,
        "ingested_at": now_iso(),
    })
    rows = db.to_records(l)
    conn.execute(LINES_UPSERT, rows)
    conn.commit()
    return len(rows)


def run():
    db.ARCHIVE.mkdir(parents=True, exist_ok=True)
    db.INBOX.mkdir(parents=True, exist_ok=True)
    conn = db.get_conn()
    db.init_db(conn)

    files = [p for p in sorted(db.INBOX.iterdir())
             if p.is_file() and not p.name.startswith((".", "~$"))]
    if not files:
        print("Inbox kosong. Letak fail dalam data/inbox/ dan run semula.")
        return

    for p in files:
        df = load(p)
        kind = detect(df)
        if kind == "fighter":
            n = ingest_fighter(df, p.name, conn)
            print(f"[Fighter] {p.name}: {n} order di-upsert")
        elif kind == "jnt":
            n = ingest_jnt(df, p.name, conn)
            print(f"[J&T bil] {p.name}: {n} baris di-upsert")
        else:
            print(f"[SKIP] {p.name}: tak kenal format (lajur: {list(df.columns)[:5]}...)")
            continue
        dest = db.ARCHIVE / p.name
        if dest.exists():
            dest.unlink()
        shutil.move(str(p), str(dest))

    conn.close()
    print("Selesai. Run `python reconcile.py` untuk hasil.")


if __name__ == "__main__":
    run()
