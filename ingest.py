"""
ingest.py , dicciGroupFinance

Baca fail mentah dalam data/inbox/, auto kenal Fighter vs bil J&T ikut lajur,
normalise, dan upsert ke recon.db. Idempotent: re-run fail sama tak double count.
Fail yang siap diproses dipindah ke data/archive/.

Guna: python ingest.py
"""

import warnings
warnings.filterwarnings("ignore")

import io
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

# Lajur sumber , DHL Payment Advice (.xls sebenarnya UTF-16 tab-text, bukan Excel)
D_REF = "Customer Reference ID"        # MYHTB... = padan Fighter tracking
D_COD = "CoD Amount"
D_DELIVERED = "Delivery Date"          # format dd.mm.yyyy
D_DEPOSIT = "Deposit Date"

# Lajur sumber , Ninja Van COD SOA (.xlsx)
NV_SHIPPER = "Global Shipper ID"       # tandatangan unik feed NV
NV_TRACK = "Tracking ID"               # NV... = padan Fighter tracking
NV_COD = "COD Amount"
NV_NET = "Amount owing to/(from) shipper (Full Net)"
NV_COMPLETE = "Order Completion Date"  # format yyyymmdd
NV_PICKUP = "Order Pickup Date"

# Lajur sumber , CHIP statement (.xlsx, header sebenar terkubur di tengah fail)
C_TYPE = "Type"           # 'purchase' = bayaran pelanggan; 'custom' = disbursement
C_REF = "Reference Nr."   # FIGHTER-<orderid> = padan Fighter order_id
C_AMOUNT = "Amount"
C_FEE = "Fee"
C_STATUS = "Status"
C_PAID = "Paid On"
C_SETTLED = "Settled On"

# Lajur sumber , Fighter Wallet (dompet komisen stokis: IN=Sales/Recruitment, OUT=Withdraw/Transfer)
W_TXN = "Transaction ID"   # tandatangan unik feed Wallet (Fighter takde lajur ni)
W_DATE = "Date"            # format "HH:MM:SS DD/MM/YYYY"
W_ORDER = "Order ID"       # ada untuk Sales/Recruitment; null untuk Withdraw/Transfer
W_SELLER_ID = "Seller ID"
W_SELLER = "Seller Name"
W_ROLE = "Seller Role"     # LEVEL stokis: FIGHTER / FIGHTER PRO / MASTER / LEADER
W_TYPE = "Type"            # IN / OUT
W_SOURCE = "Source"        # Sales / Recruitment / Withdraw / Transfer
W_STATUS = "Status"        # Approved / Pending / Rejected
W_AMOUNT = "Amount"
W_MANAGED = "Managed By"
W_REF = "Reference"
W_NOTE = "Note"


# Feed registry untuk fail berbentuk jadual (Excel/CSV): dikenal ikut lajur tandatangan
# unik. Tambah feed jadual baru = daftar satu entry. (DHL UTF-16 dikendali berasingan.)
FEEDS = [
    {"name": "jnt", "signature": J_AWB},
    {"name": "ninja", "signature": NV_SHIPPER},
    {"name": "wallet", "signature": W_TXN},  # SEBELUM fighter: Wallet ada "Order ID" juga
    {"name": "fighter", "signature": F_ORDER},
]


def detect(df):
    cols = set(df.columns)
    for feed in FEEDS:
        if feed["signature"] in cols:
            return feed["name"]
    return None


def _load_df(data, filename):
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(io.BytesIO(data))
    else:
        df = pd.read_excel(io.BytesIO(data))
    df.columns = df.columns.str.strip()
    return df


def ingest_bytes(data, filename, conn):
    """Ingest dari bytes mentah. Pulang (kind, bilangan_baris)."""
    dhl = parse_dhl(data)
    if dhl is not None:
        return "dhl", ingest_dhl(dhl, filename, conn)
    chip = parse_chip(data, filename)
    if chip is not None:
        return "chip", ingest_chip(chip, filename, conn)
    df = _load_df(data, filename)
    kind = detect(df)
    if kind == "fighter":
        return kind, ingest_fighter(df, filename, conn)
    if kind == "jnt":
        return kind, ingest_jnt(df, filename, conn)
    if kind == "ninja":
        return kind, ingest_ninja(df, filename, conn)
    if kind == "wallet":
        return kind, ingest_wallet(df, filename, conn)
    return None, 0


def ingest_buffer(fileobj, filename, conn):
    """Ingest satu fail upload (untuk UI web). Pulang (kind, bilangan_baris)."""
    data = fileobj.read()
    if isinstance(data, str):
        data = data.encode()
    return ingest_bytes(data, filename, conn)


def iso(s):
    out = s.dt.strftime("%Y-%m-%d %H:%M:%S")
    return out.where(s.notna(), None)


def now_iso():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _yyyymmdd(s):
    try:
        return datetime.strptime(str(s).strip(), "%Y%m%d").strftime("%Y-%m-%d")
    except Exception:
        return None


def _ymd_series(series):
    # Tarikh yyyymmdd (kadang dibaca float "20260612.0"), pulang Series datetime.
    s = series.astype(str).str.replace(r"\.0$", "", regex=True).str.strip()
    return pd.to_datetime(s, format="%Y%m%d", errors="coerce")


# ---------- Auto-daftar SKU baru ke katalog botol ----------
# Nama SKU Dicci menterjemah bilangan botol: "KK-JAQ-4-2" = 4 paid 2 free,
# "BULK-TT-1PLUS1" = 1 paid 1 free, "MYS-JAG2-AGM1" = 2 paid 1 free (AGM =
# produk minyak, dikira unit free). SKU baru dari fail Fighter didaftar terus
# ke sku_bottles dengan agakan corak ini + product_name penanda, supaya finance
# semak di page SKUs. Corak yang tak difahami TIDAK didaftar (kekal dalam
# amaran unmapped, tetap 0 botol sampai diisi manual).
AUTO_SKU_NOTE = "Auto-added from upload, review bottle counts"


def derive_bottles(sku):
    """Agak (paid, free) dari nama SKU; None kalau corak tak difahami."""
    s = str(sku or "").upper().strip()
    if not s:
        return None
    m = re.search(r"(\d+)\s*PLUS\s*(\d+)", s)          # ...-1PLUS1
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"-(\d+)-(\d+)$", s)                 # ...-4-2
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"[A-Z](\d+)-[A-Z]+(\d+)$", s)       # ...JAG4-FREE2 / JAG2-AGM1
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"-(\d+)$", s)                       # ...-2
    if m:
        return int(m.group(1)), 0
    return None


def register_new_skus(conn, sku_keys):
    """Daftar SKU yang belum wujud dalam sku_bottles. Pulang bilangan ditambah."""
    keys = sorted({str(k or "").upper().strip() for k in sku_keys} - {""})
    if not keys:
        return 0
    existing = {
        str(r[0] or "").upper().strip()
        for r in conn.execute(text("SELECT sku FROM sku_bottles")).fetchall()
    }
    added = 0
    for key in keys:
        if key in existing:
            continue
        guess = derive_bottles(key)
        if guess is None:
            continue
        conn.execute(
            text("INSERT INTO sku_bottles (sku, product_name, paid, free) "
                 "VALUES (:sku, :pn, :paid, :free) ON CONFLICT (sku) DO NOTHING"),
            {"sku": key, "pn": AUTO_SKU_NOTE, "paid": guess[0], "free": guess[1]},
        )
        added += 1
    return added


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
    # Bentuk normalized SKU (order_skus) untuk recon/botol SQL-side; hanya
    # order dalam fail ni yang dibina semula (idempotent macam upsert di atas).
    pairs = list(zip(o["order_id"], o["skus"]))
    db.rebuild_order_skus(conn, pairs)
    register_new_skus(
        conn, (key for _, skus_str in pairs for key, _, _ in db.parse_skus(skus_str)))
    conn.commit()
    return len(rows)


# ---------- Fighter Wallet (komisen stokis) ----------
WALLET_UPSERT = text("""
    INSERT INTO wallet_txns (txn_id, txn_date, order_id, seller_id, seller_name,
                             seller_role, txn_type, source, status, amount,
                             managed_by, reference, note, source_file, ingested_at)
    VALUES (:txn_id, :txn_date, :order_id, :seller_id, :seller_name,
            :seller_role, :txn_type, :source, :status, :amount,
            :managed_by, :reference, :note, :source_file, :ingested_at)
    ON CONFLICT(txn_id) DO UPDATE SET
        txn_date=excluded.txn_date, order_id=excluded.order_id,
        seller_id=excluded.seller_id, seller_name=excluded.seller_name,
        seller_role=excluded.seller_role, txn_type=excluded.txn_type,
        source=excluded.source, status=excluded.status, amount=excluded.amount,
        managed_by=excluded.managed_by, reference=excluded.reference, note=excluded.note,
        source_file=excluded.source_file, ingested_at=excluded.ingested_at
""")


def _strip_dot0(series):
    # Lajur numerik yang ada null dibaca float ("6479145.0"); buang .0, null/kosong -> None.
    s = series.astype(str).str.replace(r"\.0$", "", regex=True).str.strip()
    return s.where(~s.isin(["nan", "None", "NaN", ""]), None)


def ingest_wallet(df, source_file, conn):
    w = pd.DataFrame({
        "txn_id": df[W_TXN].astype(str).str.replace(r"\.0$", "", regex=True).str.strip(),
        "txn_date": iso(db.parse_dt(df[W_DATE], dayfirst=True)),
        "order_id": _strip_dot0(df[W_ORDER]) if W_ORDER in df.columns else None,
        "seller_id": _strip_dot0(df[W_SELLER_ID]) if W_SELLER_ID in df.columns else None,
        "seller_name": df[W_SELLER],
        "seller_role": df[W_ROLE] if W_ROLE in df.columns else None,
        "txn_type": df[W_TYPE],
        "source": df[W_SOURCE],
        "status": df[W_STATUS],
        "amount": db.to_num(df[W_AMOUNT]),
        "managed_by": df[W_MANAGED] if W_MANAGED in df.columns else None,
        "reference": df[W_REF] if W_REF in df.columns else None,
        "note": df[W_NOTE] if W_NOTE in df.columns else None,
        "source_file": source_file,
        "ingested_at": now_iso(),
    })
    rows = db.to_records(w)
    conn.execute(WALLET_UPSERT, rows)
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


# ---------- DHL Payment Advice (UTF-16 tab-text dalam .xls) ----------
def parse_dhl(data):
    """Pulang {meta, header, rows} kalau `data` ialah DHL Payment Advice, else None."""
    try:
        txt = data.decode("utf-16")
    except Exception:
        return None
    if "DHL Parcel ID" not in txt and "Payment Reference" not in txt:
        return None
    meta, rows, header = {}, [], None
    for line in txt.splitlines():
        cells = [c.strip() for c in line.split("\t")]
        cells = [c for c in cells if c != ""]
        if len(cells) == 2 and cells[0].endswith(":"):
            meta[cells[0].rstrip(":")] = cells[1]
        elif cells and cells[0] == "No.":
            header = cells
        elif header and cells and cells[0].isdigit():
            rows.append(cells)
    return {"meta": meta, "header": header, "rows": rows}


def ingest_dhl(parsed, source_file, conn):
    meta, header, rows = parsed["meta"], parsed["header"], parsed["rows"]
    bill_id = meta.get("Payment Reference") or source_file.rsplit(".", 1)[0]
    settlement = _yyyymmdd(meta.get("Payment Date"))
    idx = {name: i for i, name in enumerate(header or [])}

    def col(r, name):
        i = idx.get(name)
        return r[i] if i is not None and i < len(r) else None

    df = pd.DataFrame({
        "ref": [str(col(r, D_REF) or "").lstrip("'") for r in rows],
        "cod": [col(r, D_COD) for r in rows],
        "deliv": [col(r, D_DELIVERED) for r in rows],
    })
    conn.execute(BILLS_UPSERT, {
        "bill_id": bill_id, "courier": "DHL eCommerce", "settlement_date": settlement,
        "source_file": source_file, "ingested_at": now_iso(),
    })
    # DHL advice tiada lajur fee (COD kasar). fee=0 buat masa ni.
    l = pd.DataFrame({
        "awb": db.norm_trk(df["ref"]),
        "bill_id": bill_id,
        "cod_amount": db.to_num(df["cod"]),
        "fee": 0.0,
        "delivered_date": iso(pd.to_datetime(df["deliv"], format="%d.%m.%Y", errors="coerce")),
        "pickup_date": None,
        "source_file": source_file,
        "ingested_at": now_iso(),
    })
    recs = db.to_records(l)
    if recs:
        conn.execute(LINES_UPSERT, recs)
    conn.commit()
    return len(recs)


# ---------- Ninja Van COD SOA (.xlsx) ----------
def parse_nv_meta(filename):
    dates = re.findall(r"(\d{8})", filename)
    bill_id = "NVSOA-" + "-".join(dates) if dates else filename.rsplit(".", 1)[0]
    settlement = _yyyymmdd(dates[-1]) if dates else None
    return bill_id, settlement


def ingest_ninja(df, source_file, conn):
    df = df[df[NV_TRACK].notna()].copy()
    df = df[df[NV_TRACK].astype(str).str.upper().str.startswith("NV")]
    bill_id, settlement = parse_nv_meta(source_file)
    conn.execute(BILLS_UPSERT, {
        "bill_id": bill_id, "courier": "Ninja Van", "settlement_date": settlement,
        "source_file": source_file, "ingested_at": now_iso(),
    })
    cod = db.to_num(df[NV_COD])
    net = db.to_num(df[NV_NET])
    # NV beri net siap ("Amount owing to shipper"); fee = COD - net.
    l = pd.DataFrame({
        "awb": db.norm_trk(df[NV_TRACK]),
        "bill_id": bill_id,
        "cod_amount": cod,
        "fee": (cod - net).round(2),
        "delivered_date": iso(_ymd_series(df[NV_COMPLETE])),
        "pickup_date": iso(_ymd_series(df[NV_PICKUP])),
        "source_file": source_file,
        "ingested_at": now_iso(),
    })
    recs = db.to_records(l)
    if recs:
        conn.execute(LINES_UPSERT, recs)
    conn.commit()
    return len(recs)


# ---------- CHIP statement (.xlsx, prepaid online payments) ----------
PREPAID_UPSERT = text("""
    INSERT INTO prepaid_payments (gateway, order_ref, amount, fee, status, paid_on,
                                  settled_on, statement_id, source_file, ingested_at)
    VALUES (:gateway, :order_ref, :amount, :fee, :status, :paid_on,
            :settled_on, :statement_id, :source_file, :ingested_at)
    ON CONFLICT(gateway, order_ref) DO UPDATE SET
        amount=excluded.amount, fee=excluded.fee, status=excluded.status,
        paid_on=excluded.paid_on, settled_on=excluded.settled_on,
        statement_id=excluded.statement_id, source_file=excluded.source_file,
        ingested_at=excluded.ingested_at
""")


def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return 0.0


def _txt(v):
    return None if pd.isna(v) else str(v).strip()


def _chip_dt(v):
    if pd.isna(v):
        return None
    try:
        return pd.to_datetime(str(v)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def _chip_stmt_id(filename):
    m = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
    return "CHIP-" + (m.group(1) if m else filename.rsplit(".", 1)[0])


def parse_chip(data, filename):
    """Pulang DataFrame (header betul) kalau `data` ialah statement CHIP, else None.
    Header CHIP terkubur di tengah fail, jadi kita imbas cari baris 'Reference Nr.'."""
    if filename.lower().endswith(".csv"):
        return None
    try:
        raw = pd.read_excel(io.BytesIO(data), header=None)
    except Exception:
        return None
    hdr = None
    for i in range(min(40, len(raw))):
        row = [str(x).strip() for x in raw.iloc[i].tolist()]
        if C_REF in row:
            hdr = i
            break
    if hdr is None:
        return None
    df = pd.read_excel(io.BytesIO(data), header=hdr)
    df.columns = df.columns.astype(str).str.strip()
    return df


def ingest_chip(df, source_file, conn):
    # Hanya baris 'purchase' = bayaran pelanggan masuk (disbursement diparkir).
    df = df[df[C_TYPE].astype(str).str.lower() == "purchase"].copy()
    df = df[df[C_REF].notna()]
    df["order_ref"] = df[C_REF].astype(str).str.replace("FIGHTER-", "", regex=False).str.strip()
    df = df[df["order_ref"].astype(bool) & (df["order_ref"].str.lower() != "nan")]
    stmt_id = _chip_stmt_id(source_file)
    recs = []
    for _, r in df.iterrows():
        recs.append({
            "gateway": "chip",
            "order_ref": r["order_ref"],
            "amount": _num(r.get(C_AMOUNT)),
            "fee": _num(r.get(C_FEE)),
            "status": _txt(r.get(C_STATUS)),
            "paid_on": _chip_dt(r.get(C_PAID)),
            "settled_on": _chip_dt(r.get(C_SETTLED)),
            "statement_id": stmt_id,
            "source_file": source_file,
            "ingested_at": now_iso(),
        })
    if recs:
        conn.execute(PREPAID_UPSERT, recs)
    conn.commit()
    return len(recs)


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
        try:
            kind, n = ingest_bytes(p.read_bytes(), p.name, conn)
        except Exception as e:
            print(f"[SKIP] {p.name}: {e}")
            continue
        if not kind:
            print(f"[SKIP] {p.name}: tak kenal format")
            continue
        print(f"[{kind}] {p.name}: {n} baris di-upsert")
        dest = db.ARCHIVE / p.name
        if dest.exists():
            dest.unlink()
        shutil.move(str(p), str(dest))

    conn.close()
    print("Selesai. Run `python reconcile.py` untuk hasil.")


if __name__ == "__main__":
    run()
