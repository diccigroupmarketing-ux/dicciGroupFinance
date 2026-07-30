"""
ingest.py , dicciGroupFinance

Baca fail mentah dalam data/inbox/, auto kenal Fighter vs bil J&T ikut lajur,
normalise, dan upsert ke recon.db. Idempotent: re-run fail sama tak double count.
Fail yang siap diproses dipindah ke data/archive/.

Guna: python ingest.py
"""

import warnings
warnings.filterwarnings("ignore")

import hashlib
import io
import json
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import bindparam, text

import db


# =====================================================================
# Kod sebab ingest + hasil kaya + ralat mesra
# ---------------------------------------------------------------------
# Setiap fail upload berakhir dengan SATU sebab (enum kecil, sengaja tak
# dikembangkan jadi sistem klasifikasi berlapis). UI papar mesej plain ikut
# sebab ni, bukan error mentah. "Apa maksudnya": daripada bagi user error
# teknikal yang bocor, kita bagi ayat biasa yang beritahu dia nak buat apa.
# =====================================================================
REASON_OK = "ok"                       # berjaya diproses
REASON_CORRUPT_KNOWN = "corrupt_known"  # bil dikenali tapi fail rosak/terpotong
REASON_NOT_A_BILL = "not_a_bill"        # dokumen dikenali tapi BUKAN bil bayaran
REASON_UNKNOWN = "unknown"              # betul betul tak dikenali
REASON_MISSING_COLUMNS = "missing_columns"  # feed dikenali tapi lajur wajib hilang
REASON_SUSPECT_VALUES = "suspect_values"    # lajur duit ada sel yang tak boleh dibaca
REASON_NO_PAYMENT_ROWS = "no_payment_rows"  # feed sah tapi 0 baris bayaran boleh disimpan
REASON_TALLY_MISMATCH = "tally_mismatch"    # jumlah baris tak padan jumlah kawalan fail
REASON_DUPLICATE_ROWS = "duplicate_rows"    # kunci berulang DALAM fail, nilai berbeza
REASON_NOT_MODELLED = "not_modelled"        # fail ada elemen duit yang belum dimodelkan

REASON_MESSAGE = {
    REASON_CORRUPT_KNOWN: ("This bill looks damaged. Please download it again "
                           "from the courier and re-upload."),
    REASON_NOT_A_BILL: ("This is a delivery status report, not a payment bill. "
                        "Nothing to upload here."),
    REASON_UNKNOWN: ("This file isn't recognised as a bill from any courier "
                     "(J&T, DHL, Ninja, CHIP). If you're sure it's a bill, send "
                     "it to the owner."),
    REASON_MISSING_COLUMNS: ("This file is missing expected column(s). The export "
                             "format may have changed, please check the file or "
                             "contact admin."),
    REASON_SUSPECT_VALUES: ("Some money cells in this file can't be read as "
                            "numbers, so they would be counted as RM 0. Nothing "
                            "was saved, please check the file and upload again."),
    REASON_NO_PAYMENT_ROWS: ("This file was read fine, but none of its rows are "
                             "payments this page can save. Nothing was saved, "
                             "please check the statement period or upload the "
                             "right export."),
    REASON_TALLY_MISMATCH: ("The rows we could read don't add up to the total "
                            "printed in this file, so some money would be "
                            "missing. Nothing was saved, please download the "
                            "file again and upload it."),
    REASON_DUPLICATE_ROWS: ("This file lists the same tracking number more than "
                            "once with different amounts, so saving it would "
                            "overwrite one row's money with another's. Nothing "
                            "was saved, please check the file with the courier."),
    REASON_NOT_MODELLED: ("This file contains a charge this page doesn't know "
                          "how to record yet, so the amounts would be wrong. "
                          "Nothing was saved, please send this file to the "
                          "owner."),
}


def reason_message(reason):
    """Mesej mesra English untuk satu kod sebab (fallback ke unknown)."""
    return REASON_MESSAGE.get(reason, REASON_MESSAGE[REASON_UNKNOWN])


class IngestError(Exception):
    """Ralat ingest yang bawa kod sebab + mesej mesra English. Dilempar bila
    fail dikenali tapi tak boleh diproses (rosak) atau dikenali tapi bukan bil.
    ingest_bytes tangkap ni dan tukar jadi IngestResult (satu jenis pulangan),
    jadi pemanggil cuma perlu baca .reason , bukan tangkap error mentah."""

    def __init__(self, reason, message=None, detected_type=None):
        self.reason = reason
        self.detected_type = detected_type
        self.message = message or reason_message(reason)
        super().__init__(self.message)


@dataclass
class IngestResult:
    """Hasil satu ingest. Medan minimum yang UI/log betul betul guna sahaja.

    Backward-compat: banyak pemanggil lama buat `kind, n = ingest_bytes(...)`.
    __iter__ pulang (kind, rows) supaya unpack dua-nilai tu kekal jalan tanpa
    ubah pemanggil tu."""

    kind: str = None           # fighter/jnt/dhl/ninja/chip/wallet, None kalau tak ditulis
    rows: int = 0              # baris di-upsert
    reason: str = REASON_OK    # kod sebab (enum di atas)
    detected_type: str = None  # apa fail dikesan (cth "delivery_status_report")
    quarantined: int = 0       # baris bil dikuarantin (double-billed) untuk fail ni
    message: str = ""          # mesej plain untuk UI (kosong bila ok)

    def __iter__(self):
        # Shim: `kind, n = result` kekal berfungsi (unpack dua nilai).
        return iter((self.kind, self.rows))

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


# =====================================================================
# Guard pintu lajur , feed DIKENALI tapi lajur wajib HILANG
# ---------------------------------------------------------------------
# "Apa maksudnya": detect() kenal satu feed dengan SATU lajur tandatangan sahaja.
# Kurier hantar macam macam laporan lain yang kebetulan kongsi lajur tu. Contoh
# sebenar (28 Jul 2026): laporan "balance" Ninja ada "Global Shipper ID"
# (tandatangan feed Ninja) tapi TIADA "Tracking ID", "COD Amount", mahupun lajur
# net. Parser terus capai lajur yang tak wujud, pandas lempar KeyError mentah, ia
# naik sampai ke route upload, dan kerani cuma nampak "Upload failed due to a
# server error" , sifar petunjuk apa yang salah dengan failnya.
#
# Sekarang setiap parser berhenti DI PINTU, sama corak dengan guard Fighter:
# sebab berkod missing_columns, ayat English yang sebut lajur mana hilang + fail
# ni dibaca sebagai apa, dan SATU baris cap jari selamat PII ke ingest_rejections
# (nama lajur sahaja, tiada nilai baris). Tiada apa apa ditulis ke jadual duit.
# Tambah kurier baru = tambah satu entri di sini, duduk sebelah FEEDS supaya tak
# terlepas pandang.
#
# Senarai `required` SENGAJA hanya lajur yang parser betul betul capai TERUS.
# Lajur yang parser dah handle lembut (`if X in df.columns`) TIDAK dimasukkan,
# supaya guard tak jadi lebih ketat daripada parser sendiri dan tolak fail sah.
# =====================================================================
FEED_SCHEMA = {
    "fighter": {
        "label": "a Fighter orders export",
        "hint": ("The Fighter export format may have changed, please check the "
                 "file or contact admin."),
        "required": [F_DATE, F_AMOUNT, F_COMM, F_ITEMCOUNT, F_SKUS],
    },
    "wallet": {
        "label": "a Fighter Wallet export",
        "hint": ("The Wallet export format may have changed, please check the "
                 "file or contact admin."),
        "required": [W_TXN, W_DATE, W_SELLER, W_TYPE, W_SOURCE, W_STATUS,
                     W_AMOUNT],
    },
    "jnt": {
        "label": "a J&T Express COD bill",
        "hint": ("It looks like a different J&T report, not the COD bill this "
                 "page reads. Please upload the COD bill (Excel or PDF "
                 "statement), or contact admin."),
        "required": [J_AWB, J_COD, J_FEE, J_DELIVERED, J_PICKUP],
    },
    "ninja": {
        "label": "a Ninja Van COD statement of account",
        "hint": ("It looks like a different Ninja Van report, for example a "
                 "balance or parcel listing, not the COD statement of account "
                 "this page reads. A balance listing has no payout amount, so "
                 "it cannot prove money reached the bank. Please upload the COD "
                 "statement of account, or contact admin."),
        "required": [NV_TRACK, NV_COD, NV_NET, NV_COMPLETE, NV_PICKUP],
    },
    "dhl": {
        "label": "a DHL eCommerce Payment Advice",
        "hint": ("It looks like a different DHL document, not the Payment "
                 "Advice this page reads. Please upload the Payment Advice, or "
                 "contact admin."),
        "required": [D_REF, D_COD, D_DELIVERED],
    },
    "chip": {
        "label": "a CHIP payment statement",
        "hint": ("The CHIP export format may have changed, please check the "
                 "file or contact admin."),
        # C_STATUS wajib: parser TAPIS baris ikut status (hanya bayaran BERJAYA
        # jadi bukti duit masuk). Tanpa lajur ni dulu tapisan dilangkau senyap,
        # jadi baris pending/gagal masuk sebagai bukti bayaran , order boleh
        # ditanda confirmed atas duit yang belum sampai. Lebih baik tolak fail.
        "required": [C_TYPE, C_REF, C_AMOUNT, C_STATUS],
    },
}


def guard_feed_columns(kind, columns):
    """Tolak fail yang padan cap jari `kind` tapi kurang lajur wajib.

    `columns` = iterable nama lajur yang ADA dalam fail (df.columns untuk feed
    jadual, senarai header untuk DHL). Lempar IngestError(missing_columns) yang
    sebut nama LAJUR sahaja , tiada nilai baris, jadi selamat dilog. Senyap
    (tiada kesan) bila semua lajur wajib hadir, atau bila `kind` tak berdaftar."""
    spec = FEED_SCHEMA.get(kind)
    if not spec:
        return
    # NOTA: jangan tulis `columns or []` , pandas Index lempar ValueError bila
    # dinilai sebagai boolean. Semak None secara eksplisit.
    have = {str(c).strip() for c in ([] if columns is None else columns)}
    missing = [c for c in spec["required"] if c not in have]
    if not missing:
        return
    raise IngestError(
        REASON_MISSING_COLUMNS,
        message=("This file was read as " + spec["label"] + ", but it is missing "
                 "expected column(s): " + ", ".join(missing) + ". " + spec["hint"]
                 + " Nothing was saved."),
        detected_type=kind)


# Cap jari NEGATIF: laporan status / pre-alert kurier (BUKAN bil bayaran). Ia ada
# lajur STATUS penghantaran + pengenalan kiriman, tapi TIADA tandatangan bil mana
# mana feed. Sengaja SEMPIT (status/tracking sahaja): apa apa lain jatuh ke
# 'unknown', bukan dikelaskan sebagai laporan status. Dipakai HANYA lepas detect()
# pulang None (fail dengan tandatangan bil sebenar dikelas dulu, tak sampai sini).
_STATUS_REPORT_SIGNATURES = [
    {"Shipment ID", "Last Status"},
    {"Tracking ID", "Last Status", "Number Of Delivery Attempts"},
]


def is_status_report(df):
    """True kalau lajur df padan cap jari laporan status kurier (bukan bil)."""
    cols = {str(c).strip() for c in df.columns}
    return any(sig <= cols for sig in _STATUS_REPORT_SIGNATURES)


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


def _ingest_ok(kind, rows, filename, conn):
    """Bungkus hasil BERJAYA jadi IngestResult + kira baris dikuarantin (untuk
    feed bil sahaja; fighter/wallet/chip tiada baris konflik)."""
    q = conflicts_count(conn, filename) if kind in ("jnt", "dhl", "ninja") else 0
    return IngestResult(kind=kind, rows=rows, reason=REASON_OK, quarantined=q)


def _ingest_bytes_inner(data, filename, conn):
    """Laluan klasifikasi + ingest. Pulang IngestResult (reason=ok) bila berjaya;
    LEMPAR IngestError(reason) bila fail ditolak (corrupt/not_a_bill/unknown)."""
    dhl = parse_dhl(data)              # boleh lempar IngestError(corrupt_known)
    if dhl is not None:
        return _ingest_ok("dhl", ingest_dhl(dhl, filename, conn), filename, conn)
    # PDF: team finance boleh upload DHL Payment Advice / bil J&T terus dalam PDF.
    # Kesan ikut magic byte %PDF, hantar ke parser PDF. Kalau PDF tapi BUKAN advice
    # yang dikenali, ia 'unknown' (JANGAN biar jatuh ke _load_df , read_excel atas
    # bytes PDF crash).
    if data[:5].startswith(b"%PDF"):
        dhl_pdf = parse_dhl_pdf(data)
        if dhl_pdf is not None:
            return _ingest_ok("dhl", ingest_dhl(dhl_pdf, filename, conn),
                              filename, conn)
        jnt_pdf = parse_jnt_pdf(data)
        if jnt_pdf is not None:
            jnt_df, jnt_settlement, jnt_acct = jnt_pdf
            return _ingest_ok("jnt", ingest_jnt(jnt_df, filename, conn,
                                                settlement_override=jnt_settlement,
                                                account_override=jnt_acct),
                              filename, conn)
        raise IngestError(REASON_UNKNOWN, detected_type="pdf")
    chip = parse_chip(data, filename)
    if chip is not None:
        return _ingest_ok("chip", ingest_chip(chip, filename, conn), filename, conn)
    # Fail berbentuk jadual (Excel/CSV). Kalau tak boleh baca langsung = unknown
    # (bukan crash mentah), supaya user dapat mesej jujur, bukan error pandas.
    try:
        df = _load_df(data, filename)
    except IngestError:
        raise
    except Exception:
        raise IngestError(REASON_UNKNOWN)
    kind = detect(df)
    if kind == "fighter":
        return _ingest_ok(kind, ingest_fighter(df, filename, conn), filename, conn)
    if kind == "jnt":
        return _ingest_ok(kind, ingest_jnt(df, filename, conn), filename, conn)
    if kind == "ninja":
        return _ingest_ok(kind, ingest_ninja(df, filename, conn), filename, conn)
    if kind == "wallet":
        return _ingest_ok(kind, ingest_wallet(df, filename, conn), filename, conn)
    # Tak kenal ikut tandatangan bil. Cap jari NEGATIF: kalau ia laporan status
    # kurier (bukan bil), beri sebab jelas; selain tu 'unknown'.
    if is_status_report(df):
        raise IngestError(REASON_NOT_A_BILL, detected_type="delivery_status_report")
    raise IngestError(REASON_UNKNOWN)


def ingest_bytes(data, filename, conn):
    """Pintu masuk tunggal ingest dari bytes mentah. Pulang IngestResult.

    Fail ditolak (rosak / bukan bil / tak dikenali) TIDAK melempar , ia jadi
    IngestResult dengan reason + message plain. Ini beri pemanggil SATU jenis
    pulangan untuk semak (result.reason), bukan campur return + raise. Fail
    ditolak turut dilog SATU baris ke ingest_rejections (cap jari selamat PII).
    Ralat TAK dijangka (pepijat sebenar / DB) kekal dilempar naik."""
    try:
        result = _ingest_bytes_inner(data, filename, conn)
    except IngestError as e:
        result = IngestResult(kind=None, rows=0, reason=e.reason,
                              detected_type=e.detected_type, message=e.message)
    if result.reason != REASON_OK and conn is not None:
        try:
            log_rejection(conn, data, filename, result)
        except Exception:
            pass  # gagal log TAK boleh halang respons ke user
    return result


def ingest_buffer(fileobj, filename, conn):
    """Ingest satu fail upload (untuk UI web). Pulang IngestResult."""
    data = fileobj.read()
    if isinstance(data, str):
        data = data.encode()
    return ingest_bytes(data, filename, conn)


# =====================================================================
# Log tolakan (item 5): satu baris per fail ditolak, cap jari SELAMAT PII.
# ---------------------------------------------------------------------
# "Apa maksudnya": bila satu fail ditolak, kita nak tahu KENAPA tanpa simpan isi
# fail (repo public + data pelanggan). Jadi kita ambil cap jari sahaja , nama
# LAJUR (bukan nilai), 16 byte pertama, saiz, encoding, sha256, extension, sebab,
# masa. TIADA nilai baris/isi disimpan. Jadual ingest_rejections TAK masuk
# RESET_TABLES (kekal bila store direset) supaya sejarah tolakan tak hilang.
# =====================================================================
_ENCODING_MAGIC = [
    (b"\xff\xfe", "utf-16-le"),
    (b"\xfe\xff", "utf-16-be"),
    (b"\xef\xbb\xbf", "utf-8-sig"),
    (b"PK\x03\x04", "zip/xlsx"),
    (b"%PDF-", "pdf"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "ole/xls"),
]


def _detect_encoding(data):
    """Teka encoding/format ikut magic byte (metadata, bukan isi). 'unknown'
    kalau tiada padanan."""
    for magic, name in _ENCODING_MAGIC:
        if data[:len(magic)] == magic:
            return name
    return "unknown"


def _safe_columns(data, filename):
    """Senarai NAMA lajur (bukan nilai) secara best-effort; [] kalau tak boleh
    baca. Hanya label header, tiada isi baris (selamat PII)."""
    try:
        df = _load_df(data, filename)
        return [str(c) for c in df.columns]
    except Exception:
        return []


def safe_fingerprint(data, filename, reason):
    """Cap jari SELAMAT PII satu fail ditolak. HANYA metadata: nama lajur, magic
    16 byte (hex), saiz, encoding, sha256, extension, reason, ts. HARAM simpan
    sebarang nilai baris/isi."""
    ext = ""
    if "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
    return {
        "id": str(uuid.uuid4()),
        "ts": now_iso(),
        "reason": reason,
        "extension": ext,
        "size_bytes": len(data),
        "magic_hex": data[:16].hex(),
        "encoding": _detect_encoding(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "columns_json": json.dumps(_safe_columns(data, filename)),
    }


REJECTION_INSERT = text("""
    INSERT INTO ingest_rejections (id, ts, reason, extension, size_bytes,
                                   magic_hex, encoding, sha256, columns_json)
    VALUES (:id, :ts, :reason, :extension, :size_bytes,
            :magic_hex, :encoding, :sha256, :columns_json)
""")


def log_rejection(conn, data, filename, result):
    """Tulis SATU baris cap jari selamat ke ingest_rejections untuk fail ditolak."""
    fp = safe_fingerprint(data, filename, result.reason)
    conn.execute(REJECTION_INSERT, fp)
    conn.commit()


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


# =====================================================================
# Guard ingest Fighter , schema + nilai duit (amountGuard)
# ---------------------------------------------------------------------
# "Apa maksudnya": dulu kalau lajur duit HILANG dari export, atau sel duit berisi
# teks pelik ("PENDING", "-"), sistem senyap tukar jadi RM0 dan fail lulus macam
# sah. Duit hilang tanpa bunyi. Tiga guard ni buat fail macam tu DITOLAK dengan
# sebab jelas, jadi finance nampak masalah SEBELUM angka masuk kira kira.
#
#   Guard 1 (schema): lajur wajib mesti ada. Hilang = tolak, bukan ganti 0 senyap.
#   Guard 2 (kosong): Selling Price lebih separuh kosong = export rosak / sel
#                     merged, bukan fail duit yang boleh dipercayai.
#   Guard 3 (nilai) : sel yang ADA isi tapi jadi 0 selepas db.to_num, sedangkan
#                     isinya bukan rupa sifar tulen ("0", "0.00", "RM 0.00") =
#                     tak boleh dipercayai. Sel KOSONG tulen KEKAL dibenarkan,
#                     Fighter memang biar Sales Commission kosong untuk order
#                     tanpa komisen (16% baris dalam export sebenar).
#
# db.to_num TIDAK diubah (ia dipakai semua feed + laluan recon); guard ni duduk
# di LUAR, khas laluan Fighter sahaja.
# =====================================================================
#   Guard 4 (tarikh) : sel Date yang ADA isi tapi TAK boleh diparse jadi tarikh.
#                      Dulu ia jatuh senyap ke NULL, order tu hilang umur (tak
#                      pernah jadi hilang_lewat) = bocor duit tersorok. Sekarang
#                      fail ditolak, sebab sama dengan guard duit (suspect_values).
#   Guard 5 (tarikh) : lajur Date lebih separuh KOSONG tulen = export rosak, sama
#                      logik dengan Guard 2 tapi untuk tarikh. Sel kosong sikit
#                      sikit KEKAL dibenarkan (disimpan NULL); yang ditolak cuma
#                      fail yang majoriti ordernya akan hilang aging sekali gus.
# Satu sumber kebenaran: senarai lajur wajib Fighter kini duduk dalam FEED_SCHEMA
# (sebelah FEEDS) bersama semua feed lain. Alias ni dikekalkan sebab dokumen dan
# kod sedia ada merujuk nama ni.
F_REQUIRED_COLUMNS = FEED_SCHEMA["fighter"]["required"]

# Ambang sel kosong satu lajur (duit dan tarikh kongsi ambang yang SAMA supaya
# finance tak payah ingat dua nombor): LEBIH daripada ini = fail ditolak. Tepat
# pada ambang masih lulus.
F_EMPTY_RATIO_MAX = 0.5

# Teks mentah yang dianggap KOSONG tulen (sel blank / sentinel pandas).
_BLANK_RAW = {"", "nan", "none", "nat", "null", "<na>"}

# Sifar yang ditulis manusia: "0", "00", "0.0", "0.00", "-0", ".0".
_ZERO_LIKE_RE = re.compile(r"^[+-]?0*(?:\.0*)?$")


def _raw_is_blank(raw):
    return str(raw).strip().lower() in _BLANK_RAW


def _looks_pure_zero(raw):
    """True kalau teks mentah ni memang sifar yang ditulis orang ("0", "0.00",
    "RM 0.00", "(0.00)"), bukan teks yang KEBETULAN jadi 0 selepas dibersihkan."""
    t = str(raw).strip().replace(",", "")
    t = re.sub(r"(?i)^(rm|myr)\s*", "", t).strip()
    if t.startswith("(") and t.endswith(")"):
        t = t[1:-1].strip()
    return (bool(t) and any(ch.isdigit() for ch in t)
            and bool(_ZERO_LIKE_RE.match(t)))


def _suspect_money_cells(series, numeric):
    """Senarai teks mentah sel yang ADA isi + bukan rupa sifar tulen tapi jadi 0
    selepas db.to_num , iaitu duit yang akan hilang senyap."""
    out = []
    for raw, num in zip(series.astype(str).tolist(), numeric.tolist()):
        if float(num) != 0.0:
            continue
        if _raw_is_blank(raw) or _looks_pure_zero(raw):
            continue
        out.append(str(raw).strip())
    return out


# =====================================================================
# Guard nilai duit SEJAGAT (satu enjin, semua feed)
# ---------------------------------------------------------------------
# "Apa maksudnya": guard nilai duit dulu HANYA jaga pintu Fighter. Laluan lain
# (Wallet, J&T, DHL, Ninja, CHIP) cuma ada guard LAJUR , iaitu ia semak lajur tu
# WUJUD, tapi tak pernah semak isinya boleh dibaca. Jadi sel duit yang berisi
# teks ("PENDING", "-", "RM -", "N/A") lepas masuk, db.to_num tukar jadi 0, dan
# bil masuk sistem sebagai RM0 tanpa sebarang bunyi. Bil yang sepatutnya bukti
# duit sampai bank jadi bukti kosong; recon ingat kurier tak bayar (atau bayar
# sifar) sedangkan sebenarnya failnya yang tak boleh dibaca.
#
# Sekarang setiap feed daftar lajur duitnya di sini dan SETIAP ingest_* panggil
# guard yang sama, jadi tolakan, ayat, kod sebab, dan baris ingest_rejections
# semuanya seragam. Dua peranan lajur:
#   primary   , lajur yang MEMBAWA duit feed tu (COD/Amount). Dijaga dua kali:
#               (a) nisbah sel KOSONG (lebih F_EMPTY_RATIO_MAX = fail rosak /
#                   sel merged), dan (b) sel berisi yang jadi 0 senyap.
#   secondary , lajur duit sokongan (fee, net). Dijaga (b) SAHAJA. Sel kosong
#               dibenarkan sebab kurier memang biar fee kosong untuk sesetengah
#               baris, sama logik dengan Sales Commission Fighter.
# Ambang kosong kongsi F_EMPTY_RATIO_MAX (0.5) supaya finance cuma perlu ingat
# SATU nombor untuk semua feed dan semua jenis lajur (duit + tarikh).
# =====================================================================
FEED_MONEY = {
    "fighter": {"fix": "re-export it from Fighter",
                "primary": [F_AMOUNT], "secondary": [F_COMM]},
    "wallet": {"fix": "re-export the Wallet report from Fighter",
               "primary": [W_AMOUNT], "secondary": []},
    "jnt": {"fix": "download the COD bill again from J&T",
            "primary": [J_COD], "secondary": [J_FEE]},
    "dhl": {"fix": "download the Payment Advice again from DHL",
            "primary": [D_COD], "secondary": []},
    "ninja": {"fix": "download the COD statement again from Ninja Van",
              "primary": [NV_COD], "secondary": [NV_NET]},
    "chip": {"fix": "download the statement again from CHIP",
             "primary": [C_AMOUNT], "secondary": [C_FEE]},
}


def guard_feed_values(kind, frame, numeric=None, detected_type=None):
    """Tolak fail yang lajur duitnya tak boleh dipercayai (untuk MANA MANA feed).

    `frame`   = DataFrame SELEPAS baris sampah dibuang (baris total/blank export
                tak patut cetuskan penggera palsu). Nama lajurnya mesti nama
                kanonik feed tu (laluan DHL rename dulu sebelum panggil).
    `numeric` = optional {lajur: Series nombor} yang pemanggil dah kira; kalau
                tiada, guard kira sendiri dengan db.to_num (sumber kebenaran sama
                yang parser guna, jadi guard tak boleh lebih/kurang ketat).

    Lempar IngestError(suspect_values) dengan KIRAAN + maksimum 3 contoh teks sel.
    Contoh tu ialah isi sel duit (nombor/teks pendek macam 'PENDING'), bukan nama
    atau alamat , selamat untuk dilog. Senyap bila `kind` tak berdaftar."""
    spec = FEED_MONEY.get(kind)
    if not spec:
        return
    dt = detected_type or kind
    nums = dict(numeric or {})
    have = set(frame.columns)
    n = len(frame)

    def numeric_for(col):
        got = nums.get(col)
        return db.to_num(frame[col]) if got is None else got

    # (a) Lajur duit utama majoriti KOSONG = fail rosak / sel merged.
    if n:
        for col in spec["primary"]:
            if col not in have:
                continue
            blank = sum(1 for raw in frame[col].astype(str).tolist()
                        if _raw_is_blank(raw))
            if blank > n * F_EMPTY_RATIO_MAX:
                raise IngestError(
                    REASON_SUSPECT_VALUES,
                    message=(f"{blank} of {n} rows have an empty '{col}'. The "
                             "file may be damaged or the amounts may sit in "
                             "merged cells. Nothing was saved, please "
                             f"{spec['fix']} and upload again."),
                    detected_type=dt)
    # (b) Sel duit BERISI yang jadi RM0 senyap (utama + sokongan).
    bad = []
    for col in list(spec["primary"]) + list(spec["secondary"]):
        if col not in have:
            continue
        bad += [(col, sample)
                for sample in _suspect_money_cells(frame[col], numeric_for(col))]
    if not bad:
        return
    cols = sorted({col for col, _ in bad})
    examples = ", ".join(f"'{s}'" for _, s in bad[:3])
    raise IngestError(
        REASON_SUSPECT_VALUES,
        message=(f"{len(bad)} money cell(s) in {', '.join(cols)} could not be "
                 f"read as a number (for example {examples}), so they would "
                 "have been counted as RM 0. Nothing was saved, please fix "
                 "the file and upload again."),
        detected_type=dt)


# =====================================================================
# Guard JUMLAH KAWALAN (semakan silang lawan total yang fail sendiri cetak)
# ---------------------------------------------------------------------
# "Apa maksudnya": kurier cetak jumlah besar dalam failnya sendiri (baris TOTAL
# bawah SOA Ninja, "Sum Total"/"Payment amount" dalam advice DHL, GRAND TOTAL
# dalam statement J&T). Sebelum ni kita GUGURKAN baris total tu tanpa memakainya.
# Jadi kalau parser terlepas beberapa baris (format berubah sikit, sel rosak,
# baris tanpa tracking dibuang), sistem tetap kata "berjaya" , cuma duitnya
# kurang, dan tiada siapa tahu. Sekarang jumlah baris yang kita baca DIBANDING
# dengan jumlah yang fail sendiri isytihar. Tak sama = tolak fail.
#
# Toleransi SEN (0.01) sebab kurier bundarkan; lebih daripada tu bukan pembundaran.
# Fail LAMA yang memang tiada baris total: `stated` = None, semakan DILANGKAU
# SENYAP (kita tak boleh mengarang jumlah kawalan yang tak wujud).
# =====================================================================
TALLY_TOLERANCE = 0.01


def _within_cent(got, stated):
    """True kalau dua nombor duit sama dalam had SEN (0.01).

    Beza dibundarkan ke 4 titik DULU: 297.00 - 3.47 keluar 293.53000000000003
    dalam float, dan beza mentahnya dengan 293.54 ialah 0.010000000000048 ,
    lebih daripada 0.01 semata mata sebab hingar float. Kita menolak fail atas
    dasar duit, bukan atas dasar perwakilan nombor."""
    return abs(round(float(got) - float(stated), 4)) <= TALLY_TOLERANCE


def _fix_hint(kind):
    """Ayat 'buat apa sekarang' untuk feed ni (kongsi dengan guard duit)."""
    spec = FEED_MONEY.get(kind) or {}
    return spec.get("fix", "download the file again from the courier")


def guard_control_total(kind, checks, detected_type=None):
    """Tolak fail yang jumlah barisnya tak tally dengan jumlah kawalan fail.

    `checks` = senarai (label, jumlah_dibaca, jumlah_diisytihar). Entri dengan
    jumlah_diisytihar None DILANGKAU (fail tiada total , bukan salah fail).
    Lempar IngestError(tally_mismatch) yang sebut DUA nombor, supaya finance
    nampak berapa banyak duit yang tercicir, bukan sekadar 'fail ditolak'."""
    bad = [(label, float(got), float(stated))
           for label, got, stated in checks
           if stated is not None and not _within_cent(got, stated)]
    if not bad:
        return
    parts = ["'{}' adds up to RM {:,.2f} in the rows we could read, but this "
             "file's own total says RM {:,.2f}".format(label, got, stated)
             for label, got, stated in bad]
    raise IngestError(
        REASON_TALLY_MISMATCH,
        message=("This file does not add up: " + "; ".join(parts) + ". Some "
                 "rows are missing or could not be read, so nothing was saved. "
                 "Please " + _fix_hint(kind) + " and upload again."),
        detected_type=detected_type or kind)


# =====================================================================
# Guard KUNCI BERULANG DALAM SATU FAIL
# ---------------------------------------------------------------------
# "Apa maksudnya": jadual cod_bill_lines berkunci AWB. Kalau SATU fail sebut AWB
# yang sama dua kali dengan amaun BERBEZA, upsert menimpa baris pertama dengan
# yang kedua , duit baris pertama lenyap, tapi kaunter "x baris di-upsert" tetap
# kira dua. Fail nampak berjaya penuh sedangkan sebahagian duitnya hilang.
#
# Sekarang duplikat dikesan SEBELUM apa apa ditulis:
#   , duplikat IDENTIK penuh (fail eksport dua kali baris sama) = dedup SENYAP,
#     tiada duit hilang, dan kaunter jadi jujur (kira baris unik sahaja).
#   , duplikat dengan nilai BERBEZA = tolak fail. Kita TIDAK boleh pilih sendiri
#     baris mana yang betul; itu keputusan finance dengan kurier.
# =====================================================================
def guard_duplicate_rows(kind, rows, key="awb", detected_type=None):
    """Dedup senyap duplikat identik; tolak duplikat yang nilainya berbeza.

    `rows` = records (hasil db.to_records) untuk SATU fail. Pulang senarai baris
    unik dengan turutan asal dikekalkan (idempotent). Lempar
    IngestError(duplicate_rows) dengan contoh kunci (nombor tracking, bukan nama
    atau alamat , selamat dilog)."""
    seen, order, clashes = {}, [], []
    for r in rows:
        k = r.get(key)
        if k not in seen:
            seen[k] = r
            order.append(k)
        elif r != seen[k] and k not in clashes:
            clashes.append(k)
    if clashes:
        examples = ", ".join("'%s'" % k for k in clashes[:3])
        raise IngestError(
            REASON_DUPLICATE_ROWS,
            message=("%d tracking number(s) in this file appear more than once "
                     "with DIFFERENT values (for example %s). Saving it would "
                     "overwrite one row's money with another's, so nothing was "
                     "saved. Please %s and upload again, or check the duplicate "
                     "with the courier."
                     % (len(clashes), examples, _fix_hint(kind))),
            detected_type=detected_type or kind)
    return [seen[k] for k in order]


def guard_fighter_columns(df):
    """Guard 1: lajur wajib Fighter mesti ada. Lempar IngestError(missing_columns)
    dengan nama lajur yang hilang (nama LAJUR sahaja, tiada nilai baris).

    Kini nipis sahaja di atas guard_feed_columns supaya SEMUA feed guna ayat dan
    kod sebab yang sama; nama fungsi dikekalkan untuk pemanggil sedia ada."""
    guard_feed_columns("fighter", df.columns)


def guard_fighter_values(df, price_num, comm_num):
    """Guard 2 + 3: lajur Selling Price majoriti kosong, atau ada sel duit yang
    jadi RM0 senyap. Kini nipis di atas guard_feed_values (enjin sejagat); nama
    dan mesej dikekalkan sama supaya laluan Fighter tak berubah langsung."""
    guard_feed_values("fighter", df,
                      numeric={F_AMOUNT: price_num, F_COMM: comm_num})


def _suspect_date_cells(series, parsed):
    """Senarai teks mentah sel tarikh yang ADA isi tapi gagal diparse (jadi NaT).
    Sel KOSONG tulen dibenarkan (ia disimpan NULL, semua enjin recon setuju)."""
    out = []
    for raw, dt in zip(series.astype(str).tolist(), parsed.tolist()):
        if pd.notna(dt) or _raw_is_blank(raw):
            continue
        out.append(str(raw).strip())
    return out


def guard_fighter_dates(series, parsed):
    """Guard 4 + 5: sel Date yang tak boleh dibaca sebagai tarikh, atau lajur Date
    yang majoritinya kosong = tolak fail.

    Kenapa penting (bukan kosmetik): order tanpa tarikh tak boleh dikira umurnya,
    jadi ia terperangkap kekal dalam baldi 'belum_remit' dan TIDAK PERNAH naik
    jadi 'hilang_lewat'. Duit yang tak sampai jadi tak nampak. Sebelum ni ia
    jatuh senyap ke NULL; sekarang kita berhenti di pintu, sama macam guard duit.

    Guard 5 (kosong) diperiksa DULU: kalau lajur tarikh memang kosong beramai
    ramai, itu masalah fail secara keseluruhan, bukan sel sel nakal, jadi mesej
    tu yang lebih berguna untuk finance."""
    n = len(series)
    if n:
        blank = sum(1 for raw in series.astype(str).tolist() if _raw_is_blank(raw))
        if blank > n * F_EMPTY_RATIO_MAX:
            raise IngestError(
                REASON_SUSPECT_VALUES,
                message=(f"{blank} of {n} rows have an empty '{F_DATE}'. Those "
                         "orders would have no age, so overdue money would stay "
                         "hidden instead of showing up as late. Nothing was "
                         "saved, please re-export it from Fighter and upload "
                         "again."),
                detected_type="fighter")
    bad = _suspect_date_cells(series, parsed)
    if not bad:
        return
    examples = ", ".join(f"'{s}'" for s in bad[:3])
    raise IngestError(
        REASON_SUSPECT_VALUES,
        message=(f"{len(bad)} date cell(s) in '{F_DATE}' could not be read as a "
                 f"date (for example {examples}). Those orders would lose their "
                 "ageing, so overdue money would stay hidden. Nothing was saved, "
                 "please fix the file and upload again."),
        detected_type="fighter")


def ingest_fighter(df, source_file, conn):
    # Guard schema DULU: lajur wajib hilang = tolak fail (dulu diganti 0/None
    # senyap, duit dan botol boleh hilang tanpa bunyi).
    guard_fighter_columns(df)
    # Buang baris tanpa Order ID (baris total/blank export). Satu sel kosong buat
    # pandas baca lajur sebagai float, jadi buang juga suffix ".0" (macam wallet
    # txn_id dan norm_trk), kalau tak "6479145.0" duduk sebelah "6479145" (double count).
    df = df[df[F_ORDER].notna()].copy()
    # Guard nilai duit SEBELUM upsert (baris tanpa Order ID dah dibuang, jadi
    # baris total/blank export tak mencetuskan penggera palsu).
    price_num = db.to_num(df[F_AMOUNT])
    comm_num = db.to_num(df[F_COMM])
    guard_fighter_values(df, price_num, comm_num)
    # Tarikh dikanonikkan DI PINTU: apa apa format yang pandas faham
    # ('01/06/2026', '2026-06-03', '2026-06-03T10:00:00') keluar sebagai
    # "YYYY-MM-DD HH:MM:SS" lewat iso(), dan sel kosong jadi NULL (bukan '').
    # Ini prasyarat parity 3 enjin: reconcile.py parse tarikh dengan pandas
    # manakala reconSql.py/recon.ts BANDING TEKS, jadi tarikh bukan kanonik
    # boleh bagi dua jawapan berbeza untuk baris yang sama (audit reconTrust
    # divergen #1). Enjin recon TIDAK diubah, data yang dikemas.
    order_dt = db.parse_dt(df[F_DATE], dayfirst=True)
    guard_fighter_dates(df[F_DATE], order_dt)
    o = pd.DataFrame({
        "order_id": df[F_ORDER].astype(str).str.replace(r"\.0$", "", regex=True).str.strip(),
        "order_date": iso(order_dt),
        "status": df[F_STATUS],
        "seller_name": df[F_SELLER],
        "payment_method": df[F_PAYMENT],
        "shipping_provider": df[F_PROVIDER],
        "tracking": db.norm_trk(df[F_TRACK]),
        "selling_price": price_num,
        "sales_commission": comm_num,
        "skus": df[F_SKUS],
        "item_count": db.to_num(df[F_ITEMCOUNT]).astype(int),
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

# Rakam pasangan (txn_id, fail) untuk jejak many-to-many (fix F05, cermin
# ORDER_UPLOADS_UPSERT). Setiap kali fail sebut transaksi, pasangan direkod; PK
# (txn_id, source_file) buat ia idempotent (re-upload fail sama = update
# ingested_at, bukan baris baru). deleteUpload guna jadual ni untuk kekalkan
# transaksi yang masih ada fail lain vouch untuknya.
WALLET_UPLOADS_UPSERT = text("""
    INSERT INTO wallet_uploads (txn_id, source_file, ingested_at)
    VALUES (:txn_id, :source_file, :ingested_at)
    ON CONFLICT(txn_id, source_file) DO UPDATE SET
        ingested_at=excluded.ingested_at
""")


def _strip_dot0(series):
    # Lajur numerik yang ada null dibaca float ("6479145.0"); buang .0, null/kosong -> None.
    s = series.astype(str).str.replace(r"\.0$", "", regex=True).str.strip()
    return s.where(~s.isin(["nan", "None", "NaN", ""]), None)


def _strip_txt(series):
    """Buang ruang tepi lajur teks; sel kosong/sentinel jadi None (bukan 'nan').

    Kenapa penting (bukan kosmetik): SQL komisen BANDING teks tepat (status =
    'Approved', source = 'Sales'). Satu ruang ekor dari export (" Approved")
    buat perbandingan tu gagal senyap, jadi transaksi tu hilang dari kiraan
    komisen sedangkan ia ada dalam DB. Kita kemas DI PINTU, bukan tampal di
    setiap query."""
    s = series.astype(str).str.strip()
    return s.where(~s.str.lower().isin(list(_BLANK_RAW)), None)


def ingest_wallet(df, source_file, conn):
    # Guard pintu DULU: lajur Wallet yang dicapai TERUS di bawah (tarikh, nama,
    # jenis, sumber, status, amaun) mesti ada, kalau tak ia KeyError mentah.
    guard_feed_columns("wallet", df.columns)
    # Buang baris tanpa Transaction ID (baris total/blank hujung export), sama
    # corak dengan Fighter/J&T/DHL/Ninja. WAJIB: txn_id ialah PK wallet_txns, dan
    # baris kosong jadi string "nan" selepas astype(str) , SEMUA baris tanpa ID
    # runtuh jadi SATU rekod "nan" yang bertimpa timpa, tapi kaunter tetap kira
    # penuh. Fail nampak berjaya, duit komisennya hilang.
    df = df[df[W_TXN].notna()].copy()
    df = df[df[W_TXN].astype(str).str.strip() != ""]
    # Guard nilai duit atas baris yang BENAR benar akan disimpan.
    guard_feed_values("wallet", df)
    w = pd.DataFrame({
        "txn_id": df[W_TXN].astype(str).str.replace(r"\.0$", "", regex=True).str.strip(),
        "txn_date": iso(db.parse_dt(df[W_DATE], dayfirst=True)),
        "order_id": _strip_dot0(df[W_ORDER]) if W_ORDER in df.columns else None,
        "seller_id": _strip_dot0(df[W_SELLER_ID]) if W_SELLER_ID in df.columns else None,
        "seller_name": _strip_txt(df[W_SELLER]),
        "seller_role": _strip_txt(df[W_ROLE]) if W_ROLE in df.columns else None,
        "txn_type": _strip_txt(df[W_TYPE]),
        "source": _strip_txt(df[W_SOURCE]),
        "status": _strip_txt(df[W_STATUS]),
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
        # Rakam pasangan (txn_id, fail) ni untuk jejak vouch many-to-many.
        # ingested_at sama dengan wallet_txns supaya delete boleh pilih fail
        # vouch TERKINI bila re-point source_file baris yang dikongsi.
        wu_rows = [{"txn_id": r["txn_id"], "source_file": r["source_file"],
                    "ingested_at": r["ingested_at"]} for r in rows]
        conn.execute(WALLET_UPLOADS_UPSERT, wu_rows)
    conn.commit()
    return len(rows)


# ---------- J&T bil COD ----------
# =====================================================================
# IDENTITI BIL J&T (bill_id) , dibaiki 30 Jul 2026
# ---------------------------------------------------------------------
# "Apa maksudnya": bill_id sepatutnya menjawab "duit ni datang dari BIL yang
# mana". Dulu ia diambil dari NAMA fail dengan regex (JTMY\w+), dan dua dua
# konvensyen nama fail vendor sebenar mengandungi token yang SAMA:
#     COD账单-明细列表导出 JTMY031691 20260611184046.xlsx  -> JTMY031691
#     2026-07-JTMY031691-DICCI IMPACT SDN. BHD.-0653.pdf   -> JTMY031691
# JTMY031691 ialah nombor AKAUN pengirim, bukan nombor bil. Ia kekal sama untuk
# SETIAP statement Dicci sepanjang hayat akaun. Akibatnya SEMUA bil J&T runtuh
# jadi SATU baris cod_bills: settlement_date ditimpa statement terbaru, satu
# sahaja bank_deposits boleh ditaip untuk semua bil, dan kuarantin double-bill
# MATI sepenuhnya (dua bil berbeza tak pernah dikira "bill_id berbeza").
#
# Apa yang BENAR benar ada dalam kandungan fail:
#   PDF "COD Statement" , INVOICE NO (C-JTMY031691-2607-0022), "Account No :",
#       "Date :2026-07-22", dan senarai "DETAIL DAILY TRANSACTION LIST" yang
#       semua barisnya satu HARI penghantaran (sampel: 2026-07-21).
#   XLSX "COD账单-明细列表导出" , TIADA nombor bil, TIADA akaun, TIADA tarikh
#       statement. Cuma baris: AWB, pick up, delivery, COD, fee. Sampel sebenar
#       merentas 2026-05-20 sampai 2026-05-30 (11 hari) , iaitu satu fail export
#       mengandungi BANYAK bil harian, bukan satu bil.
#
# Jadi identiti yang kedua dua format kongsi ialah AKAUN + HARI PENGHANTARAN
# (J&T settle COD ikut hari; nombor invois 2607-0022 = statement ke-22 bulan
# 2026-07, bertarikh 22 hb). Itulah kunci baru:
#       bill_id = <akaun>-<YYYYMMDD hari penghantaran>   cth JTMY031691-20260721
# Sifatnya:
#   (a) fail SAMA di-upload dua kali  -> bill_id sama (idempotent kekal),
#   (b) statement bulan/hari berbeza  -> bill_id berbeza (kuarantin hidup semula),
#   (c) XLS dan PDF hari yang SAMA    -> bill_id SAMA (tiada konflik palsu antara
#       format), dan satu XLS julat luas pecah jadi bil harian yang betul,
#   (d) baris tanpa tarikh penghantaran yang boleh dibaca -> bucket eksplisit
#       "<akaun>-UNDATED" (nampak pelik di skrin finance, bukan sorok senyap).
#
# FALLBACK AKAUN (jujur, bukan senyap): XLSX langsung TIADA nombor akaun dalam
# kandungan, jadi akaun datang dari nama fail. Data live sebenar menunjukkan team
# finance kadang menamakan semula fail ("jnt jul 2026 impact.xlsx"), jadi tiada
# token JTMY langsung , kita guna batang nama fail sebagai ruang nama. Kesannya:
# dua fail yang dinamakan berlainan TAK akan bergabung walaupun harinya sama,
# jadi baris bertindih akan masuk kuarantin (nampak di skrin finance) dan BUKAN
# bergabung senyap. Sengaja pilih arah tu: over-split yang KELIHATAN lebih
# selamat daripada gabung yang senyap. Ubatnya mudah , upload fail dengan nama
# asal dari J&T (ada JTMY...), atau upload PDF statement (akaun dari kandungan).
#
# SENGAJA BUKAN nombor invois: ia hanya wujud dalam PDF. Kalau PDF pakai invois
# dan XLS pakai benda lain, setiap parcel yang muncul dalam kedua dua format
# akan dikuarantin sebagai "double-billed" walhal ia dokumen yang sama , ribut
# amaran palsu. cod_bills pula tiada lajur untuk simpan nombor invois berasingan
# (schema db.py di luar skop pembaikan ni).
# =====================================================================
_JNT_ACCOUNT_RE = re.compile(r"(JTMY\w+)")
# Baris "Account No :JTMY031691" dalam PDF COD Statement.
_JNT_ACCOUNT_LINE = re.compile(r"Account\s*No\s*:\s*([A-Za-z0-9]+)")


def jnt_account(filename, content_account=None):
    """Ruang nama bil J&T = nombor AKAUN pengirim (contoh JTMY031691).

    Utamakan akaun dari KANDUNGAN (PDF statement mencetaknya). Kalau tiada,
    ambil token JTMY... dari nama fail (kedua dua konvensyen vendor ada token
    ni). Kalau dua dua tiada, guna batang nama fail supaya fail dari akaun
    berlainan tak bercampur , dan ia nampak pelik bila finance pandang."""
    if content_account:
        return str(content_account).strip()
    m = _JNT_ACCOUNT_RE.search(filename or "")
    if m:
        return m.group(1)
    return (filename or "unknown").rsplit(".", 1)[0]


def jnt_bill_id(account, delivered):
    """Identiti SATU bil COD J&T = akaun + HARI penghantaran (YYYYMMDD).

    `delivered` = tarikh penghantaran baris tu (string ISO 'YYYY-MM-DD...' atau
    None). Tiada tarikh boleh dibaca = bucket '<akaun>-UNDATED' (lihat nota (d)
    di atas)."""
    day = str(delivered)[:10].replace("-", "") if delivered else ""
    ok = len(day) == 8 and day.isdigit()
    return "%s-%s" % (account, day if ok else "UNDATED")


def parse_jnt_meta(filename):
    """(akaun, tarikh dari nama fail) untuk bil J&T. BUKAN identiti bil.

    Tarikh: larian 8-digit PERTAMA dalam nama fail. Untuk export XLSX ia tarikh
    EXPORT (bila kerani tekan download), bukan tarikh settlement sebenar , kita
    kekalkan sebagai anggaran terbaik yang ada (laluan PDF menimpanya dengan
    'Date :' statement yang betul, dan bila PDF hari sama masuk kemudian ia
    membetulkan settlement_date bil harian itu)."""
    account = jnt_account(filename)
    d = re.search(r"(\d{8})", filename)
    settlement = None
    if d:
        try:
            settlement = datetime.strptime(d.group(1), "%Y%m%d").strftime("%Y-%m-%d")
        except ValueError:
            settlement = None
    return account, settlement


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


def ingest_jnt(df, source_file, conn, settlement_override=None,
               account_override=None):
    # Guard pintu DULU (sebelum BILLS_UPSERT), supaya laporan J&T yang bukan bil
    # tak tinggalkan baris bil kosong atau meletup jadi KeyError mentah.
    guard_feed_columns("jnt", df.columns)
    # Buang baris AWB kosong (baris total/blank hujung bil), macam guard Ninja/DHL.
    # Kalau tak, NaN jadi string "NAN" dan padan dengan semua order tanpa tracking.
    df = df[df[J_AWB].notna()].copy()
    df = df[df[J_AWB].astype(str).str.strip() != ""]
    # Guard nilai duit SEBELUM apa apa tulisan DB (termasuk header bil): bil COD
    # yang lajur duitnya tak boleh dibaca bukan bukti duit sampai bank.
    guard_feed_values("jnt", df)
    account, settlement = parse_jnt_meta(source_file)
    # account_override: laluan PDF baca "Account No :" dari KANDUNGAN statement.
    # settlement_override: laluan PDF (COD Statement) baca tarikh dari kandungan
    # statement (nama fail J&T PDF tiada larian 8-digit). Default None kekalkan
    # perangai Excel sedia ada (tarikh dari nama fail sahaja).
    if account_override:
        account = str(account_override).strip()
    if settlement_override:
        settlement = settlement_override

    delivered = iso(db.parse_dt(df[J_DELIVERED], dayfirst=False))
    l = pd.DataFrame({
        "awb": db.norm_trk(df[J_AWB]),
        # bill_id ditentukan PER BARIS (akaun + hari penghantaran), sebab satu
        # fail export J&T boleh merentas banyak hari = banyak bil. Lihat nota
        # "IDENTITI BIL J&T" di atas.
        "bill_id": pd.Series([jnt_bill_id(account, d) for d in delivered],
                             index=delivered.index),
        "cod_amount": db.to_num(df[J_COD]),
        "fee": db.to_num(df[J_FEE]),
        "delivered_date": delivered,
        "pickup_date": iso(db.parse_dt(df[J_PICKUP], dayfirst=False)),
        "source_file": source_file,
        "ingested_at": now_iso(),
    })
    # Duplikat AWB DALAM fail ni disaring SEBELUM apa apa ditulis (termasuk header
    # bil), sama corak dengan guard lajur/nilai: fail ditolak = sifar kesan DB.
    rows = guard_duplicate_rows("jnt", db.to_records(l))
    # Satu header cod_bills untuk SETIAP bil harian dalam fail ni (turutan tetap
    # supaya jalannya deterministik). Fail sah tapi kosong = tiada bil ditulis,
    # bukan satu header hantu tanpa baris.
    stamp = now_iso()
    seen, bills = set(), []
    for r in rows:
        if r["bill_id"] not in seen:
            seen.add(r["bill_id"])
            bills.append({
                "bill_id": r["bill_id"], "courier": "J&T Express",
                "settlement_date": settlement, "source_file": source_file,
                "ingested_at": stamp,
            })
    if bills:
        conn.execute(BILLS_UPSERT, bills)
    if rows:  # fail sah tapi kosong (header sahaja) tak patut crash executemany
        rows, _ = _quarantine_conflicts(conn, rows, source_file)
        if rows:
            conn.execute(LINES_UPSERT, rows)
    conn.commit()
    return len(rows)


# ---------- J&T COD Statement (.pdf) ----------
# Team finance kadang dapat bil J&T dalam PDF "COD Statement" (bukan Excel).
# PDF ni ada blok SUMMARY (GRAND TOTAL) + "DETAIL DAILY TRANSACTION LIST" dengan
# lajur: No, AWB No., Delivery Date (datetime), COD, Transaction Fee, SST, Net.
# Nilai fee/SST ditulis dalam kurungan (contoh "(3.27)") = tolakan. Output
# diselaraskan jadi DataFrame bentuk SAMA macam bil J&T Excel (lajur J_AWB/J_COD/
# J_FEE/J_DELIVERED/J_PICKUP), jadi ingest_jnt guna semula tanpa ubah logik.
#
# Takrif fee: SAMA macam Excel "Total Processing Fee" = Transaction Fee + SST
# (dua dua kos). Dibuktikan oleh GRAND TOTAL: net = COD - (txnFee + SST). Kita
# simpan fee sebagai nilai POSITIF (magnitud kos), selaras lajur fee Excel.
#
# TANDA (dibaiki round 2): statement tulis kos dalam kurungan, "(3.27)" = -3.27
# selepas to_num. Dulu kod ambil abs() setiap komponen, jadi fee SENTIASA positif
# , termasuk baris reversal/kredit di mana J&T PULANGKAN fee (token TANPA
# kurungan, iaitu positif). abs() tukar pulangan tu jadi kos, dan duit tersasar
# dua kali ganda nilai fee tanpa sebarang bunyi. Sekarang kita NEGATE jumlah
# komponen: fee = -(txn + SST). Baris biasa keluar nilai SAMA macam dulu
# (-(-3.27 + -0.20) = +3.47), baris kredit KEKAL negatif. Semakan per baris
# `cod - fee == net` di bawah yang membuktikan tanda ni betul untuk kedua dua
# jenis baris (dengan abs(), baris kredit akan gagal semakan tu).

# Baris detail: "No AWB YYYY-MM-DD HH:MM:SS COD (txnFee) (SST) Net"
# (kurungan optional; guna to_num untuk tanda, ambil magnitud untuk fee).
_JNT_ROW_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_JNT_STMT_DATE = re.compile(r"Date\s*:\s*(\d{4}-\d{2}-\d{2})")


def _jnt_pdf_num(tok):
    """Nilai duit statement J&T; kurungan = tolakan (to_num handle tanda)."""
    return db.to_num(pd.Series([tok])).iloc[0]


def _jnt_parse_text(full):
    """Baca teks COD Statement J&T -> (DataFrame bentuk bil J&T Excel, settlement,
    akaun) kalau ia betul betul statement J&T, else None. LEMPAR IngestError
    (tally_mismatch) kalau jumlah baris detail tak tally dengan GRAND TOTAL, atau
    kalau ada baris yang `COD - fee != Net`. Fungsi TULEN (atas teks) supaya
    boleh diuji tanpa PDF sebenar."""
    # Tandatangan J&T COD Statement (JANGAN silap kenal PDF DHL / lain).
    if "COD Statement" not in full or "J&T EXPRESS" not in full:
        return None

    rows, grand = [], None
    for line in full.splitlines():
        t = line.split()
        # Baris detail: No + AWB (semua digit) + tarikh + masa + 4 lajur duit.
        if len(t) >= 8 and t[0].isdigit() and t[1].isdigit() \
                and _JNT_ROW_DATE.match(t[2]):
            awb, deliv = t[1], t[2] + " " + t[3]
            cod, txn, sst, net = t[4], t[5], t[6], t[7]
            # Kos ditulis berkurungan (negatif); negate supaya fee kos = positif
            # DAN baris kredit (token positif) kekal negatif. Lihat nota di atas.
            fee = -(_jnt_pdf_num(txn) + _jnt_pdf_num(sst))
            rows.append({
                "awb": awb, "deliv": deliv,
                "cod": _jnt_pdf_num(cod), "fee": round(fee, 2),
                "net": _jnt_pdf_num(net),
            })
        elif line.strip().upper().startswith("GRAND TOTAL") and len(t) >= 6:
            grand = {"cod": _jnt_pdf_num(t[2]), "net": _jnt_pdf_num(t[5])}

    if grand is None:
        raise IngestError(
            REASON_TALLY_MISMATCH,
            message=("This J&T COD Statement has no GRAND TOTAL line, so the "
                     "rows cannot be proven complete. Nothing was saved, please "
                     "download the COD statement again from J&T and upload it."),
            detected_type="jnt")
    # Semakan PER BARIS: COD - fee mesti sama dengan Net yang statement cetak.
    # Ini yang menangkap tanda fee tersalah baca (kredit dibaca sebagai kos) dan
    # lajur tergeser , kes yang jumlah besar boleh sorok kalau ia saling batal.
    off = [r for r in rows
           if not _within_cent(r["cod"] - r["fee"], r["net"])]
    if off:
        examples = ", ".join("'%s'" % r["awb"] for r in off[:3])
        raise IngestError(
            REASON_TALLY_MISMATCH,
            message=("%d line(s) in this J&T COD Statement do not add up: COD "
                     "minus fee does not equal the Net printed on the line (for "
                     "example %s). Nothing was saved, please download the COD "
                     "statement again from J&T and upload it."
                     % (len(off), examples)),
            detected_type="jnt")
    # Validasi dalaman: jumlah baris detail MESTI tally GRAND TOTAL (COD & net).
    cod_sum = round(sum(r["cod"] for r in rows), 2)
    net_sum = round(sum(r["net"] for r in rows), 2)
    guard_control_total("jnt", [
        ("COD (RM)", cod_sum, grand["cod"]),
        ("Net Amount (RM)", net_sum, grand["net"]),
    ])

    settlement = None
    m = _JNT_STMT_DATE.search(full)
    if m:
        settlement = m.group(1)
    # Akaun dari KANDUNGAN ("Account No :JTMY031691"), bukan nama fail. Ia yang
    # jadi ruang nama bill_id, jadi statement yang dinamakan semula oleh kerani
    # tetap masuk bawah akaun yang betul. None = biar ingest_jnt jatuh ke nama
    # fail (fallback berperingkat dalam jnt_account).
    account = None
    ma = _JNT_ACCOUNT_LINE.search(full)
    if ma:
        account = ma.group(1)
    # Bentuk DataFrame IDENTIK lajur bil J&T Excel, supaya ingest_jnt guna semula.
    df = pd.DataFrame({
        J_AWB: [r["awb"] for r in rows],
        J_COD: [r["cod"] for r in rows],
        J_FEE: [r["fee"] for r in rows],
        J_DELIVERED: [r["deliv"] for r in rows],
        J_PICKUP: [None] * len(rows),   # statement tiada tarikh pick up
    })
    return df, settlement, account


def parse_jnt_pdf(data):
    """Pulang (DataFrame bentuk bil J&T Excel, settlement, akaun) kalau `data`
    ialah J&T COD Statement PDF, else None. LEMPAR IngestError(tally_mismatch) kalau
    baris detail tak tally dengan GRAND TOTAL atau dengan Net per baris (tolak
    fail, jangan simpan senyap)."""
    if not data[:5].startswith(b"%PDF"):
        return None
    try:
        import pdfplumber  # lazy: sama corak parse_dhl_pdf
    except Exception:
        return None
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception:
        return None
    full = ""
    try:
        with pdf:
            for page in pdf.pages:
                full += (page.extract_text() or "") + "\n"
    except Exception:
        return None
    return _jnt_parse_text(full)


# ---------- DHL Payment Advice (UTF-16 tab-text dalam .xls) ----------
def _decode_dhl(data):
    """Decode bytes DHL Payment Advice (UTF-16 tab-text) secara TOLERAN.

    Fail sebenar kadang terpotong 1 byte di HUJUNG masa download (padding null),
    jadi decode utf-16 KETAT gagal 'truncated data'. Pemulihan BEDAH: kalau saiz
    ganjil, potong 1 byte padding hujung dan cuba semula (baris data terakhir
    kekal utuh, cuma padding hilang). Cuba utf-16 auto dulu, pastu utf-16-le /
    utf-16-be ikut giliran. SENGAJA tak guna errors='ignore' menyeluruh , itu
    boleh telan digit tengah nombor duit senyap. Pulang teks atau None (bukan
    UTF-16 langsung)."""
    candidates = [data]
    if len(data) % 2:                 # saiz ganjil = kemungkinan terpotong 1 byte
        candidates.append(data[:-1])
    for codec in ("utf-16", "utf-16-le", "utf-16-be"):
        for cand in candidates:
            try:
                return cand.decode(codec)
            except Exception:
                continue
    return None


def parse_dhl(data):
    """Pulang {meta, header, rows} kalau `data` ialah DHL Payment Advice, else
    None (bukan DHL). LEMPAR IngestError(corrupt_known) kalau ia DIKENALI DHL
    tapi tiada baris data yang boleh dibaca (fail rosak/terpotong di tengah),
    supaya ia tak jatuh senyap ke read_excel."""
    txt = _decode_dhl(data)
    if txt is None:
        return None
    if "DHL Parcel ID" not in txt and "Payment Reference" not in txt:
        return None                    # bukan DHL langsung , biar pintu lain cuba
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
    # Fail DIKENALI DHL (lepas gate di atas). Kalau tiada baris data, atau baris
    # data TERAKHIR tiada nilai COD selepas pulih terpotong, anggap ROSAK , jangan
    # simpan bil separa senyap. (Fail sah: byte terpotong di padding hujung, baris
    # terakhir utuh dengan COD, jadi check ni lepas.)
    if not rows:
        raise IngestError(REASON_CORRUPT_KNOWN, detected_type="dhl_payment_advice")
    idx = {name: i for i, name in enumerate(header or [])}
    ci = idx.get(D_COD)
    last = rows[-1]
    last_cod = last[ci] if ci is not None and ci < len(last) else None
    if last_cod is None or str(last_cod).strip() == "":
        raise IngestError(REASON_CORRUPT_KNOWN, detected_type="dhl_payment_advice")
    return {"meta": meta, "header": header, "rows": rows}


def ingest_dhl(parsed, source_file, conn):
    meta, header, rows = parsed["meta"], parsed["header"], parsed["rows"]
    # Guard pintu atas HEADER advice (bukan df): kalau lajur ref/amaun/tarikh tak
    # ada, col() dulu pulang None senyap untuk setiap baris, jadi bil masuk penuh
    # dengan RM0. Sekarang fail ditolak dengan sebab berkod.
    guard_feed_columns("dhl", header)
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
    # Guard nilai duit SEBELUM header bil ditulis. Lajur dalaman "cod" dinamakan
    # semula ke nama kanonik advice supaya mesej ke finance sebut lajur SEBENAR
    # yang dia nampak dalam fail, bukan nama pembolehubah kod.
    guard_feed_values("dhl", df.rename(columns={"cod": D_COD}))
    cod_num = db.to_num(df["cod"])
    # Jumlah kawalan advice (laluan PDF sahaja; .xls lama tiada, jadi None dan
    # semakan dilangkau senyap).
    totals = parsed.get("totals") or {}
    # "Total deduction" BUKAN sifar = DHL potong sesuatu daripada bayaran ini
    # (caj, tuntutan, pelarasan). Kita belum modelkan potongan tu di mana mana,
    # jadi menyimpannya bermakna mencipta angka yang kita tahu salah. Berhenti
    # dan minta bantuan owner, jangan reka nombor.
    deduction = totals.get("deduction")
    if deduction is not None and abs(deduction) > TALLY_TOLERANCE:
        raise IngestError(
            REASON_NOT_MODELLED,
            message=("This DHL Payment Advice has a 'Total deduction' of RM "
                     "{:,.2f}. Deductions are not recorded by this page yet, so "
                     "saving it would show more money than DHL actually paid. "
                     "Nothing was saved, please send this advice to the owner."
                     .format(deduction)),
            detected_type="dhl")
    # Jumlah baris yang kita baca mesti sama dengan setiap jumlah yang advice
    # sendiri cetak (dengan potongan sifar, ketiga tiganya sepatutnya sama).
    cod_sum = round(float(cod_num.sum()), 2)
    guard_control_total("dhl", [
        ("Total before deduction", cod_sum, totals.get("before_deduction")),
        ("Sum Total", cod_sum, totals.get("sum_total")),
        ("Payment amount", cod_sum, totals.get("payment_amount")),
    ])
    # DHL advice tiada lajur fee (COD kasar). fee=0 buat masa ni.
    l = pd.DataFrame({
        "awb": db.norm_trk(df["ref"]),
        "bill_id": bill_id,
        "cod_amount": cod_num,
        "fee": 0.0,
        "delivered_date": iso(pd.to_datetime(df["deliv"], format="%d.%m.%Y", errors="coerce")),
        "pickup_date": None,
        "source_file": source_file,
        "ingested_at": now_iso(),
    })
    # Duplikat ref DALAM advice ni (identik = dedup senyap, berbeza = tolak)
    # disaring SEBELUM header bil ditulis, sama corak dengan J&T/Ninja.
    recs = guard_duplicate_rows("dhl", db.to_records(l))
    conn.execute(BILLS_UPSERT, {
        "bill_id": bill_id, "courier": "DHL eCommerce", "settlement_date": settlement,
        "source_file": source_file, "ingested_at": now_iso(),
    })
    if recs:
        recs, _ = _quarantine_conflicts(conn, recs, source_file)
        if recs:
            conn.execute(LINES_UPSERT, recs)
    conn.commit()
    return len(recs)


# ---------- DHL Payment Advice (.pdf) ----------
# Team finance kadang dapat advice DHL dalam PDF (bukan .xls kembar). PDF ni
# dijana mesin, jadual kemas, jadi kita baca guna pdfplumber (import LAZY supaya
# env yang tak upload PDF, cth CLI reconcile, tak perlu library ni). Output
# diselaraskan jadi bentuk {meta, header, rows} SAMA macam parse_dhl (.xls),
# jadi ingest_dhl guna semula tanpa ubah. Header dikanonkan ke nama yang
# ingest_dhl cari (Customer Reference ID / CoD Amount / Delivery Date), dan
# Payment Date ditukar dd.mm.yyyy -> yyyymmdd supaya identik dengan kembar .xls.

# =====================================================================
# Header jadual PDF dibaca ikut NAMA, bukan POSISI
# ---------------------------------------------------------------------
# "Apa maksudnya": dulu kod anggap jadual PDF sentiasa 7 lajur dalam susunan
# TETAP, dan tampal senarai nama tu terus atas baris data. Jadi kalau DHL sisip
# satu lajur baru di tengah (contoh "Service Type"), setiap nama akan tergeser
# satu lajur ke kiri: nama consignee dibaca sebagai tarikh, dan LAJUR DUIT dibaca
# dari lajur sebelahnya. Amaun salah masuk sistem, tiada bunyi, sebab semua sel
# masih "ada".
#
# Sekarang kita ambil header yang PDF sendiri cetak, dan cuma terjemah nama
# ringkasnya ("Customer Ref.ID") ke nama kanonik advice .xls ("Customer Reference
# ID"). Posisi setiap lajur datang dari fail itu sendiri, jadi lajur baru sisipan
# tak boleh menggeser duit. Nama yang tak dikenali dibiar apa adanya , ia jatuh
# ke guard_feed_columns dan fail ditolak dengan reason missing_columns, bukan
# dibaca dari lajur salah.
_DHL_PDF_ALIASES = {
    "no.": "No.",
    "no": "No.",
    "delivery date": D_DELIVERED,
    "dhl parcel id": "DHL Parcel ID",
    "customer ref.id": D_REF,
    "customer ref. id": D_REF,
    "customer ref id": D_REF,
    "customer reference id": D_REF,
    "consignee name": "Consignee Name",
    "deposit date": D_DEPOSIT,
    "cod amount": D_COD,
}

# Nama kanonik yang menandakan satu jadual PDF ialah jadual baris-item advice
# (bukan jadual ringkasan bayaran). Cukup SATU daripadanya hadir.
_DHL_PDF_ITEM_MARKERS = (D_COD, "DHL Parcel ID")


def _dhl_pdf_header(head):
    """Kanonkan header jadual PDF ikut NAMA lajur, posisi dikekalkan.

    Pulang senarai sama PANJANG dengan `head` (jadi indeksnya boleh terus dipakai
    atas baris data). Nama yang tak ada dalam peta alias dikembalikan seadanya."""
    out = []
    for c in head or []:
        name = str(c or "").strip()
        out.append(_DHL_PDF_ALIASES.get(name.lower(), name))
    return out


def _pdf_cell(v):
    """Bersih satu sel jadual pdfplumber: ambil baris PERTAMA sahaja (nama
    consignee/parcel id kadang bungkus ke baris bawah, dan baris akhir setiap
    muka ada garis pemisah '____' tercantum), buang ruang tepi."""
    if v is None:
        return ""
    return str(v).split("\n")[0].strip()


def _ddmmyyyy_to_yyyymmdd(s):
    """'08.06.2026' -> '20260608' (selaraskan Payment Date PDF dengan .xls).
    None kalau bukan format dd.mm.yyyy."""
    m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", str(s or "").strip())
    return m.group(3) + m.group(2) + m.group(1) if m else None


# Jumlah kawalan yang advice PDF cetak sendiri di kaki jadual. Label "Total
# before deduction:" pecah dua baris dalam extract_text ("Total before\n
# deduction: 3,162.00"), jadi \s+ (yang meliputi newline) bukan hiasan.
_DHL_TOTAL_BEFORE = re.compile(r"Total\s+before\s+deduction\s*:\s*([-(\d.,)]+)")
_DHL_TOTAL_DEDUCTION = re.compile(r"Total\s+deduction\s*:\s*([-(\d.,)]+)")
_DHL_SUM_TOTAL = re.compile(r"Sum\s+Total\s*:\s*([-(\d.,)]+)")


def _dhl_money(tok):
    """Teks duit advice -> float (koma ribuan, kurungan = negatif). None kalau
    tiada teks langsung."""
    if tok is None or str(tok).strip() == "":
        return None
    return round(float(db.to_num(pd.Series([tok])).iloc[0]), 2)


def _dhl_pdf_totals(full_text, pay_amount):
    """Jumlah kawalan advice PDF: {before_deduction, deduction, sum_total,
    payment_amount}. Nilai yang tiada dalam fail = None (semakan dilangkau,
    bukan diada adakan)."""
    def grab(rx):
        m = rx.search(full_text or "")
        return _dhl_money(m.group(1)) if m else None
    return {
        "before_deduction": grab(_DHL_TOTAL_BEFORE),
        "deduction": grab(_DHL_TOTAL_DEDUCTION),
        "sum_total": grab(_DHL_SUM_TOTAL),
        "payment_amount": _dhl_money(pay_amount),
    }


def parse_dhl_pdf(data):
    """Pulang {meta, header, rows} kalau `data` ialah DHL Payment Advice PDF,
    else None. Bentuk output identik parse_dhl (.xls) supaya ingest_dhl guna
    semula tanpa ubah."""
    if not data[:5].startswith(b"%PDF"):
        return None
    try:
        import pdfplumber  # lazy: hanya perlu bila betul betul upload PDF
    except Exception:
        return None
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception:
        return None
    line_rows, header, pay_ref, pay_date, pay_amount, full_text = \
        [], None, None, None, None, ""
    try:
        with pdf:
            for page in pdf.pages:
                full_text += (page.extract_text() or "") + "\n"
                for tbl in page.extract_tables():
                    if not tbl:
                        continue
                    head = _dhl_pdf_header([_pdf_cell(c) for c in tbl[0]])
                    # Jadual baris-item advice, dikenal ikut NAMA lajur kanonik
                    # (bukan kiraan/posisi lajur), jadi lajur baru yang DHL sisip
                    # tak menghalang pengecaman mahupun menggeser bacaan duit.
                    if any(m in head for m in _DHL_PDF_ITEM_MARKERS):
                        if header is None:
                            header = head
                        # Lajur "No." (nombor berjalan) yang menapis baris item
                        # sebenar daripada baris sambungan nama/garis pemisah.
                        no_i = head.index("No.") if "No." in head else 0
                        for r in tbl[1:]:
                            cells = [_pdf_cell(x) for x in r]
                            if no_i < len(cells) and cells[no_i].isdigit():
                                line_rows.append(cells)
                    # Jadual ringkasan bayaran: rujukan + tarikh + amaun dibayar.
                    elif head[:1] == ["Payment document"] and pay_ref is None:
                        for r in tbl[1:]:
                            cells = [_pdf_cell(x) for x in r]
                            if cells and cells[0]:
                                pay_ref = cells[0]
                                pay_date = cells[1] if len(cells) > 1 else None
                                pay_amount = cells[3] if len(cells) > 3 else None
                                break
    except Exception:
        return None
    if not line_rows:
        return None  # PDF sah tapi bukan advice DHL (tiada jadual baris-item)
    # Fallback rujukan dari teks ("...bank transfer number 84780324, subject...").
    if not pay_ref:
        m = re.search(r"bank transfer number\s+(\w+)", full_text)
        pay_ref = m.group(1) if m else None
    meta = {}
    if pay_ref:
        meta["Payment Reference"] = pay_ref
    ymd = _ddmmyyyy_to_yyyymmdd(pay_date)
    if ymd:
        meta["Payment Date"] = ymd
    # Setiap baris dipangkas ke panjang header fail ini (buang sel ekor kosong
    # jadual), jadi indeks nama <-> indeks sel sentiasa sepadan.
    rows = [r[:len(header)] for r in line_rows]
    return {"meta": meta, "header": list(header), "rows": rows,
            "totals": _dhl_pdf_totals(full_text, pay_amount)}


# ---------- Ninja Van COD SOA (.xlsx) ----------
def parse_nv_meta(filename):
    dates = re.findall(r"(\d{8})", filename)
    bill_id = "NVSOA-" + "-".join(dates) if dates else filename.rsplit(".", 1)[0]
    settlement = _yyyymmdd(dates[-1]) if dates else None
    return bill_id, settlement


def _nv_cell_num(v):
    """Sel duit SOA -> float; None kalau sel kosong (bukan 0 senyap)."""
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    if str(v).strip() == "":
        return None
    return float(db.to_num(pd.Series([v])).iloc[0])


def _nv_control_total(df):
    """Baris TOTAL di kaki SOA Ninja: TIADA Tracking ID tapi ADA nilai duit.

    Pulang {'cod':..., 'net':...} atau None. Kalau baris begini tiada (format
    lama) ATAU ada lebih daripada satu (bentuk fail tak dikenali), pulang None
    supaya semakan dilangkau senyap , kita hanya menolak fail bila kita betul
    betul yakin apa yang dibanding."""
    if NV_TRACK not in df.columns:
        return None
    blank = df[NV_TRACK].isna() | (df[NV_TRACK].astype(str).str.strip()
                                   .str.lower().isin(list(_BLANK_RAW)))
    found = []
    for _, r in df[blank].iterrows():
        cod = _nv_cell_num(r.get(NV_COD)) if NV_COD in df.columns else None
        net = _nv_cell_num(r.get(NV_NET)) if NV_NET in df.columns else None
        if cod is None and net is None:
            continue                      # baris pemisah kosong, bukan total
        found.append({"cod": cod, "net": net})
    return found[0] if len(found) == 1 else None


def ingest_ninja(df, source_file, conn):
    # Guard pintu DULU, sebelum apa apa capaian lajur atau tulisan DB. Fail Ninja
    # yang BUKAN COD SOA (contoh laporan balance) ada tandatangan "Global Shipper
    # ID" tapi tiada lajur tracking/COD/net, dulu ia meletup jadi KeyError mentah.
    guard_feed_columns("ninja", df.columns)
    # Baris TOTAL SOA dibaca DULU (sebelum ditapis keluar) supaya ia boleh jadi
    # semakan silang. Dulu ia digugurkan begitu sahaja , jadi kalau penapisan
    # tracking di bawah membuang baris berduit, tiada apa apa yang perasan.
    control = _nv_control_total(df)
    df = df[df[NV_TRACK].notna()].copy()
    df = df[df[NV_TRACK].astype(str).str.upper().str.startswith("NV")]
    # Guard nilai duit SEBELUM header bil ditulis. NET dijaga juga sebab fee
    # dikira COD - NET: NET yang jatuh senyap ke 0 buat fee = COD penuh (kurier
    # nampak macam ambil semua duit), satu lagi cara angka rosak masuk senyap.
    guard_feed_values("ninja", df)
    bill_id, settlement = parse_nv_meta(source_file)
    cod = db.to_num(df[NV_COD])
    net = db.to_num(df[NV_NET])
    if control:
        guard_control_total("ninja", [
            (NV_COD, round(float(cod.sum()), 2), control["cod"]),
            (NV_NET, round(float(net.sum()), 2), control["net"]),
        ])
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
    # Duplikat tracking DALAM SOA ni disaring SEBELUM header bil ditulis.
    recs = guard_duplicate_rows("ninja", db.to_records(l))
    conn.execute(BILLS_UPSERT, {
        "bill_id": bill_id, "courier": "Ninja Van", "settlement_date": settlement,
        "source_file": source_file, "ingested_at": now_iso(),
    })
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

# Rakam pasangan (gateway, order_ref, fail) untuk jejak many-to-many (fix F05,
# cermin ORDER_UPLOADS_UPSERT). Kunci ikut PK prepaid_payments (gateway,
# order_ref) + fail. Idempotent: re-upload statement sama = update ingested_at.
PREPAID_UPLOADS_UPSERT = text("""
    INSERT INTO prepaid_uploads (gateway, order_ref, source_file, ingested_at)
    VALUES (:gateway, :order_ref, :source_file, :ingested_at)
    ON CONFLICT(gateway, order_ref, source_file) DO UPDATE SET
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
    # Guard pintu DULU: statement CHIP tanpa lajur Type/Amount tak boleh dibaca
    # sebagai bukti bayaran, tolak dengan sebab berkod bukan KeyError mentah.
    guard_feed_columns("chip", df.columns)
    total = len(df)
    # Hanya baris 'purchase' = bayaran pelanggan masuk (disbursement diparkir).
    # .strip() penting: CHIP kadang hantar sel dengan ruang ekor (" purchase"),
    # tanpa strip baris tu jatuh senyap dari statement = duit masuk hilang.
    df = df[df[C_TYPE].astype(str).str.strip().str.lower() == "purchase"].copy()
    df = df[df[C_REF].notna()]
    # Hanya baris status BERJAYA: prepaid pending/gagal belum sahkan duit masuk,
    # jangan simpan sebagai bukti bayaran (elak order ditanda confirmed atas
    # bayaran yang belum jadi). Bila settle nanti, re-upload tangkap (idempotent).
    # C_STATUS kini lajur WAJIB (FEED_SCHEMA), jadi tapisan ni tak boleh lagi
    # dilangkau senyap; semak `in df.columns` dikekalkan cuma sebagai jaring
    # untuk pemanggil terus (ujian) yang bina df sendiri.
    if C_STATUS in df.columns:
        df = df[df[C_STATUS].astype(str).str.strip().str.lower()
                .isin(db.PREPAID_SUCCESS_STATUS)]
    # Prefix FIGHTER- dibuang TAK KIRA huruf besar/kecil dan hanya di HADAPAN
    # (dulu "fighter-123" lepas utuh jadi order_ref salah = bayaran jadi yatim).
    df["order_ref"] = (df[C_REF].astype(str)
                       .str.replace(r"(?i)^\s*fighter-", "", regex=True).str.strip())
    df = df[df["order_ref"].astype(bool) & (df["order_ref"].str.lower() != "nan")]
    # Fail ada baris tapi tapisan buang SEMUANYA = jangan pulang hijau senyap
    # ("0 rows" nampak macam berjaya). Beri amaran berkod supaya kerani tahu
    # statement tu memang tiada bayaran berjaya, bukan sistem yang tertelan.
    if total and df.empty:
        raise IngestError(
            REASON_NO_PAYMENT_ROWS,
            message=(f"This CHIP statement has {total} row(s), but none of them "
                     "is a completed customer payment (rows are disbursements, "
                     "or payments still pending/failed), so nothing was saved. "
                     "If you expected payments here, check the statement period "
                     "or re-download it once the payments settle."),
            detected_type="chip")
    # Guard nilai duit atas baris yang BENAR benar akan disimpan.
    guard_feed_values("chip", df)
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
        # Rakam pasangan (gateway, order_ref, fail) untuk jejak vouch. Selepas
        # _dedup_chip_recs, order_ref dalam recs dijamin unik, jadi tiada baris
        # PK sama dua kali dalam satu batch.
        conn.execute(PREPAID_UPLOADS_UPSERT,
                     [{"gateway": r["gateway"], "order_ref": r["order_ref"],
                       "source_file": r["source_file"],
                       "ingested_at": r["ingested_at"]} for r in recs])
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
            res = ingest_bytes(p.read_bytes(), p.name, conn)
        except Exception as e:
            # Rollback wajib: kalau tak, transaksi Postgres kekal aborted dan
            # SEMUA fail selepas ni gagal senyap (atau baris separa ter-commit).
            conn.rollback()
            print(f"[SKIP] {p.name}: {e}")
            continue
        if not res.kind:
            # Fail ditolak: reason + mesej jujur (bukan sekadar "tak kenal").
            print(f"[SKIP] {p.name}: {res.reason} , {res.message}")
            continue
        print(f"[{res.kind}] {p.name}: {res.rows} baris di-upsert")
        dest = db.ARCHIVE / p.name
        if dest.exists():
            dest.unlink()
        shutil.move(str(p), str(dest))

    conn.close()
    print("Selesai. Run `python reconcile.py` untuk hasil.")


if __name__ == "__main__":
    run()
