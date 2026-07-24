"""
testIngestParsers.py , ujian regresi parser enjin ingest (webApp/api/engine).

Fokus: HANYA lapisan parser TULEN (tanpa DB, tanpa rangkaian). Fungsi ingest_*
yang perlu sambungan DB (conn) DILANGKAU dengan catatan, sebab ujian mesti murni.

Semua fixture ialah data SINTETIK (nama rekaan, tracking rekaan TESTAWB..., amaun
bulat rekaan, tarikh rekaan). Bentuk/header ditiru dari fail sampel sebenar, TIADA
nilai sebenar disalin (repo public, data-safe).

Jalan: cd webApp && python3 api/engine/tests/testIngestParsers.py
"""

import io
import os
import sys
import unittest

import pandas as pd

# Enjin (ingest.py + db.py) duduk dua paras naik dari folder tests ini.
ENGINE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

import db          # noqa: E402
import ingest      # noqa: E402


# =====================================================================
# Pembina fixture sintetik (semua nilai rekaan)
# =====================================================================
TAB = "\t"


def make_dhl_bytes(rows, *, ref_col="Customer Reference ID",
                   payment_ref="TESTPAYREF001", payment_date="20260618",
                   include_signature=True):
    """Jana bytes DHL Payment Advice sintetik: UTF-16, tab-separated, header
    terbenam selepas blok meta (bentuk sama fail sebenar, nilai rekaan).

    `rows` = senarai (no, delivery_date, ref, cod_amount)."""
    parcel_label = "DHL Parcel ID" if include_signature else "Filler ID"
    lines = [
        TAB.join(["", "Customer No:", "TESTCUST01", ""]),
        TAB.join(["", "Customer Name:", "Rekaan Sdn Bhd", ""]),
        TAB.join(["", "Payment Date:", payment_date, ""]),
        TAB.join(["", "Payment Reference:", payment_ref, ""]),
        "",
        TAB.join(["", "No.", "Delivery Date", "Pick Up Account", parcel_label,
                  ref_col, "Consignee Name", "Deposit Date", "CoD Amount", ""]),
    ]
    for no, deliv, ref, cod in rows:
        lines.append(TAB.join(
            ["", str(no), deliv, "TESTACCT", "TESTPARCEL", ref,
             "Nama Rekaan", "", str(cod), ""]))
    return ("\r\n".join(lines)).encode("utf-16")


def make_chip_bytes(records, *, junk_rows=2, header_present=True):
    """Jana bytes statement CHIP sintetik (.xlsx). Header CHIP sebenar terkubur
    di tengah fail selepas beberapa baris ringkasan, jadi kita letak `junk_rows`
    baris sampah dulu, baru baris header.

    `records` = senarai dict dengan kunci Type/Reference Nr./Amount/Fee/Status/
    Paid On/Settled On."""
    header = ["Type", "Reference Nr.", "Amount", "Fee", "Status",
              "Paid On", "Settled On"]
    if not header_present:
        header = ["Type", "Nombor Rujukan", "Amount", "Fee", "Status",
                  "Paid On", "Settled On"]
    grid = []
    for i in range(junk_rows):
        grid.append(["Summary line %d" % i, None, None, None, None, None, None])
    grid.append(header)
    for r in records:
        grid.append([r.get("Type"), r.get("Reference Nr."), r.get("Amount"),
                     r.get("Fee"), r.get("Status"), r.get("Paid On"),
                     r.get("Settled On")])
    buf = io.BytesIO()
    pd.DataFrame(grid).to_excel(buf, index=False, header=False)
    return buf.getvalue()


def make_table_bytes(columns, rows=None):
    """Jana .csv bytes untuk uji detect() ikut cap jari lajur."""
    df = pd.DataFrame(rows or [], columns=columns)
    return df.to_csv(index=False).encode()


# =====================================================================
# 1. Sentinel NAN / nilai kosong (audit Julai)
# =====================================================================
class TestSentinelNan(unittest.TestCase):
    def test_norm_trk_turns_nan_into_sentinel_string(self):
        # Punca guard "buang baris AWB kosong": NaN jadi string "NAN" lepas
        # norm_trk, yang kalau tak ditapis akan padan semua order tanpa tracking.
        out = db.norm_trk(pd.Series([float("nan"), "  test awb 001 ", "12345.0"]))
        self.assertEqual(list(out), ["NAN", "TESTAWB001", "12345"])

    def test_strip_dot0_maps_sentinels_to_none(self):
        out = ingest._strip_dot0(
            pd.Series(["6479145.0", "nan", "None", "NaN", "", "KEEPME"]))
        self.assertEqual(list(out), ["6479145", None, None, None, None, "KEEPME"])

    def test_awb_present_rejects_blank_and_nan(self):
        self.assertFalse(db._awb_present("nan"))
        self.assertFalse(db._awb_present(""))
        self.assertFalse(db._awb_present("   "))
        self.assertFalse(db._awb_present(float("nan")))
        self.assertTrue(db._awb_present("TESTAWB001"))

    def test_to_num_blank_and_nan_become_zero(self):
        out = db.to_num(pd.Series(["", "nan", "RM 5", "12.50", None]))
        self.assertEqual(list(out), [0.0, 0.0, 5.0, 12.5, 0.0])

    def test_to_num_parentheses_are_negative(self):
        # Notasi perakaunan: kurungan = negatif. Dulu to_num buang kurungan dan
        # baca "(30.00)" jadi +30 (salah); kini selaras dengan _num ingest.
        out = db.to_num(pd.Series(
            ["(30.00)", "(1,000.50)", "-30", "30", ""]))
        self.assertEqual(list(out), [-30.0, -1000.5, -30.0, 30.0, 0.0])

    def test_is_real_awb(self):
        self.assertTrue(db.is_real_awb("1234567890"))     # 10 digit
        self.assertFalse(db.is_real_awb("123"))           # terlalu pendek
        self.assertFalse(db.is_real_awb("NV123456789"))   # bukan semua digit
        self.assertFalse(db.is_real_awb("nan"))


# =====================================================================
# 2. Auto-detect feed (cap jari lajur) + tolak fail tak dikenali
# =====================================================================
class TestFeedDetect(unittest.TestCase):
    def test_detect_each_known_feed(self):
        cases = {
            "fighter": ["Order ID", "Date", "Selling Price"],
            "jnt": ["AWB No.", "COD Amount", "Total Processing Fee"],
            "ninja": ["Global Shipper ID", "Tracking ID", "COD Amount"],
            "wallet": ["Transaction ID", "Date", "Amount"],
        }
        for expected, cols in cases.items():
            df = pd.DataFrame(columns=cols)
            self.assertEqual(ingest.detect(df), expected, msg=expected)

    def test_wallet_wins_over_fighter_when_both_order_id_present(self):
        # Wallet ADA lajur "Order ID" juga; registry letak wallet SEBELUM fighter
        # supaya feed Wallet tak tersalah kenal sebagai Fighter.
        df = pd.DataFrame(columns=["Transaction ID", "Order ID", "Amount"])
        self.assertEqual(ingest.detect(df), "wallet")

    def test_unknown_columns_return_none(self):
        df = pd.DataFrame(columns=["Foo", "Bar", "Baz"])
        self.assertIsNone(ingest.detect(df))

    def test_ingest_bytes_rejects_unknown_file_without_db(self):
        # Laluan tolak-fail-tak-dikenali TIDAK sentuh conn, jadi boleh diuji
        # hujung-ke-hujung dengan conn=None (murni, tanpa DB).
        data = make_table_bytes(["Foo", "Bar"], [["a", "b"]])
        kind, n = ingest.ingest_bytes(data, "mystery.csv", None)
        self.assertIsNone(kind)
        self.assertEqual(n, 0)


# =====================================================================
# 3a. Parser DHL end-to-end (bytes UTF-16 -> medan normalized)
# =====================================================================
class TestDhlParser(unittest.TestCase):
    def test_parse_dhl_extracts_meta_header_rows(self):
        data = make_dhl_bytes(
            [(1, "18.06.2026", "TESTREF001", "150.00"),
             (2, "19.06.2026", "TESTREF002", "220.50")],
            payment_ref="TESTPAYREF009", payment_date="20260620")
        parsed = ingest.parse_dhl(data)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["meta"]["Payment Reference"], "TESTPAYREF009")
        self.assertEqual(parsed["meta"]["Payment Date"], "20260620")
        self.assertIn("CoD Amount", parsed["header"])
        self.assertIn("Customer Reference ID", parsed["header"])
        self.assertEqual(len(parsed["rows"]), 2)

    def test_parse_dhl_fields_normalize_to_tracking_amount_date(self):
        # Ambil satu baris dan tarik medan ikut index header (cara sama ingest_dhl),
        # sahkan tracking + amaun + tarikh keluar betul melalui helper kongsi.
        data = make_dhl_bytes([(1, "18.06.2026", "TESTREF001", "150.00")])
        parsed = ingest.parse_dhl(data)
        idx = {name: i for i, name in enumerate(parsed["header"])}
        row = parsed["rows"][0]

        ref = row[idx["Customer Reference ID"]]
        cod = row[idx["CoD Amount"]]
        deliv = row[idx["Delivery Date"]]

        tracking = db.norm_trk(pd.Series([ref])).iloc[0]
        amount = db.to_num(pd.Series([cod])).iloc[0]
        date = pd.to_datetime(pd.Series([deliv]), format="%d.%m.%Y").iloc[0]

        self.assertEqual(tracking, "TESTREF001")
        self.assertEqual(amount, 150.0)
        self.assertEqual(date.strftime("%Y-%m-%d"), "2026-06-18")

    def test_parse_dhl_rejects_non_utf16_bytes(self):
        self.assertIsNone(ingest.parse_dhl(b"just,a,plain,csv\n1,2,3,4"))

    def test_parse_dhl_rejects_utf16_without_signature(self):
        # UTF-16 sah tapi tiada "DHL Parcel ID"/"Payment Reference" = bukan DHL.
        data = make_dhl_bytes([(1, "18.06.2026", "TESTREF001", "10.00")],
                              payment_ref="TESTPAYREF001", include_signature=False)
        # buang juga meta Payment Reference supaya betul-betul tiada tandatangan
        txt = data.decode("utf-16").replace("Payment Reference:", "Something Else:")
        self.assertIsNone(ingest.parse_dhl(txt.encode("utf-16")))

    def test_parse_dhl_drops_empty_ref_rows_shape(self):
        # Baris ref kosong wujud dalam rows mentah (parser tak tapis), tapi
        # bentuknya boleh dikesan: guard lapisan ingest yang buang. Di sini kita
        # sahkan parser tetap kembalikan baris itu apa adanya (kosong di posisi ref).
        data = make_dhl_bytes([(1, "18.06.2026", "", "10.00")])
        parsed = ingest.parse_dhl(data)
        idx = {name: i for i, name in enumerate(parsed["header"])}
        self.assertEqual(parsed["rows"][0][idx["Customer Reference ID"]], "")


# =====================================================================
# 3b. Parser bill_meta end-to-end (nama fail -> bill_id + tarikh ISO)
# =====================================================================
class TestBillMeta(unittest.TestCase):
    def test_jnt_bill_meta_from_filename(self):
        # bill_no regex (JTMY\w+) tamak (\w termasuk underscore) -> id mesti
        # ditamatkan aksara bukan-word (dash). settlement dari \d{8} PERTAMA, jadi
        # id tak boleh kandung larian 8-digit sendiri (nanti tersalah baca tarikh).
        bill_id, settlement = ingest.parse_bill_meta("JTMYABC123-20260618.csv")
        self.assertEqual(bill_id, "JTMYABC123")
        self.assertEqual(settlement, "2026-06-18")

    def test_jnt_bill_meta_no_date_fallback(self):
        bill_id, settlement = ingest.parse_bill_meta("randomBill.csv")
        self.assertEqual(bill_id, "randomBill")
        self.assertIsNone(settlement)

    def test_ninja_bill_meta_from_filename(self):
        bill_id, settlement = ingest.parse_nv_meta("NV_SOA_20260701_20260709.xlsx")
        self.assertEqual(bill_id, "NVSOA-20260701-20260709")
        self.assertEqual(settlement, "2026-07-09")   # tarikh terakhir = settlement

    def test_yyyymmdd_helper(self):
        self.assertEqual(ingest._yyyymmdd("20260618"), "2026-06-18")
        self.assertIsNone(ingest._yyyymmdd("bukan tarikh"))

    def test_chip_stmt_id_from_filename(self):
        self.assertEqual(ingest._chip_stmt_id("chipStatement2026-07-16.xlsx"),
                         "CHIP-2026-07-16")


# =====================================================================
# 3c. derive_bottles (nama SKU -> paid/free) + siling waras
# =====================================================================
class TestDeriveBottles(unittest.TestCase):
    def test_known_patterns(self):
        self.assertEqual(ingest.derive_bottles("KK-JAQ-4-2"), (4, 2))
        self.assertEqual(ingest.derive_bottles("BULK-TT-1PLUS1"), (1, 1))
        self.assertEqual(ingest.derive_bottles("MYS-JAG2-AGM1"), (2, 1))
        self.assertEqual(ingest.derive_bottles("JAG-MY-2"), (2, 0))

    def test_unknown_pattern_returns_none(self):
        self.assertIsNone(ingest.derive_bottles(""))
        self.assertIsNone(ingest.derive_bottles("PLAINSKU"))

    def test_insane_numbers_rejected(self):
        # "RAYA-2026-1": 2026 bukan kiraan botol, melebihi siling -> None.
        self.assertIsNone(ingest.derive_bottles("RAYA-2026-1"))


# =====================================================================
# 4. Idempotency shape: parse dua kali = struktur sama
# =====================================================================
class TestIdempotencyShape(unittest.TestCase):
    def test_parse_dhl_twice_identical(self):
        data = make_dhl_bytes([(1, "18.06.2026", "TESTREF001", "150.00")])
        a, b = ingest.parse_dhl(data), ingest.parse_dhl(data)
        self.assertEqual(a, b)

    def test_parse_chip_twice_identical(self):
        data = make_chip_bytes([
            {"Type": "purchase", "Reference Nr.": "FIGHTER-TESTORDER1",
             "Amount": "RM 150.00", "Fee": "5.00", "Status": "paid",
             "Paid On": "2026-07-16", "Settled On": "2026-07-17"}])
        a = ingest.parse_chip(data, "chipStatement2026-07-16.xlsx")
        b = ingest.parse_chip(data, "chipStatement2026-07-16.xlsx")
        self.assertEqual(list(a.columns), list(b.columns))
        self.assertTrue(a.equals(b))

    def test_detect_twice_identical(self):
        df = pd.DataFrame(columns=["AWB No.", "COD Amount"])
        self.assertEqual(ingest.detect(df), ingest.detect(df))


# =====================================================================
# 5. CHIP: parser header + set status yang menentukan PREPAID_SUCCESS
#    NOTA: penapisan baris ikut status (purchase + PREPAID_SUCCESS) berlaku dalam
#    ingest_chip() yang perlu conn DB, jadi ia DILANGKAU di sini (bukan murni).
#    Yang boleh diuji murni: (a) parse_chip cari header terbenam, (b) set
#    PREPAID_SUCCESS_STATUS yang memandu penapis itu, (c) parse amaun (RM/kurungan).
# =====================================================================
class TestChipParser(unittest.TestCase):
    def test_parse_chip_finds_buried_header(self):
        data = make_chip_bytes([
            {"Type": "purchase", "Reference Nr.": "FIGHTER-TESTORDER1",
             "Amount": "RM 150.00", "Fee": "5.00", "Status": "paid",
             "Paid On": "2026-07-16", "Settled On": "2026-07-17"}])
        df = ingest.parse_chip(data, "chipStatement2026-07-16.xlsx")
        self.assertIsNotNone(df)
        self.assertIn("Reference Nr.", df.columns)
        self.assertIn("Status", df.columns)
        self.assertEqual(len(df), 1)

    def test_parse_chip_rejects_csv(self):
        self.assertIsNone(ingest.parse_chip(b"whatever", "file.csv"))

    def test_parse_chip_rejects_xlsx_without_reference_header(self):
        data = make_chip_bytes([{"Type": "purchase"}], header_present=False)
        self.assertIsNone(ingest.parse_chip(data, "notChip.xlsx"))

    def test_prepaid_success_status_membership(self):
        # "paid" masuk (duit diterima), "overdue"/"pending"/"refunded" ditolak.
        self.assertIn("paid", db.PREPAID_SUCCESS_STATUS)
        self.assertIn("success", db.PREPAID_SUCCESS_STATUS)
        for bad in ("overdue", "pending", "failed", "refunded", "expired"):
            self.assertNotIn(bad, db.PREPAID_SUCCESS_STATUS)

    def test_chip_amount_parsing_rm_and_parentheses(self):
        self.assertEqual(ingest._num("RM 51.90"), 51.9)
        self.assertEqual(ingest._num("(10.00)"), -10.0)      # kurungan = negatif
        self.assertEqual(ingest._num("1,234.50"), 1234.5)
        self.assertEqual(ingest._num("rosak"), 0.0)          # fallback 0 untuk fee

    def test_amount_or_none_blank_stays_none_not_zero(self):
        # Laluan yang menentukan confirmed: parse gagal -> None (bukan RM0 senyap).
        self.assertIsNone(ingest._amount_or_none(""))
        self.assertIsNone(ingest._amount_or_none("nan"))
        self.assertIsNone(ingest._amount_or_none("rosak"))
        self.assertEqual(ingest._amount_or_none("RM 51.90"), 51.9)


# =====================================================================
# 5b. CHIP de-dup: 2+ baris purchase berjaya untuk order_ref SAMA dalam satu
#     statement mesti digabung SEBELUM upsert (elak PK (gateway, order_ref)
#     kena dua kali: Postgres RAISE, SQLite senyap last-wins).
# =====================================================================
class _CaptureConn:
    """Conn tiruan: rakam params yang dihantar ke execute (tanpa DB sebenar)."""
    def __init__(self):
        self.captured = None

    def execute(self, stmt, params=None):
        self.captured = params

    def commit(self):
        pass


class TestChipDedup(unittest.TestCase):
    def test_dedup_recs_sums_amount_and_fee(self):
        recs = [
            {"order_ref": "DUP1", "amount": 50.0, "fee": 1.0,
             "paid_on": "2026-07-16 09:00:00", "status": "paid",
             "settled_on": None, "source_file": "a", "ingested_at": "t1"},
            {"order_ref": "DUP1", "amount": 30.0, "fee": 2.0,
             "paid_on": "2026-07-16 10:00:00", "status": "paid",
             "settled_on": None, "source_file": "a", "ingested_at": "t2"},
            {"order_ref": "SOLO", "amount": 15.0, "fee": 0.5,
             "paid_on": "2026-07-16 08:00:00", "status": "paid",
             "settled_on": None, "source_file": "a", "ingested_at": "t3"},
        ]
        out = ingest._dedup_chip_recs(recs)
        by = {r["order_ref"]: r for r in out}
        self.assertEqual(len(out), 2)                 # DUP1 digabung jadi satu
        self.assertEqual(by["DUP1"]["amount"], 80.0)  # 50 + 30 (jumlah jujur)
        self.assertEqual(by["DUP1"]["fee"], 3.0)      # 1 + 2
        self.assertEqual(by["DUP1"]["paid_on"], "2026-07-16 10:00:00")  # terkini
        self.assertEqual(by["SOLO"]["amount"], 15.0)

    def test_dedup_recs_none_amount_does_not_poison_sum(self):
        recs = [
            {"order_ref": "X", "amount": None, "fee": 0.0, "paid_on": None,
             "status": "paid", "settled_on": None, "source_file": "a",
             "ingested_at": "t1"},
            {"order_ref": "X", "amount": 40.0, "fee": 0.0, "paid_on": None,
             "status": "paid", "settled_on": None, "source_file": "a",
             "ingested_at": "t2"},
        ]
        out = ingest._dedup_chip_recs(recs)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["amount"], 40.0)   # None tak racun jumlah

    def test_ingest_chip_dedups_same_order_ref(self):
        # End-to-end lewat ingest_chip dengan conn tiruan: dua baris purchase
        # berjaya untuk order_ref sama mesti keluar SATU rekod (amaun dijumlah).
        data = make_chip_bytes([
            {"Type": "purchase", "Reference Nr.": "FIGHTER-DUPORDER",
             "Amount": "RM 100.00", "Fee": "3.00", "Status": "paid",
             "Paid On": "2026-07-16 09:00:00", "Settled On": "2026-07-17"},
            {"Type": "purchase", "Reference Nr.": "FIGHTER-DUPORDER",
             "Amount": "RM 25.00", "Fee": "1.00", "Status": "paid",
             "Paid On": "2026-07-16 11:00:00", "Settled On": "2026-07-17"},
        ])
        df = ingest.parse_chip(data, "chipStatement2026-07-16.xlsx")
        conn = _CaptureConn()
        ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", conn)
        self.assertIsNotNone(conn.captured)
        self.assertEqual(len(conn.captured), 1)                   # de-dup jadi 1
        self.assertEqual(conn.captured[0]["order_ref"], "DUPORDER")
        self.assertEqual(conn.captured[0]["amount"], 125.0)       # 100 + 25


# =====================================================================
# Extra: parse_skus (bentuk normalized untuk order_skus, pure)
# =====================================================================
class TestParseSkus(unittest.TestCase):
    def test_parse_skus_qty_and_merge(self):
        out = db.parse_skus("2x JAG-MY-1, KK-JAQ-1-1, JAG-MY-1")
        as_map = {k: q for k, _, q in out}
        self.assertEqual(as_map["JAG-MY-1"], 3)   # 2x + 1x digabung
        self.assertEqual(as_map["KK-JAQ-1-1"], 1)

    def test_parse_skus_empty(self):
        self.assertEqual(db.parse_skus(""), [])
        self.assertEqual(db.parse_skus(None), [])


# =====================================================================
# 6. FIX B1: ingest_fighter mengisi jejak many-to-many order_uploads.
#    Ini SATU-SATUNYA ujian ber-DB dalam fail ni (selebihnya murni), sebab
#    tingkah laku yang diuji ialah TULISAN DB (rakam pasangan order<->fail) yang
#    jadi teras fix bug B1. Guna SQLite DALAM-INGATAN (tiada rangkaian, tiada
#    fail), jadi ia kekal deterministik dan pantas. Data sintetik sepenuhnya.
# =====================================================================
from sqlalchemy import create_engine, text  # noqa: E402


def _fighter_df(order_ids):
    """DataFrame Fighter minimum untuk ingest_fighter (nilai rekaan)."""
    n = len(order_ids)
    return pd.DataFrame({
        ingest.F_ORDER: order_ids,
        ingest.F_DATE: ["2026-06-18"] * n,
        ingest.F_STATUS: ["Completed"] * n,
        ingest.F_SELLER: ["Rekaan Stockist"] * n,
        ingest.F_PAYMENT: ["COD"] * n,
        ingest.F_PROVIDER: ["J&T Express"] * n,
        ingest.F_TRACK: ["1234567890%d" % i for i in range(n)],
        ingest.F_AMOUNT: ["100.00"] * n,
        ingest.F_COMM: ["10.00"] * n,
        ingest.F_SKUS: ["JAG-MY-1"] * n,
        ingest.F_ITEMCOUNT: ["1"] * n,
    })


class TestOrderUploadsTracking(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")   # dalam-ingatan, satu sambungan
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _pairs(self):
        rows = self.conn.execute(
            text("SELECT order_id, source_file FROM order_uploads "
                 "ORDER BY order_id, source_file")).fetchall()
        return [(r[0], r[1]) for r in rows]

    def test_ingest_records_order_file_pairs(self):
        ingest.ingest_fighter(_fighter_df(["O1", "O2"]), "fileA.xlsx", self.conn)
        self.assertEqual(self._pairs(), [("O1", "fileA.xlsx"), ("O2", "fileA.xlsx")])

    def test_overlapping_files_keep_both_vouches(self):
        # fileA sebut O1,O2 ; fileB sebut O2,O3 (O2 bertindih). order_uploads
        # mesti simpan KEDUA vouch O2, walaupun orders.source_file cuma satu.
        ingest.ingest_fighter(_fighter_df(["O1", "O2"]), "fileA.xlsx", self.conn)
        ingest.ingest_fighter(_fighter_df(["O2", "O3"]), "fileB.xlsx", self.conn)
        self.assertEqual(self._pairs(), [
            ("O1", "fileA.xlsx"), ("O2", "fileA.xlsx"),
            ("O2", "fileB.xlsx"), ("O3", "fileB.xlsx")])
        # orders.source_file = penulis TERAKHIR (last-writer-wins) = fileB.
        sf = self.conn.execute(
            text("SELECT source_file FROM orders WHERE order_id = 'O2'")).scalar()
        self.assertEqual(sf, "fileB.xlsx")

    def test_reingest_same_file_idempotent(self):
        ingest.ingest_fighter(_fighter_df(["O1", "O2"]), "fileA.xlsx", self.conn)
        ingest.ingest_fighter(_fighter_df(["O1", "O2"]), "fileA.xlsx", self.conn)
        # Re-upload fail sama TAK gandakan pasangan (PK order_id, source_file).
        self.assertEqual(self._pairs(), [("O1", "fileA.xlsx"), ("O2", "fileA.xlsx")])


# =====================================================================
# 7. Kuarantin bil bertindih (isu D3, PK awb global). AWB sama dari BIL BERBEZA
#    tak boleh timpa senyap; ia diparkir ke bill_line_conflicts. Guna SQLite
#    dalam-ingatan (deterministik, tiada rangkaian). Data sintetik sepenuhnya.
# =====================================================================
def _jnt_df(rows):
    """rows = senarai (awb, cod, fee). DataFrame bil J&T minimum (nilai rekaan)."""
    return pd.DataFrame({
        ingest.J_AWB: [r[0] for r in rows],
        ingest.J_COD: [r[1] for r in rows],
        ingest.J_FEE: [r[2] for r in rows],
        ingest.J_DELIVERED: ["2026-06-18"] * len(rows),
        ingest.J_PICKUP: ["2026-06-17"] * len(rows),
    })


class TestBillLineConflicts(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _lines(self):
        return self.conn.execute(text(
            "SELECT awb, bill_id, cod_amount FROM cod_bill_lines "
            "ORDER BY awb")).fetchall()

    def _conflicts(self):
        return self.conn.execute(text(
            "SELECT awb, bill_id_new, bill_id_existing, cod_new, cod_existing "
            "FROM bill_line_conflicts ORDER BY awb, bill_id_new")).fetchall()

    def test_reupload_same_bill_no_quarantine(self):
        # (i) AWB sama + bill_id SAMA = re-upload bil sama, idempotent, TIADA konflik.
        df = _jnt_df([("1234567890", "100.00", "5.00")])
        ingest.ingest_jnt(df, "JTMYAAA-20260618.csv", self.conn)
        ingest.ingest_jnt(df, "JTMYAAA-20260618.csv", self.conn)
        self.assertEqual(len(self._conflicts()), 0)
        lines = self._lines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][1], "JTMYAAA")          # bill_id kekal
        self.assertEqual(lines[0][2], 100.0)              # cod kekal

    def test_same_awb_different_bill_quarantined_and_idempotent(self):
        # (ii) AWB sama dari bil BERBEZA = baris lama KEKAL + 1 baris kuarantin.
        ingest.ingest_jnt(_jnt_df([("1234567890", "100.00", "5.00")]),
                          "JTMYAAA-20260618.csv", self.conn)
        ingest.ingest_jnt(_jnt_df([("1234567890", "200.00", "7.00")]),
                          "JTMYBBB-20260619.csv", self.conn)
        # Baris asal TAK ditimpa (bill_id + cod kekal billA).
        lines = self._lines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][1], "JTMYAAA")
        self.assertEqual(lines[0][2], 100.0)
        # Tepat satu baris kuarantin dengan kedua bil + amaun untuk banding.
        conf = self._conflicts()
        self.assertEqual(len(conf), 1)
        self.assertEqual(conf[0][0], "1234567890")        # awb
        self.assertEqual(conf[0][1], "JTMYBBB")           # bill_id_new
        self.assertEqual(conf[0][2], "JTMYAAA")           # bill_id_existing
        self.assertEqual(conf[0][3], 200.0)               # cod_new
        self.assertEqual(conf[0][4], 100.0)               # cod_existing
        # Re-upload fail konflik SAMA tak gandakan baris kuarantin (PK awb+new).
        ingest.ingest_jnt(_jnt_df([("1234567890", "200.00", "7.00")]),
                          "JTMYBBB-20260619.csv", self.conn)
        self.assertEqual(len(self._conflicts()), 1)
        self.assertEqual(ingest.conflicts_count(self.conn, "JTMYBBB-20260619.csv"), 1)

    def test_non_conflicting_awbs_ingest_normally(self):
        # AWB baru (tiada dalam DB) tak diparkir; masuk cod_bill_lines biasa.
        ingest.ingest_jnt(_jnt_df([("1111111111", "50.00", "2.00")]),
                          "JTMYAAA-20260618.csv", self.conn)
        ingest.ingest_jnt(_jnt_df([("2222222222", "60.00", "3.00")]),
                          "JTMYBBB-20260619.csv", self.conn)
        self.assertEqual(len(self._conflicts()), 0)
        self.assertEqual(len(self._lines()), 2)


# =====================================================================
# 8. Jejak SENYAP perubahan harga order (Feature 2). Order SEDIA ADA yang datang
#    semula dengan selling_price BERBEZA -> 1 app_events (action=price_change).
#    Status berubah sahaja (harga sama) -> 0 log. Order baru -> 0 log.
# =====================================================================
def _fighter_priced(order_id, price, status="Completed", tracking="1234567890"):
    return pd.DataFrame({
        ingest.F_ORDER: [order_id],
        ingest.F_DATE: ["2026-06-18"],
        ingest.F_STATUS: [status],
        ingest.F_SELLER: ["Rekaan Stockist"],
        ingest.F_PAYMENT: ["COD"],
        ingest.F_PROVIDER: ["J&T Express"],
        ingest.F_TRACK: [tracking],
        ingest.F_AMOUNT: [price],
        ingest.F_COMM: ["10.00"],
        ingest.F_SKUS: ["JAG-MY-1"],
        ingest.F_ITEMCOUNT: ["1"],
    })


class TestPriceChangeLog(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _events(self):
        return self.conn.execute(text(
            "SELECT action, detail FROM app_events ORDER BY ts")).fetchall()

    def test_new_order_logs_nothing(self):
        ingest.ingest_fighter(_fighter_priced("O1", "100.00"), "f1.xlsx", self.conn)
        self.assertEqual(len(self._events()), 0)

    def test_price_change_logs_one(self):
        ingest.ingest_fighter(_fighter_priced("O1", "100.00"), "f1.xlsx", self.conn)
        ingest.ingest_fighter(_fighter_priced("O1", "150.00"), "f2.xlsx", self.conn)
        evs = self._events()
        self.assertEqual(len(evs), 1)
        self.assertEqual(evs[0][0], "price_change")
        self.assertIn("O1", evs[0][1])
        self.assertIn("100.00", evs[0][1])
        self.assertIn("150.00", evs[0][1])

    def test_status_change_only_logs_nothing(self):
        # Harga SAMA, status berubah (Completed -> Returned) = bukan duit = senyap.
        ingest.ingest_fighter(_fighter_priced("O1", "100.00", status="Completed"),
                              "f1.xlsx", self.conn)
        ingest.ingest_fighter(_fighter_priced("O1", "100.00", status="Returned"),
                              "f2.xlsx", self.conn)
        self.assertEqual(len(self._events()), 0)

    def test_reupload_same_price_logs_nothing(self):
        ingest.ingest_fighter(_fighter_priced("O1", "100.00"), "f1.xlsx", self.conn)
        ingest.ingest_fighter(_fighter_priced("O1", "100.00"), "f1.xlsx", self.conn)
        self.assertEqual(len(self._events()), 0)


# =====================================================================
# 9. Parser DHL Payment Advice PDF. Team finance boleh upload advice dalam PDF
#    (bukan lagi .xls kembar sahaja). parse_dhl_pdf mesti keluarkan data
#    IDENTIK dengan parse_dhl atas fail .xls kembar bil yang sama.
#
#    Ujian helper murni (bawah) guna nilai rekaan, jadi kekal data-safe + jalan
#    di mana mana. Ujian banding-kembar guna fail SAMPEL SEBENAR (gitignored,
#    data/sampel/dhl/) , dilangkau automatik kalau sampel tiada (cth CI public),
#    jadi suite kekal hijau tanpa membocor data ke repo.
# =====================================================================
_SAMPLE_DHL = os.path.abspath(
    os.path.join(ENGINE_DIR, "..", "..", "..", "data", "sampel", "dhl"))
_PDF_TWIN = os.path.join(_SAMPLE_DHL, "Payment_Advice_No_84780324.pdf")
_XLS_TWIN = os.path.join(_SAMPLE_DHL, "Payment_Advice_No_84780324.xls")
_PDF_SOLO = os.path.join(_SAMPLE_DHL, "Payment_Advice_No_84728719.pdf")


def _dhl_normalize(parsed):
    """Tarik medan yang ingest_dhl guna (cara SAMA dengan ingest_dhl), tanpa DB.
    Pulang (bill_id, settlement, DataFrame[awb, cod, deliv]) untuk banding dua
    parser (xls vs pdf) hujung-ke-hujung tanpa menyentuh ingest_dhl."""
    meta, header, rows = parsed["meta"], parsed["header"], parsed["rows"]
    bill_id = meta.get("Payment Reference")
    settlement = ingest._yyyymmdd(meta.get("Payment Date"))
    idx = {name: i for i, name in enumerate(header or [])}

    def col(r, name):
        i = idx.get(name)
        return r[i] if i is not None and i < len(r) else None

    df = pd.DataFrame({
        "ref": [str(col(r, ingest.D_REF) or "").lstrip("'") for r in rows],
        "cod": [col(r, ingest.D_COD) for r in rows],
        "deliv": [col(r, ingest.D_DELIVERED) for r in rows],
    })
    df = df[df["ref"].astype(str).str.strip() != ""]
    out = pd.DataFrame({
        "awb": db.norm_trk(df["ref"]),
        "cod": db.to_num(df["cod"]),
        "deliv": ingest.iso(
            pd.to_datetime(df["deliv"], format="%d.%m.%Y", errors="coerce")),
    }).reset_index(drop=True)
    return bill_id, settlement, out


class TestDhlPdfHelpers(unittest.TestCase):
    def test_ddmmyyyy_to_yyyymmdd(self):
        self.assertEqual(ingest._ddmmyyyy_to_yyyymmdd("08.06.2026"), "20260608")
        self.assertEqual(ingest._ddmmyyyy_to_yyyymmdd("02.01.2026"), "20260102")
        self.assertIsNone(ingest._ddmmyyyy_to_yyyymmdd("bukan tarikh"))
        self.assertIsNone(ingest._ddmmyyyy_to_yyyymmdd(""))

    def test_pdf_cell_takes_first_line_and_strips(self):
        # Nama consignee/parcel id bungkus ke baris bawah + garis pemisah '___'
        # tercantum pada baris akhir , kita ambil baris PERTAMA sahaja.
        self.assertEqual(ingest._pdf_cell("MYHTB5766471\n________________"),
                         "MYHTB5766471")
        self.assertEqual(ingest._pdf_cell("  397.00 \n____"), "397.00")
        self.assertEqual(ingest._pdf_cell(None), "")

    def test_parse_dhl_pdf_rejects_non_pdf_bytes(self):
        self.assertIsNone(ingest.parse_dhl_pdf(b"just,a,plain,csv\n1,2,3"))
        self.assertIsNone(ingest.parse_dhl_pdf(b""))

    def test_ingest_bytes_pdf_non_dhl_returns_none_without_db(self):
        # Bytes bermula %PDF tapi rosak (bukan advice DHL) , ingest_bytes mesti
        # pulang (None, 0) TANPA sentuh DB (tak jatuh ke _load_df yang crash).
        kind, n = ingest.ingest_bytes(b"%PDF-1.4 rosak bukan pdf betul",
                                      "mystery.pdf", None)
        self.assertIsNone(kind)
        self.assertEqual(n, 0)


@unittest.skipUnless(os.path.exists(_PDF_TWIN) and os.path.exists(_XLS_TWIN),
                     "sampel DHL kembar (gitignored) tiada, langkau banding")
class TestDhlPdfMatchesXlsTwin(unittest.TestCase):
    def test_pdf_output_identical_to_xls_twin(self):
        with open(_XLS_TWIN, "rb") as fh:
            xls = fh.read()
        with open(_PDF_TWIN, "rb") as fh:
            pdf = fh.read()
        parsed_xls = ingest.parse_dhl(xls)
        parsed_pdf = ingest.parse_dhl_pdf(pdf)
        self.assertIsNotNone(parsed_xls, "parse_dhl gagal atas .xls kembar")
        self.assertIsNotNone(parsed_pdf, "parse_dhl_pdf gagal atas .pdf kembar")

        b_xls, s_xls, df_xls = _dhl_normalize(parsed_xls)
        b_pdf, s_pdf, df_pdf = _dhl_normalize(parsed_pdf)

        self.assertEqual(b_pdf, b_xls)          # bill_id (Payment Reference) sama
        self.assertEqual(s_pdf, s_xls)          # settlement date sama
        self.assertEqual(len(df_pdf), len(df_xls))
        self.assertTrue(df_pdf.equals(df_xls),  # awb + cod + deliv baris demi baris
                        "baris PDF tak identik dengan .xls kembar:\n"
                        "PDF:\n%s\nXLS:\n%s" % (df_pdf, df_xls))


@unittest.skipUnless(os.path.exists(_PDF_SOLO),
                     "sampel DHL kedua (gitignored) tiada, langkau sanity")
class TestDhlPdfSecondSample(unittest.TestCase):
    def test_second_sample_parses_clean(self):
        with open(_PDF_SOLO, "rb") as fh:
            pdf = fh.read()
        parsed = ingest.parse_dhl_pdf(pdf)
        self.assertIsNotNone(parsed)
        bill_id, settlement, df = _dhl_normalize(parsed)
        self.assertEqual(bill_id, "84728719")
        self.assertEqual(settlement, "2026-01-02")
        self.assertEqual(len(df), 16)                      # 16 baris item
        self.assertAlmostEqual(df["cod"].sum(), 3162.00, places=2)  # = Sum Total
        self.assertTrue(df["awb"].str.startswith("MYHTB").all())
        self.assertFalse(df["deliv"].isna().any())         # semua tarikh sah


# =====================================================================
# 10. Parser J&T COD Statement PDF. Team finance boleh upload bil J&T dalam PDF
#     (bukan Excel sahaja). Output diselaraskan ke bentuk bil J&T Excel supaya
#     ingest_jnt guna semula. Fee = Transaction Fee + SST (positif, sama takrif
#     "Total Processing Fee" Excel). Nilai kurungan "(3.27)" = tolakan.
#
#     Kebanyakan ujian TULEN atas teks sintetik (data-safe, jalan di mana mana).
#     Ujian sampel guna fail SEBENAR (gitignored) , dilangkau kalau tiada.
# =====================================================================
_SAMPLE_JNT = os.path.abspath(
    os.path.join(ENGINE_DIR, "..", "..", "..", "data", "sampel", "jnt"))
_JNT_PDF = os.path.join(
    _SAMPLE_JNT, "2026-07-JTMY031691-DICCI IMPACT SDN. BHD.-0653.pdf")


def _jnt_stmt_text(rows, grand, *, date="2026-07-22", signature=True):
    """Jana teks COD Statement J&T sintetik (bentuk sama extract_text pdfplumber).
    `rows` = senarai (awb, deliv, cod, txn, sst, net) STRING (txn/sst berkurungan).
    `grand` = (cod, txn, sst, net) STRING."""
    head = "J&T EXPRESS (MALAYSIA) SDN BHD" if signature else "SOME COURIER"
    lines = [
        head, "COD Statement", "Date :%s" % date,
        "GRAND TOTAL %s %s %s %s" % grand,
        "DETAIL DAILY TRANSACTION LIST (DOMESTIC)",
        "No AWB No. Delivery Date COD (RM) Transaction Fee (RM) SST (RM) Net Amount (RM)",
    ]
    for i, (awb, deliv, cod, txn, sst, net) in enumerate(rows, 1):
        lines.append("%d %s %s %s %s %s %s" % (i, awb, deliv, cod, txn, sst, net))
    return "\n".join(lines)


# Dua baris rekaan; net = cod - (txn + sst). Grand = jumlah.
_JNT_GOOD_ROWS = [
    ("632111663453", "2026-07-21 22:28:06", "297.00", "(3.27)", "(0.20)", "293.53"),
    ("632118893604", "2026-07-21 14:52:52", "180.00", "(2.00)", "(0.12)", "177.88"),
]
_JNT_GOOD_GRAND = ("477.00", "5.27", "0.32", "471.41")


class TestJntPdfParser(unittest.TestCase):
    def test_good_text_shape_and_rows(self):
        df, settlement = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        self.assertEqual(len(df), 2)
        self.assertEqual(list(df[ingest.J_AWB]), ["632111663453", "632118893604"])
        self.assertEqual(settlement, "2026-07-22")

    def test_fee_is_txn_plus_sst_positive(self):
        # Fee disimpan POSITIF = |txn| + |sst| (selaras "Total Processing Fee").
        df, _ = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        self.assertEqual(list(df[ingest.J_FEE]), [3.47, 2.12])  # 3.27+0.20, 2.00+0.12

    def test_parentheses_are_deductions_net_consistent(self):
        # Sahkan tanda dijaga: cod - fee = net statement (kurungan = tolakan).
        df, _ = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        for i, (_, _, cod, _, _, net) in enumerate(_JNT_GOOD_ROWS):
            self.assertAlmostEqual(
                float(cod) - df[ingest.J_FEE].iloc[i], float(net), places=2)

    def test_pickup_date_absent(self):
        df, _ = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        self.assertTrue(df[ingest.J_PICKUP].isna().all())

    def test_mismatch_grand_total_raises(self):
        bad_grand = ("999.00", "5.27", "0.32", "471.41")
        with self.assertRaises(ValueError):
            ingest._jnt_parse_text(_jnt_stmt_text(_JNT_GOOD_ROWS, bad_grand))

    def test_missing_grand_total_raises(self):
        txt = "\n".join(
            l for l in _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND).splitlines()
            if not l.startswith("GRAND TOTAL"))
        with self.assertRaises(ValueError):
            ingest._jnt_parse_text(txt)

    def test_non_jnt_text_returns_none(self):
        # Teks tanpa tandatangan J&T (cth PDF DHL) = bukan bil J&T, langkau.
        self.assertIsNone(ingest._jnt_parse_text("DHL Payment Advice bla bla"))
        self.assertIsNone(ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND, signature=False)))

    def test_parse_jnt_pdf_rejects_non_pdf_bytes(self):
        self.assertIsNone(ingest.parse_jnt_pdf(b"plain,text,not,pdf"))


class TestJntPdfDbIdempotent(unittest.TestCase):
    """Kesahihan idempotency + silang-format guna SQLite dalam-ingatan (data
    sintetik). Fail J&T PDF dan Excel bil SAMA tak boleh double count / tak
    boleh jadi konflik palsu (bill_id dari nama fail, sama dua dua laluan)."""
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _counts(self):
        lines = self.conn.execute(
            text("SELECT COUNT(*) FROM cod_bill_lines")).scalar()
        conf = self.conn.execute(
            text("SELECT COUNT(*) FROM bill_line_conflicts")).scalar()
        return lines, conf

    def test_pdf_reingest_idempotent(self):
        df, s = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        fn = "2026-07-JTMY099999-x.pdf"
        ingest.ingest_jnt(df, fn, self.conn, settlement_override=s)
        ingest.ingest_jnt(df, fn, self.conn, settlement_override=s)
        self.assertEqual(self._counts(), (2, 0))   # 2 baris, tiada dua kali

    def test_cross_format_same_bill_no_double_count(self):
        # Excel dulu (bill_id JTMY099999 dari nama fail), pastu PDF bil SAMA
        # (awb sama, bill_id sama) , 2 baris kekal, TIADA konflik palsu.
        xdf = pd.DataFrame({
            ingest.J_AWB: ["632111663453", "632118893604"],
            ingest.J_COD: [297.0, 180.0],
            ingest.J_FEE: [3.47, 2.12],
            ingest.J_DELIVERED: ["2026-07-21 22:28:06", "2026-07-21 14:52:52"],
            ingest.J_PICKUP: [None, None],
        })
        ingest.ingest_jnt(xdf, "JTMY099999-excel.xlsx", self.conn)
        df, s = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        ingest.ingest_jnt(df, "2026-07-JTMY099999-x.pdf", self.conn,
                          settlement_override=s)
        self.assertEqual(self._counts(), (2, 0))   # no double, no false conflict


@unittest.skipUnless(os.path.exists(_JNT_PDF),
                     "sampel J&T PDF (gitignored) tiada, langkau")
class TestJntPdfSample(unittest.TestCase):
    def test_real_sample_parses_and_tallies(self):
        with open(_JNT_PDF, "rb") as fh:
            data = fh.read()
        out = ingest.parse_jnt_pdf(data)
        self.assertIsNotNone(out)
        df, settlement = out
        self.assertEqual(len(df), 19)                       # 19 baris detail
        self.assertEqual(settlement, "2026-07-22")
        self.assertAlmostEqual(df[ingest.J_COD].sum(), 4037.00, places=2)  # = GRAND
        self.assertAlmostEqual(df[ingest.J_FEE].sum(), 48.00, places=2)    # txn+SST
        self.assertTrue(df[ingest.J_AWB].str.isdigit().all())
        # bill_id ikut laluan Excel (parse_bill_meta nama fail) untuk idempotency.
        bill_id, _ = ingest.parse_bill_meta(os.path.basename(_JNT_PDF))
        self.assertEqual(bill_id, "JTMY031691")

    def test_real_sample_ingests_idempotent(self):
        with open(_JNT_PDF, "rb") as fh:
            data = fh.read()
        eng = create_engine("sqlite://")
        conn = eng.connect()
        db.init_db(conn)
        try:
            k1, n1 = ingest.ingest_bytes(data, os.path.basename(_JNT_PDF), conn)
            ingest.ingest_bytes(data, os.path.basename(_JNT_PDF), conn)  # re-upload
            self.assertEqual((k1, n1), ("jnt", 19))
            lines = conn.execute(
                text("SELECT COUNT(*), ROUND(SUM(cod_amount),2) "
                     "FROM cod_bill_lines")).fetchone()
            self.assertEqual(lines[0], 19)              # tiada double count
            self.assertAlmostEqual(lines[1], 4037.00, places=2)
            conf = conn.execute(
                text("SELECT COUNT(*) FROM bill_line_conflicts")).scalar()
            self.assertEqual(conf, 0)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
