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
import uuid
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import bindparam, text

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
        try:
            df = pd.read_csv(io.BytesIO(data))
        except UnicodeDecodeError:
            # Excel Windows simpan "CSV" dalam ANSI (cp1252), bukan UTF-8. Fallback
            # supaya fail sah dari sisi user tak ditolak dengan error mentah.
            try:
                df = pd.read_csv(io.BytesIO(data), encoding="cp1252")
            except UnicodeDecodeError:
                df = pd.read_csv(io.BytesIO(data), encoding="latin-1")
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

# Siling waras auto-daftar: nombor besar dalam nama SKU (tahun kempen "RAYA-2026-1",
# kod promo "PROMO-50") BUKAN kiraan botol. Melebihi siling = tak didaftar, SKU
# kekal dalam amaran unmapped untuk finance isi manual.
MAX_AUTO_BOTTLES = 24


def _sane_bottles(paid, free):
    # None kalau tak waras, jangan biar nombor gila masuk kiraan botol/komisen.
    if paid > MAX_AUTO_BOTTLES or free > MAX_AUTO_BOTTLES:
        return None
    return paid, free


def derive_bottles(sku):
    """Agak (paid, free) dari nama SKU; None kalau corak tak difahami/tak waras."""
    s = str(sku or "").upper().strip()
    if not s:
        return None
    m = re.search(r"(\d+)\s*PLUS\s*(\d+)", s)          # ...-1PLUS1
    if m:
        return _sane_bottles(int(m.group(1)), int(m.group(2)))
    m = re.search(r"-(\d+)-(\d+)$", s)                 # ...-4-2
    if m:
        return _sane_bottles(int(m.group(1)), int(m.group(2)))
    m = re.search(r"[A-Z](\d+)-[A-Z]+(\d+)$", s)       # ...JAG4-FREE2 / JAG2-AGM1
    if m:
        return _sane_bottles(int(m.group(1)), int(m.group(2)))
    m = re.search(r"-(\d+)$", s)                       # ...-2
    if m:
        return _sane_bottles(int(m.group(1)), 0)
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

# Rakam pasangan (order_id, fail) untuk jejak many-to-many (fix bug B1). Setiap
# kali fail sebut order, pasangan direkod; PK (order_id, source_file) buat ia
# idempotent (re-upload fail sama = update ingested_at, bukan baris baru). Delete
# guna jadual ni untuk kekalkan order yang masih ada fail lain vouch untuknya.
ORDER_UPLOADS_UPSERT = text("""
    INSERT INTO order_uploads (order_id, source_file, ingested_at)
    VALUES (:order_id, :source_file, :ingested_at)
    ON CONFLICT(order_id, source_file) DO UPDATE SET
        ingested_at=excluded.ingested_at
""")


# Jejak SENYAP perubahan harga order. Bila order SEDIA ADA datang semula dengan
# selling_price BERBEZA (bukan status berubah, itu normal), catat ke app_events
# (dibaca Activity page webApp). TAK menahan apa apa, log sahaja. Order baru atau
# perubahan bukan-duit TIDAK dilog (elak bising). Idempotent secara praktikal:
# re-upload fail SAMA = harga sama = tiada log baru.
PRICE_EVENT_INSERT = text("""
    INSERT INTO app_events (event_id, ts, actor, action, detail)
    VALUES (:event_id, :ts, :actor, :action, :detail)
""")


def _log_price_changes(conn, order_ids, new_prices, source_file):
    """order_ids/new_prices = Series selari (order_id string, selling_price num).
    Bandingkan lawan harga tersimpan; log satu app_events per order yang harganya
    berubah. Pulang bilangan perubahan dilog."""
    ids = [str(x) for x in order_ids.tolist()]
    if not ids:
        return 0
    old = {}
    CHUNK = 500
    for i in range(0, len(ids), CHUNK):
        res = conn.execute(
            text("SELECT order_id, selling_price FROM orders WHERE order_id IN :ids")
            .bindparams(bindparam("ids", expanding=True)),
            {"ids": ids[i:i + CHUNK]},
        ).fetchall()
        for oid, sp in res:
            old[str(oid)] = sp
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    events = []
    for oid, new_sp in zip(ids, new_prices.tolist()):
        if oid not in old or old[oid] is None:
            continue  # order baru atau harga lama tiada = bukan "perubahan"
        old_v = round(float(old[oid]), 2)
        new_v = round(float(new_sp or 0), 2)
        if old_v == new_v:
            continue  # tiada perubahan duit = senyap
        events.append({
            "event_id": str(uuid.uuid4()), "ts": ts, "actor": "ingest",
            "action": "price_change",
            "detail": (f"Order {oid}: RM {old_v:,.2f} -> RM {new_v:,.2f} "
                       f"({source_file})")[:500],
        })
    if events:
        conn.execute(PRICE_EVENT_INSERT, events)
    return len(events)


def ingest_fighter(df, source_file, conn):
    # Buang baris tanpa Order ID (baris total/blank export). Satu sel kosong buat
    # pandas baca lajur sebagai float, jadi buang juga suffix ".0" (macam wallet
    # txn_id dan norm_trk), kalau tak "6479145.0" duduk sebelah "6479145" (double count).
    df = df[df[F_ORDER].notna()].copy()
    o = pd.DataFrame({
        "order_id": df[F_ORDER].astype(str).str.replace(r"\.0$", "", regex=True).str.strip(),
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
    if rows:  # fail sah tapi kosong (header sahaja) tak patut crash executemany
        # Log perubahan harga SEBELUM upsert (harga lama masih dalam DB).
        _log_price_changes(conn, o["order_id"], o["selling_price"], source_file)
        conn.execute(ORDERS_UPSERT, rows)
        # Rakam pasangan (order_id, fail) ni untuk jejak vouch many-to-many.
        # ingested_at sama dengan orders supaya delete boleh pilih fail vouch
        # TERKINI bila re-point source_file order yang dikongsi.
        ou_rows = [{"order_id": r["order_id"], "source_file": r["source_file"],
                    "ingested_at": r["ingested_at"]} for r in rows]
        conn.execute(ORDER_UPLOADS_UPSERT, ou_rows)
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
    if rows:  # fail sah tapi kosong (header sahaja) tak patut crash executemany
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


# Kuarantin baris bil bertindih (isu D3). AWB sedia ada + bill_id BERBEZA = kes
# pelik (parcel sama disebut 2 bil), baris baru TIDAK ditimpa, diparkir di sini.
CONFLICTS_UPSERT = text("""
    INSERT INTO bill_line_conflicts (awb, bill_id_new, bill_id_existing, cod_new,
                                     cod_existing, fee_new, delivered_date,
                                     source_file, detected_at)
    VALUES (:awb, :bill_id_new, :bill_id_existing, :cod_new, :cod_existing,
            :fee_new, :delivered_date, :source_file, :detected_at)
    ON CONFLICT(awb, bill_id_new) DO UPDATE SET
        bill_id_existing=excluded.bill_id_existing, cod_new=excluded.cod_new,
        cod_existing=excluded.cod_existing, fee_new=excluded.fee_new,
        delivered_date=excluded.delivered_date, source_file=excluded.source_file,
        detected_at=excluded.detected_at
""")


def _quarantine_conflicts(conn, rows, source_file):
    """Pisah baris bil (records dari to_records) yang AWB-nya sudah wujud dalam
    bil BERBEZA. Baris konflik TIDAK ditimpa; disimpan ke bill_line_conflicts
    untuk semakan finance. AWB sama + bill_id SAMA = re-upload bil sama (biar
    upsert idempotent, bukan konflik). Pulang (baris_selamat, bilangan_konflik).

    Dipanggil oleh ingest_jnt/dhl/ninja (semua guna cod_bill_lines PK awb)."""
    if not rows:
        return rows, 0
    awbs = [r["awb"] for r in rows if r.get("awb")]
    existing = {}
    CHUNK = 500
    for i in range(0, len(awbs), CHUNK):
        res = conn.execute(
            text("SELECT awb, bill_id, cod_amount, fee FROM cod_bill_lines "
                 "WHERE awb IN :awbs")
            .bindparams(bindparam("awbs", expanding=True)),
            {"awbs": awbs[i:i + CHUNK]},
        ).fetchall()
        for a, bid, cod, fee in res:
            existing[a] = (bid, cod, fee)
    detected = now_iso()
    keep, conflicts = [], []
    for r in rows:
        ex = existing.get(r["awb"])
        if ex and ex[0] != r["bill_id"]:
            conflicts.append({
                "awb": r["awb"], "bill_id_new": r["bill_id"],
                "bill_id_existing": ex[0], "cod_new": r.get("cod_amount"),
                "cod_existing": ex[1], "fee_new": r.get("fee"),
                "delivered_date": r.get("delivered_date"),
                "source_file": source_file, "detected_at": detected,
            })
        else:
            keep.append(r)
    if conflicts:
        conn.execute(CONFLICTS_UPSERT, conflicts)
    return keep, len(conflicts)


def conflicts_count(conn, source_file):
    """Bilangan baris bil dikuarantin (double-billed) untuk fail ini. Dipakai
    laluan upload surface bilangan dalam mesej hasil (idempotent: re-upload fail
    konflik sama kekal kira sama)."""
    return conn.execute(
        text("SELECT COUNT(*) FROM bill_line_conflicts WHERE source_file = :sf"),
        {"sf": source_file},
    ).scalar() or 0


def ingest_jnt(df, source_file, conn):
    # Buang baris AWB kosong (baris total/blank hujung bil), macam guard Ninja/DHL.
    # Kalau tak, NaN jadi string "NAN" dan padan dengan semua order tanpa tracking.
    df = df[df[J_AWB].notna()].copy()
    df = df[df[J_AWB].astype(str).str.strip() != ""]
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
    if rows:  # fail sah tapi kosong (header sahaja) tak patut crash executemany
        rows, _ = _quarantine_conflicts(conn, rows, source_file)
        if rows:
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
        # `packed` (tanpa sel kosong) HANYA untuk kenal jenis baris. Header dan
        # baris data mesti kekal posisi penuh, kalau buang sel kosong, satu sel
        # optional yang tak diisi anjakkan semua lajur ke kiri (nilai duit rosak).
        packed = [c for c in cells if c != ""]
        if len(packed) == 2 and packed[0].endswith(":"):
            meta[packed[0].rstrip(":")] = packed[1]
        elif packed and packed[0] == "No.":
            header = cells
        elif header and packed and packed[0].isdigit():
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
    # Buang baris ref kosong (awb='' runtuh jadi satu rekod atas PK awb, jumlah
    # COD bil terkurang senyap), guard sama corak dengan J&T/Ninja.
    df = df[df["ref"].astype(str).str.strip() != ""]
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
        recs, _ = _quarantine_conflicts(conn, recs, source_file)
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
        recs, _ = _quarantine_conflicts(conn, recs, source_file)
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
    # Terima juga teks berformat statement: "RM 51.90" dan "(10.00)" (kurungan =
    # negatif, notasi perakaunan). Fallback 0.0 (dipakai untuk fee: fee hilang =
    # 0 munasabah). JANGAN guna untuk amount yang menentukan confirmed (guna
    # _amount_or_none supaya parse gagal tak jadi RM0 disahkan senyap).
    s = str(v).replace(",", "").strip()
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1].strip()
    s = re.sub(r"(?i)^rm\s*", "", s).strip()
    try:
        n = float(s)
    except Exception:
        return 0.0
    return -n if neg else n


def _amount_or_none(v):
    # Untuk laluan yang MENENTUKAN confirmed (amount prepaid): parse gagal ->
    # None (NULL), BUKAN 0.0 senyap. Baris amount NULL tak akan auto-confirmed
    # (confirmed perlu amount > 0), jadi ia jatuh ke "perlu semak", bukan
    # "RM0 disahkan". Format sama _num (RM, koma, kurungan negatif).
    s = str(v).replace(",", "").strip()
    if s == "" or s.lower() in ("nan", "none"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1].strip()
    s = re.sub(r"(?i)^rm\s*", "", s).strip()
    try:
        n = float(s)
    except Exception:
        return None
    return -n if neg else n


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


def _dedup_chip_recs(recs):
    """Gabung baris purchase CHIP yang kongsi order_ref DALAM satu statement.

    Kenapa perlu: PK prepaid_payments = (gateway, order_ref). Kalau satu fail CHIP
    ada 2+ baris purchase berjaya untuk order_ref SAMA, batch upsert cuba kena
    baris PK sama dua kali , Postgres RAISE "cannot affect row a second time",
    SQLite pula senyap last-wins (tak konsisten, dan last-wins buang duit baris
    lain). De-dup di Python (sebelum upsert) buat dua enjin berkelakuan sama.

    Semantik JUJUR untuk recon: JUMLAHKAN amaun. Kalau customer betul betul bayar
    2 kali untuk order sama, duit masuk memang lebih; reconcile_prepaid banding
    amount lawan selling_price order, jadi jumlah yang lebih akan ANGKAT
    amount_mismatch untuk finance siasat , itu perangai jujur, bukan sembunyi.
    Fee dijumlah sama. Medan tarikh/status/sumber ambil rekod TERKINI (paid_on
    paling lewat). amount None (parse gagal) tak menyumbang ke jumlah; hasil
    kekal None hanya kalau SEMUA duplikat None (jatuh ke 'perlu semak', bukan
    RM0 disahkan senyap). Turutan kemunculan pertama dikekalkan (idempotent)."""
    by_ref = {}
    order = []
    for r in recs:
        ref = r["order_ref"]
        if ref not in by_ref:
            by_ref[ref] = dict(r)
            order.append(ref)
            continue
        merged = by_ref[ref]
        a, b = merged.get("amount"), r.get("amount")
        merged["amount"] = a if b is None else (b if a is None else a + b)
        merged["fee"] = (merged.get("fee") or 0.0) + (r.get("fee") or 0.0)
        # Rekod terkini menang untuk medan bukan-duit (tarikh, status, sumber).
        if (r.get("paid_on") or "") >= (merged.get("paid_on") or ""):
            for k in ("status", "paid_on", "settled_on", "source_file",
                      "ingested_at"):
                merged[k] = r[k]
    return [by_ref[ref] for ref in order]


def ingest_chip(df, source_file, conn):
    # Hanya baris 'purchase' = bayaran pelanggan masuk (disbursement diparkir).
    df = df[df[C_TYPE].astype(str).str.lower() == "purchase"].copy()
    df = df[df[C_REF].notna()]
    # Hanya baris status BERJAYA: prepaid pending/gagal belum sahkan duit masuk,
    # jangan simpan sebagai bukti bayaran (elak order ditanda confirmed atas
    # bayaran yang belum jadi). Bila settle nanti, re-upload tangkap (idempotent).
    if C_STATUS in df.columns:
        df = df[df[C_STATUS].astype(str).str.strip().str.lower()
                .isin(db.PREPAID_SUCCESS_STATUS)]
    df["order_ref"] = df[C_REF].astype(str).str.replace("FIGHTER-", "", regex=False).str.strip()
    df = df[df["order_ref"].astype(bool) & (df["order_ref"].str.lower() != "nan")]
    stmt_id = _chip_stmt_id(source_file)
    recs = []
    for _, r in df.iterrows():
        recs.append({
            "gateway": "chip",
            "order_ref": r["order_ref"],
            "amount": _amount_or_none(r.get(C_AMOUNT)),
            "fee": _num(r.get(C_FEE)),
            "status": _txt(r.get(C_STATUS)),
            "paid_on": _chip_dt(r.get(C_PAID)),
            "settled_on": _chip_dt(r.get(C_SETTLED)),
            "statement_id": stmt_id,
            "source_file": source_file,
            "ingested_at": now_iso(),
        })
    if recs:
        recs = _dedup_chip_recs(recs)
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
            # Rollback wajib: kalau tak, transaksi Postgres kekal aborted dan
            # SEMUA fail selepas ni gagal senyap (atau baris separa ter-commit).
            conn.rollback()
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
