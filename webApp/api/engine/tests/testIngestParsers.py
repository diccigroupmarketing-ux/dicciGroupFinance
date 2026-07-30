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
# 3b. Parser bill_meta end-to-end (nama fail -> akaun/bill_id + tarikh ISO)
# =====================================================================
class TestBillMeta(unittest.TestCase):
    def test_jnt_meta_from_filename(self):
        # regex akaun (JTMY\w+) tamak (\w termasuk underscore) -> token mesti
        # ditamatkan aksara bukan-word (dash). settlement dari \d{8} PERTAMA, jadi
        # akaun tak boleh kandung larian 8-digit sendiri (nanti tersalah tarikh).
        account, settlement = ingest.parse_jnt_meta("JTMYABC123-20260618.csv")
        self.assertEqual(account, "JTMYABC123")
        self.assertEqual(settlement, "2026-06-18")

    def test_jnt_meta_no_date_fallback(self):
        account, settlement = ingest.parse_jnt_meta("randomBill.csv")
        self.assertEqual(account, "randomBill")
        self.assertIsNone(settlement)

    def test_jnt_meta_real_vendor_filenames(self):
        # Dua konvensyen nama fail vendor SEBENAR. Kedua duanya bawa token akaun
        # yang SAMA , bukti nama fail sahaja tak boleh jadi identiti bil.
        xls = "COD账单-明细列表导出 JTMY031691 20260611184046.xlsx"
        pdf = "2026-07-JTMY031691-DICCI IMPACT SDN. BHD.-0653.pdf"
        self.assertEqual(ingest.parse_jnt_meta(xls), ("JTMY031691", "2026-06-11"))
        self.assertEqual(ingest.parse_jnt_meta(pdf), ("JTMY031691", None))

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
    """Conn tiruan: rakam params yang dihantar ke execute (tanpa DB sebenar).

    ingest_chip panggil execute DUA kali sejak fix F05 (upsert bayaran + rekod
    jejak vouch prepaid_uploads), jadi kita simpan SEMUA panggilan dan pilih ikut
    penyata. `captured` kekal bermaksud payload PREPAID_UPSERT (macam dulu)."""
    def __init__(self):
        self.calls = []

    def execute(self, stmt, params=None):
        self.calls.append((stmt, params))

    def _params_for(self, stmt):
        for s, params in self.calls:
            if s is stmt:
                return params
        return None

    @property
    def captured(self):
        return self._params_for(ingest.PREPAID_UPSERT)

    @property
    def vouched(self):
        return self._params_for(ingest.PREPAID_UPLOADS_UPSERT)

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
        # Jejak vouch (fix F05) ikut set yang SAMA selepas de-dup: satu pasangan
        # (gateway, order_ref, fail), bukan satu per baris mentah.
        self.assertEqual(len(conn.vouched), 1)
        self.assertEqual(conn.vouched[0],
                         {"gateway": "chip", "order_ref": "DUPORDER",
                          "source_file": "chipStatement2026-07-16.xlsx",
                          "ingested_at": conn.captured[0]["ingested_at"]})


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
# 6b. FIX F05: ingest_wallet + ingest_chip mengisi jejak many-to-many
#     wallet_uploads / prepaid_uploads (corak SAMA macam order_uploads di atas).
#     Tanpa jejak ni, padam satu fail wallet/CHIP boleh buang baris duit yang
#     fail LAIN masih tuntut (source_file cuma muat satu fail). Guna SQLite
#     dalam-ingatan; data sintetik sepenuhnya. `_wallet_df` / `_chip_df`
#     ditakrif lebih bawah dalam fail ni (dipanggil masa runtime, bukan import).
# =====================================================================
class TestWalletPrepaidUploadsTracking(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _wallet_pairs(self):
        rows = self.conn.execute(
            text("SELECT txn_id, source_file FROM wallet_uploads "
                 "ORDER BY txn_id, source_file")).fetchall()
        return [(r[0], r[1]) for r in rows]

    def _prepaid_pairs(self):
        rows = self.conn.execute(
            text("SELECT gateway, order_ref, source_file FROM prepaid_uploads "
                 "ORDER BY order_ref, source_file")).fetchall()
        return [(r[0], r[1], r[2]) for r in rows]

    # ---- Wallet ----
    def test_wallet_records_txn_file_pairs(self):
        ingest.ingest_wallet(_wallet_df([("TXN1", "10.00"), ("TXN2", "20.00")]),
                             "walletA.xlsx", self.conn)
        self.assertEqual(self._wallet_pairs(),
                         [("TXN1", "walletA.xlsx"), ("TXN2", "walletA.xlsx")])

    def test_wallet_overlapping_files_keep_both_vouches(self):
        # walletA sebut TXN1,TXN2 ; walletB sebut TXN2,TXN3 (TXN2 bertindih).
        ingest.ingest_wallet(_wallet_df([("TXN1", "10.00"), ("TXN2", "20.00")]),
                             "walletA.xlsx", self.conn)
        ingest.ingest_wallet(_wallet_df([("TXN2", "20.00"), ("TXN3", "30.00")]),
                             "walletB.xlsx", self.conn)
        self.assertEqual(self._wallet_pairs(), [
            ("TXN1", "walletA.xlsx"), ("TXN2", "walletA.xlsx"),
            ("TXN2", "walletB.xlsx"), ("TXN3", "walletB.xlsx")])
        # wallet_txns.source_file = penulis TERAKHIR (last-writer-wins) = walletB,
        # iaitu sebab kenapa jejak berasingan ni perlu.
        sf = self.conn.execute(
            text("SELECT source_file FROM wallet_txns WHERE txn_id = 'TXN2'")).scalar()
        self.assertEqual(sf, "walletB.xlsx")

    def test_wallet_reingest_same_file_idempotent(self):
        df = _wallet_df([("TXN1", "10.00"), ("TXN2", "20.00")])
        ingest.ingest_wallet(df, "walletA.xlsx", self.conn)
        ingest.ingest_wallet(df, "walletA.xlsx", self.conn)
        self.assertEqual(self._wallet_pairs(),
                         [("TXN1", "walletA.xlsx"), ("TXN2", "walletA.xlsx")])

    # ---- Prepaid (CHIP) ----
    def _chip(self, refs, source_file):
        return ingest.ingest_chip(
            _chip_df([{"Reference Nr.": r} for r in refs]), source_file, self.conn)

    def test_prepaid_records_ref_file_pairs(self):
        self._chip(["REF1", "REF2"], "chipA.xlsx")
        self.assertEqual(self._prepaid_pairs(), [
            ("chip", "REF1", "chipA.xlsx"), ("chip", "REF2", "chipA.xlsx")])

    def test_prepaid_overlapping_statements_keep_both_vouches(self):
        # Dua statement CHIP dengan julat bertindih: REF2 disebut kedua duanya.
        self._chip(["REF1", "REF2"], "chipA.xlsx")
        self._chip(["REF2", "REF3"], "chipB.xlsx")
        self.assertEqual(self._prepaid_pairs(), [
            ("chip", "REF1", "chipA.xlsx"), ("chip", "REF2", "chipA.xlsx"),
            ("chip", "REF2", "chipB.xlsx"), ("chip", "REF3", "chipB.xlsx")])
        sf = self.conn.execute(text(
            "SELECT source_file FROM prepaid_payments WHERE order_ref = 'REF2'")).scalar()
        self.assertEqual(sf, "chipB.xlsx")

    def test_prepaid_reingest_same_file_idempotent(self):
        self._chip(["REF1", "REF2"], "chipA.xlsx")
        self._chip(["REF1", "REF2"], "chipA.xlsx")
        self.assertEqual(self._prepaid_pairs(), [
            ("chip", "REF1", "chipA.xlsx"), ("chip", "REF2", "chipA.xlsx")])

    def test_prepaid_duplicate_ref_in_one_file_vouched_once(self):
        # Dua baris purchase order_ref SAMA dalam satu statement digabung
        # (_dedup_chip_recs), jadi jejak vouch pun mesti SATU pasangan sahaja.
        self._chip(["REF1", "REF1"], "chipA.xlsx")
        self.assertEqual(self._prepaid_pairs(), [("chip", "REF1", "chipA.xlsx")])


# =====================================================================
# 7. Kuarantin bil bertindih (isu D3, PK awb global). AWB sama dari BIL BERBEZA
#    tak boleh timpa senyap; ia diparkir ke bill_line_conflicts. Guna SQLite
#    dalam-ingatan (deterministik, tiada rangkaian). Data sintetik sepenuhnya.
# =====================================================================
def _jnt_df(rows, delivered="2026-06-18"):
    """rows = senarai (awb, cod, fee). DataFrame bil J&T minimum (nilai rekaan).
    `delivered` = tarikh penghantaran semua baris (ia yang tentukan bill_id)."""
    return pd.DataFrame({
        ingest.J_AWB: [r[0] for r in rows],
        ingest.J_COD: [r[1] for r in rows],
        ingest.J_FEE: [r[2] for r in rows],
        ingest.J_DELIVERED: [delivered] * len(rows),
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
        self.assertEqual(lines[0][1], "JTMYAAA-20260618")  # bill_id kekal
        self.assertEqual(lines[0][2], 100.0)               # cod kekal

    def test_same_awb_different_bill_quarantined_and_idempotent(self):
        # (ii) AWB sama dari bil BERBEZA = baris lama KEKAL + 1 baris kuarantin.
        # AKAUN SAMA, hari penghantaran BERBEZA = dua statement harian berbeza,
        # iaitu kes double-bill sebenar. Dengan derivasi LAMA (bill_id = akaun
        # dari nama fail) kedua duanya jadi "JTMYAAA" dan kuarantin tak pernah
        # menyala , itu bug yang ujian ni jaga.
        ingest.ingest_jnt(_jnt_df([("1234567890", "100.00", "5.00")],
                                  delivered="2026-06-18"),
                          "JTMYAAA-20260618.csv", self.conn)
        ingest.ingest_jnt(_jnt_df([("1234567890", "200.00", "7.00")],
                                  delivered="2026-06-19"),
                          "JTMYAAA-20260619.csv", self.conn)
        # Baris asal TAK ditimpa (bill_id + cod kekal bil 18 hb).
        lines = self._lines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][1], "JTMYAAA-20260618")
        self.assertEqual(lines[0][2], 100.0)
        # Tepat satu baris kuarantin dengan kedua bil + amaun untuk banding.
        conf = self._conflicts()
        self.assertEqual(len(conf), 1)
        self.assertEqual(conf[0][0], "1234567890")            # awb
        self.assertEqual(conf[0][1], "JTMYAAA-20260619")      # bill_id_new
        self.assertEqual(conf[0][2], "JTMYAAA-20260618")      # bill_id_existing
        self.assertEqual(conf[0][3], 200.0)                   # cod_new
        self.assertEqual(conf[0][4], 100.0)                   # cod_existing
        # Re-upload fail konflik SAMA tak gandakan baris kuarantin (PK awb+new).
        ingest.ingest_jnt(_jnt_df([("1234567890", "200.00", "7.00")],
                                  delivered="2026-06-19"),
                          "JTMYAAA-20260619.csv", self.conn)
        self.assertEqual(len(self._conflicts()), 1)
        self.assertEqual(ingest.conflicts_count(self.conn, "JTMYAAA-20260619.csv"), 1)

    def test_non_conflicting_awbs_ingest_normally(self):
        # AWB baru (tiada dalam DB) tak diparkir; masuk cod_bill_lines biasa.
        ingest.ingest_jnt(_jnt_df([("1111111111", "50.00", "2.00")]),
                          "JTMYAAA-20260618.csv", self.conn)
        ingest.ingest_jnt(_jnt_df([("2222222222", "60.00", "3.00")],
                                  delivered="2026-06-19"),
                          "JTMYAAA-20260619.csv", self.conn)
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


def _jnt_stmt_text(rows, grand, *, date="2026-07-22", signature=True,
                   account=None):
    """Jana teks COD Statement J&T sintetik (bentuk sama extract_text pdfplumber).
    `rows` = senarai (awb, deliv, cod, txn, sst, net) STRING (txn/sst berkurungan).
    `grand` = (cod, txn, sst, net) STRING.
    `account` = kalau diberi, cetak baris "Account No :..." macam statement betul."""
    head = "J&T EXPRESS (MALAYSIA) SDN BHD" if signature else "SOME COURIER"
    lines = [
        head, "COD Statement", "Date :%s" % date,
        "GRAND TOTAL %s %s %s %s" % grand,
        "DETAIL DAILY TRANSACTION LIST (DOMESTIC)",
        "No AWB No. Delivery Date COD (RM) Transaction Fee (RM) SST (RM) Net Amount (RM)",
    ]
    if account:
        lines.insert(3, "Account No :%s" % account)
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
        df, settlement, account = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        self.assertEqual(len(df), 2)
        self.assertEqual(list(df[ingest.J_AWB]), ["632111663453", "632118893604"])
        self.assertEqual(settlement, "2026-07-22")
        self.assertIsNone(account)          # statement ni tiada baris "Account No :"

    def test_account_no_read_from_statement_body(self):
        # Akaun datang dari KANDUNGAN bila statement mencetaknya (macam fail
        # sebenar), bukan dari nama fail.
        _, _, account = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND, account="JTMY031691"))
        self.assertEqual(account, "JTMY031691")

    def test_fee_is_txn_plus_sst_positive(self):
        # Fee disimpan POSITIF = |txn| + |sst| (selaras "Total Processing Fee").
        df, _, _ = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        self.assertEqual(list(df[ingest.J_FEE]), [3.47, 2.12])  # 3.27+0.20, 2.00+0.12

    def test_parentheses_are_deductions_net_consistent(self):
        # Sahkan tanda dijaga: cod - fee = net statement (kurungan = tolakan).
        df, _, _ = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        for i, (_, _, cod, _, _, net) in enumerate(_JNT_GOOD_ROWS):
            self.assertAlmostEqual(
                float(cod) - df[ingest.J_FEE].iloc[i], float(net), places=2)

    def test_pickup_date_absent(self):
        df, _, _ = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        self.assertTrue(df[ingest.J_PICKUP].isna().all())

    def test_mismatch_grand_total_raises(self):
        # Tolakan kini BERKOD (IngestError) supaya ia jadi mesej mesra + satu
        # baris ingest_rejections, bukan ValueError mentah yang naik jadi
        # "server error" di skrin kerani.
        bad_grand = ("999.00", "5.27", "0.32", "471.41")
        with self.assertRaises(ingest.IngestError) as cm:
            ingest._jnt_parse_text(_jnt_stmt_text(_JNT_GOOD_ROWS, bad_grand))
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)
        self.assertEqual(cm.exception.detected_type, "jnt")
        self.assertIn("999.00", cm.exception.message)   # nombor fail
        self.assertIn("477.00", cm.exception.message)   # nombor yang kita baca

    def test_missing_grand_total_raises(self):
        txt = "\n".join(
            l for l in _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND).splitlines()
            if not l.startswith("GRAND TOTAL"))
        with self.assertRaises(ingest.IngestError) as cm:
            ingest._jnt_parse_text(txt)
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)

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
        df, s, a = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        fn = "2026-07-JTMY099999-x.pdf"
        ingest.ingest_jnt(df, fn, self.conn, settlement_override=s,
                          account_override=a)
        ingest.ingest_jnt(df, fn, self.conn, settlement_override=s,
                          account_override=a)
        self.assertEqual(self._counts(), (2, 0))   # 2 baris, tiada dua kali

    def test_cross_format_same_bill_no_double_count(self):
        # Excel dulu, pastu PDF statement HARI yang sama. Kedua duanya keluar
        # bill_id JTMY099999-20260721 (akaun + hari penghantaran) , 2 baris
        # kekal, TIADA konflik palsu antara format.
        xdf = pd.DataFrame({
            ingest.J_AWB: ["632111663453", "632118893604"],
            ingest.J_COD: [297.0, 180.0],
            ingest.J_FEE: [3.47, 2.12],
            ingest.J_DELIVERED: ["2026-07-21 22:28:06", "2026-07-21 14:52:52"],
            ingest.J_PICKUP: [None, None],
        })
        ingest.ingest_jnt(xdf, "JTMY099999-excel.xlsx", self.conn)
        df, s, a = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        ingest.ingest_jnt(df, "2026-07-JTMY099999-x.pdf", self.conn,
                          settlement_override=s, account_override=a)
        self.assertEqual(self._counts(), (2, 0))   # no double, no false conflict


@unittest.skipUnless(os.path.exists(_JNT_PDF),
                     "sampel J&T PDF (gitignored) tiada, langkau")
class TestJntPdfSample(unittest.TestCase):
    def test_real_sample_parses_and_tallies(self):
        with open(_JNT_PDF, "rb") as fh:
            data = fh.read()
        out = ingest.parse_jnt_pdf(data)
        self.assertIsNotNone(out)
        df, settlement, account = out
        self.assertEqual(len(df), 19)                       # 19 baris detail
        self.assertEqual(settlement, "2026-07-22")
        self.assertAlmostEqual(df[ingest.J_COD].sum(), 4037.00, places=2)  # = GRAND
        self.assertAlmostEqual(df[ingest.J_FEE].sum(), 48.00, places=2)    # txn+SST
        self.assertTrue(df[ingest.J_AWB].str.isdigit().all())
        # Akaun dibaca dari KANDUNGAN statement, dan bill_id = akaun + hari
        # penghantaran. Sampel ni semua barisnya dihantar 2026-07-21 (statement
        # bertarikh 22 hb), jadi ia SATU bil harian.
        self.assertEqual(account, "JTMY031691")
        days = {str(d)[:10] for d in df[ingest.J_DELIVERED]}
        self.assertEqual(days, {"2026-07-21"})
        self.assertEqual(ingest.jnt_bill_id(account, df[ingest.J_DELIVERED].iloc[0]),
                         "JTMY031691-20260721")

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
            # SATU bil harian, id dari kandungan, settlement dari "Date :".
            bills = conn.execute(text(
                "SELECT bill_id, settlement_date, courier FROM cod_bills")).fetchall()
            self.assertEqual(len(bills), 1)
            self.assertEqual(bills[0][0], "JTMY031691-20260721")
            self.assertEqual(bills[0][1], "2026-07-22")
            self.assertEqual(bills[0][2], "J&T Express")
        finally:
            conn.close()


# =====================================================================
# 10b. IDENTITI BIL J&T (bill_id) , akaun + HARI penghantaran.
#      Dulu bill_id = token (JTMY\w+) dari NAMA fail, iaitu nombor AKAUN. Dua
#      dua konvensyen nama fail vendor sebenar bawa token yang sama, jadi SEMUA
#      statement runtuh jadi satu bil: settlement_date bertimpa, satu sahaja
#      bank_deposits boleh ditaip, dan kuarantin double-bill mati. Ujian di sini
#      mengunci peraturan baru + sifat idempotent yang mesti kekal.
# =====================================================================
_JNT_XLS_REAL_NAME = "COD\u8d26\u5355-\u660e\u7ec6\u5217\u8868\u5bfc\u51fa JTMY031691 20260611184046.xlsx"
_JNT_PDF_REAL_NAME = "2026-07-JTMY031691-DICCI IMPACT SDN. BHD.-0653.pdf"


class TestJntBillIdDerivation(unittest.TestCase):
    def test_same_account_different_day_is_different_bill(self):
        # (b) Statement hari/bulan berbeza = bil berbeza. INI yang derivasi lama
        # gagal: kedua duanya jadi "JTMY031691".
        a = ingest.jnt_bill_id("JTMY031691", "2026-06-30 10:00:00")
        b = ingest.jnt_bill_id("JTMY031691", "2026-07-21 22:28:06")
        self.assertEqual(a, "JTMY031691-20260630")
        self.assertEqual(b, "JTMY031691-20260721")
        self.assertNotEqual(a, b)

    def test_bill_id_is_not_just_the_account(self):
        # Penggera anti-regresi: kalau sesiapa pulangkan derivasi lama (nama fail
        # -> akaun sahaja), nilai ni jadi "JTMY031691" dan ujian ni gagal.
        self.assertNotEqual(ingest.jnt_bill_id("JTMY031691", "2026-07-21"),
                            "JTMY031691")

    def test_same_day_same_id_regardless_of_time(self):
        # (a) Idempotent: masa pada baris tak boleh mengubah identiti bil.
        self.assertEqual(ingest.jnt_bill_id("JTMY031691", "2026-07-21 08:00:00"),
                         ingest.jnt_bill_id("JTMY031691", "2026-07-21 23:59:59"))

    def test_undated_row_goes_to_explicit_bucket(self):
        # (d) Tiada tarikh boleh dibaca = bucket bernama, bukan senyap.
        self.assertEqual(ingest.jnt_bill_id("JTMY031691", None),
                         "JTMY031691-UNDATED")
        self.assertEqual(ingest.jnt_bill_id("JTMY031691", ""),
                         "JTMY031691-UNDATED")
        self.assertEqual(ingest.jnt_bill_id("JTMY031691", "bukan tarikh"),
                         "JTMY031691-UNDATED")

    def test_account_prefers_content_then_filename_then_stem(self):
        self.assertEqual(ingest.jnt_account(_JNT_XLS_REAL_NAME), "JTMY031691")
        self.assertEqual(ingest.jnt_account(_JNT_PDF_REAL_NAME), "JTMY031691")
        # Kandungan menang atas nama fail (statement dinamakan semula kerani).
        self.assertEqual(ingest.jnt_account("apa apa.pdf", "JTMY031691"),
                         "JTMY031691")
        # Tiada token langsung = batang nama fail (fail akaun lain tak bercampur).
        self.assertEqual(ingest.jnt_account("bilLain.xlsx"), "bilLain")


class TestJntBillIdInDb(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _bills(self):
        return [r[0] for r in self.conn.execute(text(
            "SELECT bill_id FROM cod_bills ORDER BY bill_id"))]

    def test_one_file_many_days_becomes_many_bills(self):
        # Export XLSX J&T ialah senarai DETAIL merentas julat tarikh, jadi satu
        # fail memang mengandungi banyak bil harian. Ia mesti pecah, bukan runtuh.
        df = pd.concat([
            _jnt_df([("6320000001", "100.00", "2.00")], delivered="2026-05-20"),
            _jnt_df([("6320000002", "180.00", "2.12")], delivered="2026-05-21"),
            _jnt_df([("6320000003", "297.00", "3.47")], delivered="2026-05-21"),
        ], ignore_index=True)
        n = ingest.ingest_jnt(df, _JNT_XLS_REAL_NAME, self.conn)
        self.assertEqual(n, 3)
        self.assertEqual(self._bills(),
                         ["JTMY031691-20260520", "JTMY031691-20260521"])
        # Idempotent: fail SAMA sekali lagi = tiada bil baru, tiada konflik.
        ingest.ingest_jnt(df, _JNT_XLS_REAL_NAME, self.conn)
        self.assertEqual(len(self._bills()), 2)
        self.assertEqual(self.conn.execute(text(
            "SELECT COUNT(*) FROM bill_line_conflicts")).scalar(), 0)

    def test_two_months_do_not_collapse_into_one_bill(self):
        # Dua fail vendor, akaun sama, bulan berbeza. Dulu dua duanya "JTMY031691"
        # dan settlement_date bil pertama ditimpa senyap.
        ingest.ingest_jnt(_jnt_df([("6320000001", "100.00", "2.00")],
                                  delivered="2026-06-30"),
                          "COD bill JTMY031691 20260701090000.xlsx", self.conn)
        ingest.ingest_jnt(_jnt_df([("6320000002", "200.00", "3.00")],
                                  delivered="2026-07-21"),
                          _JNT_PDF_REAL_NAME, self.conn,
                          settlement_override="2026-07-22",
                          account_override="JTMY031691")
        self.assertEqual(self._bills(),
                         ["JTMY031691-20260630", "JTMY031691-20260721"])
        dates = dict(self.conn.execute(text(
            "SELECT bill_id, settlement_date FROM cod_bills")).fetchall())
        # Setiap bil kekal dengan tarikh settlement SENDIRI (tiada bertimpa).
        self.assertEqual(dates["JTMY031691-20260630"], "2026-07-01")
        self.assertEqual(dates["JTMY031691-20260721"], "2026-07-22")

    def test_undated_rows_land_in_undated_bill(self):
        df = _jnt_df([("6320000001", "100.00", "2.00"),
                      ("6320000002", "180.00", "2.12"),
                      ("6320000003", "297.00", "3.47")],
                     delivered="2026-05-20")
        df.loc[2, ingest.J_DELIVERED] = None
        ingest.ingest_jnt(df, _JNT_XLS_REAL_NAME, self.conn)
        self.assertEqual(self._bills(),
                         ["JTMY031691-20260520", "JTMY031691-UNDATED"])


class TestJntCrossFormatSameDay(unittest.TestCase):
    """(c) XLS dan PDF untuk HARI yang sama mesti keluar bill_id SAMA, supaya
    upload dua format tak mencetuskan ribut konflik palsu."""
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_xls_then_pdf_same_day_one_bill_no_conflict(self):
        xls = _jnt_df([("632111663453", "297.00", "3.47")],
                      delivered="2026-07-21 22:28:06")
        ingest.ingest_jnt(xls, _JNT_XLS_REAL_NAME, self.conn)
        pdf_df, s, a = ingest._jnt_parse_text(_jnt_stmt_text(
            [_JNT_GOOD_ROWS[0]], ("297.00", "3.27", "0.20", "293.53"),
            account="JTMY031691"))
        ingest.ingest_jnt(pdf_df, _JNT_PDF_REAL_NAME, self.conn,
                          settlement_override=s, account_override=a)
        bills = self.conn.execute(text(
            "SELECT bill_id, settlement_date FROM cod_bills")).fetchall()
        self.assertEqual(len(bills), 1)
        self.assertEqual(bills[0][0], "JTMY031691-20260721")
        # PDF membetulkan settlement_date bil harian tu (statement > tarikh export).
        self.assertEqual(bills[0][1], "2026-07-22")
        self.assertEqual(self.conn.execute(text(
            "SELECT COUNT(*) FROM cod_bill_lines")).scalar(), 1)
        self.assertEqual(self.conn.execute(text(
            "SELECT COUNT(*) FROM bill_line_conflicts")).scalar(), 0)


# =====================================================================
# 11. Decode DHL TOLERAN + kod sebab jujur (audit /timbang, item 1 & 2).
#     Fail DHL sebenar kadang terpotong 1 byte padding di hujung masa download,
#     decode utf-16 ketat gagal. Pemulihan bedah (potong byte ganjil hujung)
#     mesti selamat (baris data terakhir utuh). Data sintetik = data-safe.
# =====================================================================
class TestDhlTolerantDecode(unittest.TestCase):
    def test_truncated_padding_byte_still_parses(self):
        # Bytes DHL sah + SATU byte tambahan (saiz jadi ganjil, meniru terpotong
        # di padding hujung). Decode ketat penuh gagal; pemulihan bedah (buang 1
        # byte hujung) mesti pulihkan, baris data kekal utuh.
        good = make_dhl_bytes(
            [(1, "18.06.2026", "TESTREF001", "150.00"),
             (2, "19.06.2026", "TESTREF002", "220.50")])
        truncated = good + b"\x00"          # saiz ganjil = simulasi terpotong
        self.assertTrue(len(truncated) % 2 == 1)
        parsed = ingest.parse_dhl(truncated)
        self.assertIsNotNone(parsed)
        self.assertEqual(len(parsed["rows"]), 2)
        idx = {n: i for i, n in enumerate(parsed["header"])}
        self.assertEqual(parsed["rows"][-1][idx["CoD Amount"]], "220.50")

    def test_recognized_dhl_but_no_rows_raises_corrupt(self):
        # Dikenali DHL (tandatangan ada) tapi TIADA baris data = rosak, mesti
        # lempar IngestError(corrupt_known), bukan pulang bil kosong senyap.
        empty = make_dhl_bytes([])          # header sahaja, tiada baris item
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.parse_dhl(empty)
        self.assertEqual(cm.exception.reason, ingest.REASON_CORRUPT_KNOWN)

    def test_non_dhl_still_returns_none_not_raise(self):
        # Bukan DHL langsung (tiada tandatangan) TETAP pulang None (biar pintu
        # lain cuba), BUKAN lempar corrupt.
        self.assertIsNone(ingest.parse_dhl(b"just,a,plain,csv\n1,2,3,4"))


class TestStatusReportRecognizer(unittest.TestCase):
    def test_status_report_signature(self):
        df = pd.DataFrame(columns=["Shipment ID", "Tracking ID", "Last Status",
                                   "Consignee Name", "COD Amount"])
        self.assertTrue(ingest.is_status_report(df))

    def test_plain_table_is_not_status_report(self):
        df = pd.DataFrame(columns=["Foo", "Bar", "Baz"])
        self.assertFalse(ingest.is_status_report(df))

    def test_bill_columns_are_not_status_report(self):
        # Bil sebenar (ada AWB No.) BUKAN laporan status.
        df = pd.DataFrame(columns=["AWB No.", "COD Amount"])
        self.assertFalse(ingest.is_status_report(df))


class TestSafeFingerprint(unittest.TestCase):
    def test_fingerprint_has_only_metadata_no_row_values(self):
        # Header ada nama lajur; baris ada nilai RAHSIA. Cap jari mesti simpan
        # nama lajur SAHAJA, TIADA nilai baris (selamat PII).
        data = make_table_bytes(["Foo", "Bar"], [["SECRETVALUE", "12345"]])
        fp = ingest.safe_fingerprint(data, "mystery.csv", ingest.REASON_UNKNOWN)
        self.assertEqual(fp["reason"], ingest.REASON_UNKNOWN)
        self.assertEqual(fp["extension"], "csv")
        self.assertEqual(fp["size_bytes"], len(data))
        self.assertEqual(len(fp["magic_hex"]), 32)          # 16 byte = 32 hex
        self.assertEqual(len(fp["sha256"]), 64)
        self.assertIn("Foo", fp["columns_json"])
        # HARAM ada nilai baris di mana mana dalam cap jari.
        blob = repr(fp)
        self.assertNotIn("SECRETVALUE", blob)
        self.assertNotIn("12345", blob)


class TestRejectionLogging(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_unknown_file_logs_one_rejection(self):
        data = make_table_bytes(["Foo", "Bar"], [["a", "b"]])
        res = ingest.ingest_bytes(data, "mystery.csv", self.conn)
        self.assertIsNone(res.kind)
        self.assertEqual(res.reason, ingest.REASON_UNKNOWN)
        rows = self.conn.execute(
            text("SELECT reason, extension, columns_json FROM ingest_rejections")
        ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "unknown")
        self.assertEqual(rows[0][1], "csv")
        self.assertIn("Foo", rows[0][2])

    def test_rejection_table_survives_reset(self):
        # ingest_rejections SENGAJA tak masuk reset_db (sejarah tolakan kekal).
        ingest.ingest_bytes(make_table_bytes(["X"], [["y"]]), "m.csv", self.conn)
        db.reset_db(self.conn)
        n = self.conn.execute(
            text("SELECT COUNT(*) FROM ingest_rejections")).scalar()
        self.assertEqual(n, 1)


# =====================================================================
# 12. Ujian sampel SEBENAR (gitignored) untuk dua fail pencetus audit:
#     - CODSupportDoc.xls = bil DHL SAH terpotong 1 byte -> mesti ingest OK.
#     - total_prealert_report.xlsx = laporan status DHL -> mesti not_a_bill.
#     Dilangkau automatik kalau sampel tiada (repo public / CI), TAPI bila ada
#     mesti betul betul JALAN (bukan skip senyap).
# =====================================================================
_SAMPLE_NONBILL = os.path.abspath(
    os.path.join(ENGINE_DIR, "..", "..", "..", "data", "sampel", "nonbill"))
_CODSUPPORT = os.path.join(_SAMPLE_DHL, "0084729585_CODSupportDoc.xls")
_PREALERT = os.path.join(_SAMPLE_NONBILL, "total_prealert_report-2607241112.xlsx")


@unittest.skipUnless(os.path.exists(_CODSUPPORT),
                     "sampel DHL CODSupportDoc (gitignored) tiada, langkau")
class TestCodSupportDocSample(unittest.TestCase):
    def test_truncated_bill_ingests_clean(self):
        with open(_CODSUPPORT, "rb") as fh:
            data = fh.read()
        self.assertTrue(len(data) % 2 == 1, "sampel dijangka saiz ganjil (terpotong)")
        eng = create_engine("sqlite://")
        conn = eng.connect()
        db.init_db(conn)
        try:
            res = ingest.ingest_bytes(data, os.path.basename(_CODSUPPORT), conn)
            self.assertEqual(res.kind, "dhl")
            self.assertGreater(res.rows, 0)
            row = conn.execute(
                text("SELECT COUNT(*), ROUND(SUM(cod_amount),2) FROM cod_bill_lines")
            ).fetchone()
            self.assertEqual(row[0], res.rows)
            self.assertGreater(row[1], 0)          # ada nilai COD sebenar
            # Tiada baris tolakan (fail SAH, cuma terpotong padding).
            nrej = conn.execute(
                text("SELECT COUNT(*) FROM ingest_rejections")).scalar()
            self.assertEqual(nrej, 0)
        finally:
            conn.close()


@unittest.skipUnless(os.path.exists(_PREALERT),
                     "sampel pre-alert (gitignored) tiada, langkau")
class TestPrealertNotABill(unittest.TestCase):
    def test_status_report_recognized_not_a_bill(self):
        with open(_PREALERT, "rb") as fh:
            data = fh.read()
        eng = create_engine("sqlite://")
        conn = eng.connect()
        db.init_db(conn)
        try:
            res = ingest.ingest_bytes(data, os.path.basename(_PREALERT), conn)
            self.assertIsNone(res.kind)
            self.assertEqual(res.reason, ingest.REASON_NOT_A_BILL)
            self.assertEqual(res.detected_type, "delivery_status_report")
            # TIADA data ditulis ke jadual bil/order.
            self.assertEqual(
                conn.execute(text("SELECT COUNT(*) FROM cod_bill_lines")).scalar(), 0)
            self.assertEqual(
                conn.execute(text("SELECT COUNT(*) FROM orders")).scalar(), 0)
            # SATU baris tolakan dilog, sebab not_a_bill.
            rej = conn.execute(
                text("SELECT reason FROM ingest_rejections")).fetchall()
            self.assertEqual(len(rej), 1)
            self.assertEqual(rej[0][0], "not_a_bill")
        finally:
            conn.close()


# =====================================================================
# 15. Guard ingest Fighter (schema + amountGuard). Dua lubang laten yang ditutup:
#     K1 = sel duit berisi teks ("PENDING", "-") jadi RM0 SENYAP,
#     K5 = lajur "Sales Commission"/"Item Count"/"SKUs" HILANG diganti 0/None.
#     Guard mesti tolak fail macam tu dengan sebab berkod, TANPA menulis apa apa,
#     tapi JANGAN sensitif berlebihan: sel kosong tulen + sifar tulen ("0.00")
#     mesti kekal lulus (export Fighter sebenar ada 16% Sales Commission kosong).
#     Semua fixture SINTETIK.
# =====================================================================
_FIGHTER_COLS = {
    ingest.F_ORDER: ["O1", "O2", "O3", "O4"],
    ingest.F_DATE: ["2026-06-18"] * 4,
    ingest.F_STATUS: ["Completed"] * 4,
    ingest.F_SELLER: ["Rekaan Stockist"] * 4,
    ingest.F_PAYMENT: ["COD"] * 4,
    ingest.F_PROVIDER: ["J&T Express"] * 4,
    ingest.F_TRACK: ["12345678%02d" % i for i in range(4)],
    ingest.F_AMOUNT: ["100.00"] * 4,
    ingest.F_COMM: ["10.00"] * 4,
    ingest.F_SKUS: ["JAG-MY-1"] * 4,
    ingest.F_ITEMCOUNT: ["1"] * 4,
}


def _guard_df(drop=None, **override):
    """DataFrame Fighter 4 baris (nilai rekaan). `drop` = senarai lajur dibuang,
    `override` = ganti isi satu lajur (guna kunci konstan F_*)."""
    data = {k: list(v) for k, v in _FIGHTER_COLS.items()}
    data.update(override)
    for col in (drop or []):
        data.pop(col, None)
    return pd.DataFrame(data)


class TestFighterSchemaGuard(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _orders(self):
        return self.conn.execute(text("SELECT COUNT(*) FROM orders")).scalar()

    def test_normal_file_still_ingests(self):
        n = ingest.ingest_fighter(_guard_df(), "ok.xlsx", self.conn)
        self.assertEqual(n, 4)
        self.assertEqual(self._orders(), 4)

    def test_missing_commission_rejected(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(_guard_df(drop=[ingest.F_COMM]), "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.F_COMM, cm.exception.message)
        self.assertEqual(self._orders(), 0)      # TIADA apa ditulis

    def test_missing_item_count_rejected(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(_guard_df(drop=[ingest.F_ITEMCOUNT]),
                                  "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.F_ITEMCOUNT, cm.exception.message)

    def test_missing_skus_rejected(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(_guard_df(drop=[ingest.F_SKUS]), "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.F_SKUS, cm.exception.message)

    def test_missing_several_columns_all_named(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(
                _guard_df(drop=[ingest.F_COMM, ingest.F_ITEMCOUNT, ingest.F_SKUS]),
                "bad.xlsx", self.conn)
        msg = cm.exception.message
        for col in (ingest.F_COMM, ingest.F_ITEMCOUNT, ingest.F_SKUS):
            self.assertIn(col, msg)


class TestFighterAmountGuard(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _orders(self):
        return self.conn.execute(text("SELECT COUNT(*) FROM orders")).scalar()

    def test_text_in_selling_price_rejected(self):
        df = _guard_df(**{ingest.F_AMOUNT: ["100.00", "PENDING", "-", "50.00"]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(df, "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn(ingest.F_AMOUNT, cm.exception.message)
        self.assertIn("PENDING", cm.exception.message)
        self.assertEqual(self._orders(), 0)

    def test_text_in_commission_rejected(self):
        df = _guard_df(**{ingest.F_COMM: ["10.00", "PENDING", "5.00", "1.00"]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(df, "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn(ingest.F_COMM, cm.exception.message)

    def test_message_caps_examples_at_three(self):
        df = _guard_df(**{ingest.F_AMOUNT: ["a", "b", "c", "d"]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(df, "bad.xlsx", self.conn)
        msg = cm.exception.message
        self.assertIn("4 money cell(s)", msg)     # kiraan penuh dilapor
        self.assertNotIn("'d'", msg)              # contoh dihad 3

    def test_whole_price_column_empty_rejected(self):
        df = _guard_df(**{ingest.F_AMOUNT: [None] * 4})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(df, "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn("empty", cm.exception.message)
        self.assertEqual(self._orders(), 0)

    def test_majority_empty_price_rejected(self):
        # 3 daripada 4 kosong = lebih 50% = tolak.
        df = _guard_df(**{ingest.F_AMOUNT: ["100.00", "", None, float("nan")]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(df, "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)

    def test_minority_empty_price_still_ingests(self):
        # 1 daripada 4 kosong = bawah ambang = lulus (behavior lama dikekalkan).
        df = _guard_df(**{ingest.F_AMOUNT: ["100.00", "100.00", "100.00", None]})
        self.assertEqual(ingest.ingest_fighter(df, "ok.xlsx", self.conn), 4)

    def test_true_zero_values_do_not_trip_guard(self):
        df = _guard_df(**{ingest.F_AMOUNT: ["0.00", "0", "RM 0.00", "100.00"],
                          ingest.F_COMM: ["0.00", "0", "(0.00)", "10.00"]})
        self.assertEqual(ingest.ingest_fighter(df, "ok.xlsx", self.conn), 4)
        zeros = self.conn.execute(text(
            "SELECT COUNT(*) FROM orders WHERE selling_price = 0")).scalar()
        self.assertEqual(zeros, 3)

    def test_blank_commission_cells_still_allowed(self):
        # Export Fighter sebenar biar Sales Commission KOSONG untuk order tanpa
        # komisen; guard tak boleh tolak fail sah macam ni.
        df = _guard_df(**{ingest.F_COMM: ["10.00", None, "", float("nan")]})
        self.assertEqual(ingest.ingest_fighter(df, "ok.xlsx", self.conn), 4)

    def test_pure_zero_helper(self):
        for raw in ("0", "00", "0.0", "0.00", "RM 0.00", "(0.00)", "-0", "0,000.00"):
            self.assertTrue(ingest._looks_pure_zero(raw), raw)
        for raw in ("PENDING", "-", "n/a", "", "nan", "1.00", "abc"):
            self.assertFalse(ingest._looks_pure_zero(raw), raw)

    def test_rejection_logged_and_nothing_written(self):
        # Laluan penuh ingest_bytes (macam upload sebenar): fail Fighter dengan
        # sel duit teks mesti jadi IngestResult ditolak + SATU baris cap jari.
        df = _guard_df(**{ingest.F_AMOUNT: ["100.00", "PENDING", "50.00", "20.00"]})
        res = ingest.ingest_bytes(df.to_csv(index=False).encode(),
                                  "fighterBroken.csv", self.conn)
        self.assertIsNone(res.kind)
        self.assertEqual(res.rows, 0)
        self.assertEqual(res.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertEqual(res.detected_type, "fighter")
        self.assertEqual(self._orders(), 0)
        rej = self.conn.execute(text(
            "SELECT reason, columns_json FROM ingest_rejections")).fetchall()
        self.assertEqual(len(rej), 1)
        self.assertEqual(rej[0][0], ingest.REASON_SUSPECT_VALUES)
        # Cap jari simpan NAMA lajur sahaja, tiada nilai baris (selamat PII).
        self.assertIn(ingest.F_AMOUNT, rej[0][1])
        self.assertNotIn("PENDING", rej[0][1])

    def test_missing_column_rejection_logged(self):
        df = _guard_df(drop=[ingest.F_COMM])
        res = ingest.ingest_bytes(df.to_csv(index=False).encode(),
                                  "fighterNoComm.csv", self.conn)
        self.assertIsNone(res.kind)
        self.assertEqual(res.reason, ingest.REASON_MISSING_COLUMNS)
        rej = self.conn.execute(text(
            "SELECT reason FROM ingest_rejections")).fetchall()
        self.assertEqual([r[0] for r in rej], [ingest.REASON_MISSING_COLUMNS])


# =====================================================================
# 15b. Guard tarikh Fighter (FIX C, audit reconTrust 2026-07-27).
#      Tarikh order dikemas DI PINTU supaya tiga enjin recon tak boleh lari:
#      reconcile.py parse tarikh dengan pandas, reconSql.py + recon.ts BANDING
#      TEKS. Selagi order_date kanonik ("YYYY-MM-DD HH:MM:SS") atau NULL, dua
#      cara tu bagi jawapan sama. Sel yang tak boleh diparse dulu jatuh senyap
#      ke NULL (order hilang umur, tak pernah jadi hilang_lewat = bocor duit
#      tersorok); sekarang fail DITOLAK, sebab sama dengan guard duit.
#      Semua fixture SINTETIK.
# =====================================================================
class TestFighterDateGuard(unittest.TestCase):
    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _dates(self):
        rows = self.conn.execute(text(
            "SELECT order_id, order_date FROM orders ORDER BY order_id")).fetchall()
        return {r[0]: r[1] for r in rows}

    def _orders(self):
        return self.conn.execute(text("SELECT COUNT(*) FROM orders")).scalar()

    def test_mixed_formats_normalised_to_canonical(self):
        # Empat format berbeza yang pandas faham -> SATU bentuk kanonik.
        df = _guard_df(**{ingest.F_DATE: [
            "01/06/2026",            # dd/mm/yyyy (dayfirst)
            "2026-06-03",            # tarikh sahaja
            "2026-06-02T10:00:00",   # ISO dengan T
            "2026-06-04 08:30:00",   # sudah kanonik
        ]})
        self.assertEqual(ingest.ingest_fighter(df, "ok.xlsx", self.conn), 4)
        self.assertEqual(self._dates(), {
            "O1": "2026-06-01 00:00:00",
            "O2": "2026-06-03 00:00:00",
            "O3": "2026-06-02 10:00:00",
            "O4": "2026-06-04 08:30:00",
        })

    def test_blank_date_stored_as_null_not_empty_string(self):
        # Rentetan KOSONG dalam order_date = satu satunya kes tarikh yang masih
        # buat reconcile.py dan reconSql.py bercanggah (lihat testReconEdgeCases
        # kelas TestGapTarikhBukanKanonik). Jadi ia WAJIB jadi NULL, bukan ''.
        # Kekal 2 sel kosong sahaja (tepat pada ambang Guard 5, masih lulus);
        # sentinel None yang ketiga diuji dalam test_minority_blank_dates_*.
        df = _guard_df(**{ingest.F_DATE: [
            "2026-06-01 10:00:00", "2026-06-02 09:00:00", "", float("nan")]})
        self.assertEqual(ingest.ingest_fighter(df, "ok.xlsx", self.conn), 4)
        d = self._dates()
        self.assertEqual(d["O1"], "2026-06-01 10:00:00")
        for oid in ("O3", "O4"):
            self.assertIsNone(d[oid], oid)
        kosong = self.conn.execute(text(
            "SELECT COUNT(*) FROM orders WHERE order_date = ''")).scalar()
        self.assertEqual(kosong, 0)

    def test_unparseable_date_rejects_file(self):
        df = _guard_df(**{ingest.F_DATE: [
            "2026-06-01 10:00:00", "tarikh rosak", "2026-06-02", "31/13/2026"]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(df, "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn(ingest.F_DATE, cm.exception.message)
        self.assertIn("tarikh rosak", cm.exception.message)
        self.assertEqual(self._orders(), 0)      # TIADA apa ditulis

    def test_missing_date_column_rejected_not_crash(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(_guard_df(drop=[ingest.F_DATE]),
                                  "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.F_DATE, cm.exception.message)
        self.assertEqual(self._orders(), 0)

    def test_date_rejection_logged_via_ingest_bytes(self):
        df = _guard_df(**{ingest.F_DATE: [
            "2026-06-01", "2026-06-02", "bukan tarikh", "2026-06-04"]})
        res = ingest.ingest_bytes(df.to_csv(index=False).encode(),
                                  "fighterBadDate.csv", self.conn)
        self.assertIsNone(res.kind)
        self.assertEqual(res.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertEqual(res.detected_type, "fighter")
        self.assertEqual(self._orders(), 0)
        rej = self.conn.execute(text(
            "SELECT reason, columns_json FROM ingest_rejections")).fetchall()
        self.assertEqual([r[0] for r in rej], [ingest.REASON_SUSPECT_VALUES])
        # Cap jari simpan NAMA lajur sahaja, tiada nilai baris (selamat PII).
        self.assertNotIn("bukan tarikh", rej[0][1])

    def test_suspect_date_helper(self):
        raw = pd.Series(["2026-06-01", "", None, "rosak", float("nan")])
        parsed = db.parse_dt(raw, dayfirst=True)
        self.assertEqual(ingest._suspect_date_cells(raw, parsed), ["rosak"])

    # --- Guard 5: lajur Date majoriti kosong (ambang sama macam guard duit) ---

    def test_majority_blank_dates_rejected(self):
        # 4 daripada 4 kosong = jauh lebih 50% = tolak. Kalau ini lulus, SEMUA
        # order dalam fail tu hilang aging dan tak pernah naik hilang_lewat.
        df = _guard_df(**{ingest.F_DATE: ["", None, float("nan"), ""]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(df, "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn(ingest.F_DATE, cm.exception.message)   # mesej sebut tarikh
        self.assertIn("empty", cm.exception.message)
        self.assertEqual(self._orders(), 0)                  # TIADA apa ditulis

    def test_minority_blank_dates_still_ingests_as_null(self):
        # 1 daripada 4 kosong = bawah ambang = LULUS, dan sel kosong tu kekal
        # NULL (Fighter memang ada order tanpa tarikh sekali sekala).
        df = _guard_df(**{ingest.F_DATE: [
            "2026-06-01", "2026-06-02", "2026-06-03", None]})
        self.assertEqual(ingest.ingest_fighter(df, "ok.xlsx", self.conn), 4)
        d = self._dates()
        self.assertEqual(d["O1"], "2026-06-01 00:00:00")
        self.assertIsNone(d["O4"])

    def test_blank_date_threshold_boundary(self):
        # Sempadan ambang, semantik SAMA dengan guard duit (blank > n * 0.5):
        # tepat separuh (2 dari 4) LULUS, satu lagi melepasi (3 dari 4) TOLAK.
        tepat = _guard_df(**{ingest.F_DATE: ["2026-06-01", "2026-06-02", "", None]})
        self.assertEqual(ingest.ingest_fighter(tepat, "ok.xlsx", self.conn), 4)
        self.assertEqual(self._orders(), 4)
        lepas = _guard_df(**{ingest.F_DATE: ["2026-06-01", "", None, float("nan")]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_fighter(lepas, "bad.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn(ingest.F_DATE, cm.exception.message)
        self.assertEqual(self._orders(), 4)   # kekal 4 dari fail pertama sahaja


# Fail Fighter SEBENAR (data/fighterSample.xlsx, gitignored) mesti LULUS guard ,
# bukti guard tak terlalu ketat. Sengaja TIADA angka sebenar di-assert (repo
# public, data-safe): hanya "tidak ditolak" + ada baris + ada duit.
_SAMPLE_FIGHTER = os.path.abspath(
    os.path.join(ENGINE_DIR, "..", "..", "..", "data", "fighterSample.xlsx"))


@unittest.skipUnless(os.path.exists(_SAMPLE_FIGHTER),
                     "sampel Fighter (gitignored) tiada, langkau")
class TestFighterRealSamplePassesGuard(unittest.TestCase):
    def test_real_export_not_rejected(self):
        with open(_SAMPLE_FIGHTER, "rb") as fh:
            data = fh.read()
        eng = create_engine("sqlite://")
        conn = eng.connect()
        db.init_db(conn)
        try:
            res = ingest.ingest_bytes(data, os.path.basename(_SAMPLE_FIGHTER), conn)
            self.assertEqual(res.kind, "fighter")
            self.assertEqual(res.reason, ingest.REASON_OK)
            self.assertGreater(res.rows, 0)
            total = conn.execute(text("SELECT SUM(selling_price) FROM orders")).scalar()
            self.assertGreater(total, 0)          # duit betul betul masuk
            self.assertEqual(conn.execute(text(
                "SELECT COUNT(*) FROM ingest_rejections")).scalar(), 0)
        finally:
            conn.close()


# =====================================================================
# 18. Guard pintu lajur SEMUA feed (guard_feed_columns). Lubang yang ditutup:
#     detect() kenal feed dengan SATU lajur tandatangan sahaja, jadi laporan LAIN
#     dari kurier yang sama (contoh laporan "balance" Ninja: ada "Global Shipper
#     ID", tiada "Tracking ID"/"COD Amount"/net) masuk ke parser bil dan meletup
#     jadi KeyError MENTAH , kerani nampak "server error" tanpa sebab.
#     Sekarang: reason=missing_columns, mesej sebut lajur mana hilang, TIADA baris
#     ditulis, satu baris cap jari ke ingest_rejections.
#     Semua fixture di bahagian ni SINTETIK.
# =====================================================================
# Bentuk lajur laporan balance Ninja (nama lajur SAHAJA disalin dari fail sebenar,
# semua NILAI rekaan , repo public, data-safe).
_NV_BALANCE_COLS = ["Week", "Date", "tracking_id", "granular_status",
                    "goods_amount", "from_name", "Global Shipper ID", "to_name",
                    "success_route_id", "Completed date", "Shipper name",
                    "delivery_type", "Rate", "MYR_Amount", "Currency"]


def _nv_balance_df(rows=2):
    """DataFrame bentuk laporan balance Ninja (nilai rekaan sepenuhnya)."""
    return pd.DataFrame({
        "Week": [20260105] * rows,
        "Date": [46027] * rows,                       # nombor siri Excel
        "tracking_id": ["NVMYTESTNV%07d" % i for i in range(rows)],
        "granular_status": ["Completed"] * rows,
        "goods_amount": [100] * rows,
        "from_name": ["Rekaan Sdn Bhd"] * rows,
        "Global Shipper ID": [10000000] * rows,
        "to_name": ["Nama Rekaan"] * rows,
        "success_route_id": [80000000] * rows,
        "Completed date": [46027] * rows,
        "Shipper name": ["REKAAN SDN BHD"] * rows,
        "delivery_type": ["Domestic"] * rows,
        "Rate": [1] * rows,
        "MYR_Amount": [100] * rows,
        "Currency": ["MYR"] * rows,
    })


class TestNinjaBalanceRejected(unittest.TestCase):
    """Fail dengan cap jari Ninja tapi lajur SALAH mesti ditolak sopan."""

    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _counts(self):
        n = lambda t: self.conn.execute(text("SELECT COUNT(*) FROM " + t)).scalar()
        return n("cod_bills"), n("cod_bill_lines")

    def test_detected_as_ninja_by_signature(self):
        # Sahkan premis ujian ni: fail memang JATUH ke laluan ninja (bukan unknown),
        # jadi guard pintu betul betul yang menyelamatkannya.
        self.assertEqual(ingest.detect(_nv_balance_df()), "ninja")

    def test_missing_columns_not_raw_keyerror(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(_nv_balance_df(), "NINJA BALANCE.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertEqual(cm.exception.detected_type, "ninja")

    def test_message_names_every_missing_column(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(_nv_balance_df(), "NINJA BALANCE.xlsx", self.conn)
        msg = cm.exception.message
        for col in (ingest.NV_TRACK, ingest.NV_COD, ingest.NV_NET,
                    ingest.NV_COMPLETE, ingest.NV_PICKUP):
            self.assertIn(col, msg)

    def test_nothing_written_not_even_bill_header(self):
        with self.assertRaises(ingest.IngestError):
            ingest.ingest_ninja(_nv_balance_df(), "NINJA BALANCE.xlsx", self.conn)
        self.assertEqual(self._counts(), (0, 0))

    def test_ingest_bytes_returns_reason_and_logs_rejection(self):
        # Laluan sebenar yang route upload guna: TIADA exception naik, hanya
        # IngestResult berkod + satu baris tolakan.
        buf = io.BytesIO()
        _nv_balance_df().to_excel(buf, index=False)
        res = ingest.ingest_bytes(buf.getvalue(), "NINJA BALANCE.xlsx", self.conn)
        self.assertIsNone(res.kind)
        self.assertEqual(res.rows, 0)
        self.assertEqual(res.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.NV_TRACK, res.message)
        self.assertEqual(self._counts(), (0, 0))
        rej = self.conn.execute(
            text("SELECT reason, columns_json FROM ingest_rejections")).fetchall()
        self.assertEqual(len(rej), 1)
        self.assertEqual(rej[0][0], ingest.REASON_MISSING_COLUMNS)
        # Cap jari simpan nama LAJUR sahaja, tiada nilai baris (selamat PII).
        self.assertIn("tracking_id", rej[0][1])
        self.assertNotIn("Nama Rekaan", rej[0][1])


class TestFeedColumnGuardAllFeeds(unittest.TestCase):
    """Guard sama dipasang untuk semua parser bil, bukan Ninja sahaja."""

    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _bills(self):
        return self.conn.execute(text("SELECT COUNT(*) FROM cod_bills")).scalar()

    def test_jnt_missing_money_column_rejected(self):
        df = _jnt_df([("1234567890", "100.00", "5.00")]).drop(columns=[ingest.J_COD])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.J_COD, cm.exception.message)
        self.assertEqual(self._bills(), 0)     # header bil pun tak ditulis

    def test_dhl_header_without_amount_rejected(self):
        parsed = {"meta": {"Payment Reference": "TESTPAYREF001",
                           "Payment Date": "20260618"},
                  "header": ["No.", "Delivery Date", "Customer Reference ID"],
                  "rows": [["1", "18.06.2026", "TESTREF001"]]}
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(parsed, "advice.xls", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.D_COD, cm.exception.message)
        self.assertEqual(self._bills(), 0)

    def test_chip_without_type_column_rejected(self):
        df = pd.DataFrame({ingest.C_REF: ["FIGHTER-1001"],
                           ingest.C_AMOUNT: ["100.00"]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.C_TYPE, cm.exception.message)

    def test_wallet_without_amount_column_rejected(self):
        df = pd.DataFrame({ingest.W_TXN: ["TXN1"], ingest.W_DATE: ["10:00:00 18/06/2026"],
                           ingest.W_SELLER: ["Rekaan"], ingest.W_TYPE: ["IN"],
                           ingest.W_SOURCE: ["Sales"], ingest.W_STATUS: ["Approved"]})
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_wallet(df, "wallet.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.W_AMOUNT, cm.exception.message)

    def test_full_column_files_still_pass(self):
        # Guard tak boleh terlalu ketat: bil J&T lengkap mesti tetap masuk.
        n = ingest.ingest_jnt(_jnt_df([("1234567890", "100.00", "5.00")]),
                              "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(n, 1)

    def test_guard_is_silent_for_unregistered_kind(self):
        # Kind tak berdaftar = guard tak campur (tiada kesan sampingan).
        ingest.guard_feed_columns("tiada_feed_ni", ["apa apa"])

    def test_guard_handles_none_columns(self):
        # Header None (advice rosak) tak boleh crash guard itu sendiri.
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.guard_feed_columns("dhl", None)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)


# Fail Ninja balance SEBENAR (gitignored) mesti ditolak dengan sebab berkod, dan
# SOA Ninja sebenar mesti tetap LULUS , bukti guard tepat, bukan sekadar ketat.
_SAMPLE_NV_BALANCE = os.path.join(_SAMPLE_NONBILL, "ninjaBalance20260728.xlsx")
_SAMPLE_NV_SOA = os.path.abspath(
    os.path.join(ENGINE_DIR, "..", "..", "..", "data", "sampel",
                 "ninjaSoa20260709.xlsx"))


@unittest.skipUnless(os.path.exists(_SAMPLE_NV_BALANCE),
                     "sampel Ninja balance (gitignored) tiada, langkau")
class TestNinjaBalanceRealSample(unittest.TestCase):
    def test_real_balance_file_rejected_cleanly(self):
        with open(_SAMPLE_NV_BALANCE, "rb") as fh:
            data = fh.read()
        eng = create_engine("sqlite://")
        conn = eng.connect()
        db.init_db(conn)
        try:
            res = ingest.ingest_bytes(data, os.path.basename(_SAMPLE_NV_BALANCE), conn)
            self.assertIsNone(res.kind)
            self.assertEqual(res.reason, ingest.REASON_MISSING_COLUMNS)
            self.assertEqual(res.detected_type, "ninja")
            self.assertEqual(conn.execute(text(
                "SELECT COUNT(*) FROM cod_bill_lines")).scalar(), 0)
            self.assertEqual(conn.execute(text(
                "SELECT COUNT(*) FROM cod_bills")).scalar(), 0)
            self.assertEqual(conn.execute(text(
                "SELECT COUNT(*) FROM ingest_rejections")).scalar(), 1)
        finally:
            conn.close()


@unittest.skipUnless(os.path.exists(_SAMPLE_NV_SOA),
                     "sampel Ninja SOA (gitignored) tiada, langkau")
class TestNinjaSoaRealSamplePassesGuard(unittest.TestCase):
    def test_real_soa_not_rejected(self):
        with open(_SAMPLE_NV_SOA, "rb") as fh:
            data = fh.read()
        eng = create_engine("sqlite://")
        conn = eng.connect()
        db.init_db(conn)
        try:
            res = ingest.ingest_bytes(data, os.path.basename(_SAMPLE_NV_SOA), conn)
            self.assertEqual(res.kind, "ninja")
            self.assertEqual(res.reason, ingest.REASON_OK)
            self.assertGreater(res.rows, 0)
            self.assertEqual(conn.execute(text(
                "SELECT COUNT(*) FROM ingest_rejections")).scalar(), 0)
        finally:
            conn.close()


# =====================================================================
# 19. Guard nilai duit SEJAGAT (guard_feed_values). Lubang yang ditutup:
#     guard nilai duit dulu HANYA di pintu Fighter. Feed lain cuma disemak lajur
#     WUJUD, tak pernah disemak isinya boleh dibaca , jadi sel duit berisi teks
#     ("PENDING", "-", "N/A") lepas masuk, db.to_num tukar jadi 0, dan bil masuk
#     sebagai RM0 tanpa bunyi. Bil yang sepatutnya bukti duit sampai bank jadi
#     bukti KOSONG, dan recon ingat kurier tak bayar.
#     Sekarang SETIAP ingest_* panggil guard yang sama: reason=suspect_values,
#     mesej sebut lajur + contoh sel, TIADA baris (mahupun header bil) ditulis.
#     Semua fixture SINTETIK.
# =====================================================================
def _nv_df(rows):
    """rows = senarai (tracking, cod, net). DataFrame Ninja COD SOA (nilai rekaan)."""
    n = len(rows)
    return pd.DataFrame({
        ingest.NV_SHIPPER: [10000000] * n,
        ingest.NV_TRACK: [r[0] for r in rows],
        ingest.NV_COD: [r[1] for r in rows],
        ingest.NV_NET: [r[2] for r in rows],
        ingest.NV_COMPLETE: ["20260618"] * n,
        ingest.NV_PICKUP: ["20260617"] * n,
    })


def _wallet_df(rows):
    """rows = senarai (txn_id, amount). DataFrame Wallet minimum (nilai rekaan)."""
    n = len(rows)
    return pd.DataFrame({
        ingest.W_TXN: [r[0] for r in rows],
        ingest.W_DATE: ["10:00:00 18/06/2026"] * n,
        ingest.W_SELLER: ["Rekaan Stockist"] * n,
        ingest.W_TYPE: ["IN"] * n,
        ingest.W_SOURCE: ["Sales"] * n,
        ingest.W_STATUS: ["Approved"] * n,
        ingest.W_AMOUNT: [r[1] for r in rows],
    })


def _dhl_parsed(rows):
    """rows = senarai (ref, cod). Bentuk {meta, header, rows} macam parse_dhl."""
    header = ["No.", ingest.D_DELIVERED, "DHL Parcel ID", ingest.D_REF,
              "Consignee Name", ingest.D_DEPOSIT, ingest.D_COD]
    return {
        "meta": {"Payment Reference": "TESTPAYREF001", "Payment Date": "20260618"},
        "header": header,
        "rows": [[str(i + 1), "18.06.2026", "TESTPARCEL", ref, "Nama Rekaan",
                  "", cod] for i, (ref, cod) in enumerate(rows)],
    }


def _chip_df(records):
    """records = senarai dict (Type/Reference Nr./Amount/Fee/Status). DataFrame
    CHIP bentuk selepas parse_chip (nilai rekaan)."""
    return pd.DataFrame({
        ingest.C_TYPE: [r.get("Type", "purchase") for r in records],
        ingest.C_REF: [r.get("Reference Nr.") for r in records],
        ingest.C_AMOUNT: [r.get("Amount", "100.00") for r in records],
        ingest.C_FEE: [r.get("Fee", "2.00") for r in records],
        ingest.C_STATUS: [r.get("Status", "paid") for r in records],
        ingest.C_PAID: [r.get("Paid On", "2026-07-16 09:00:00") for r in records],
        ingest.C_SETTLED: [r.get("Settled On", "2026-07-17") for r in records],
    })


class _MoneyGuardBase(unittest.TestCase):
    """SQLite dalam-ingatan + pembantu kira baris (dikongsi kelas guard duit)."""

    def setUp(self):
        self.eng = create_engine("sqlite://")
        self.conn = self.eng.connect()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _n(self, table):
        return self.conn.execute(text("SELECT COUNT(*) FROM " + table)).scalar()

    def _bill_counts(self):
        return self._n("cod_bills"), self._n("cod_bill_lines")


class TestMoneyGuardJnt(_MoneyGuardBase):
    def test_text_in_cod_rejected(self):
        df = _jnt_df([("TESTAWB0001", "100.00", "5.00"),
                      ("TESTAWB0002", "PENDING", "5.00")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertEqual(cm.exception.detected_type, "jnt")
        self.assertIn(ingest.J_COD, cm.exception.message)
        self.assertIn("PENDING", cm.exception.message)
        # Header bil pun TIDAK ditulis (guard sebelum BILLS_UPSERT).
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_text_in_fee_rejected(self):
        df = _jnt_df([("TESTAWB0001", "100.00", "N/A")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn(ingest.J_FEE, cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_majority_empty_cod_rejected(self):
        df = _jnt_df([("TESTAWB0001", "100.00", "5.00"),
                      ("TESTAWB0002", "", "5.00"),
                      ("TESTAWB0003", None, "5.00"),
                      ("TESTAWB0004", "", "5.00")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn("empty", cm.exception.message)
        self.assertIn(ingest.J_COD, cm.exception.message)

    def test_clean_bill_still_passes(self):
        # Guard tak boleh terlalu ketat: bil bersih mesti masuk penuh.
        n = ingest.ingest_jnt(_jnt_df([("TESTAWB0001", "100.00", "5.00"),
                                       ("TESTAWB0002", "1,250.50", "(3.27)")]),
                              "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(n, 2)
        self.assertEqual(self._bill_counts(), (1, 2))

    def test_true_zero_and_blank_fee_allowed(self):
        # COD sifar TULEN + fee kosong = fail sah (parcel percuma / bil tanpa fee).
        n = ingest.ingest_jnt(_jnt_df([("TESTAWB0001", "0.00", ""),
                                       ("TESTAWB0002", "100.00", "RM 0.00")]),
                              "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(n, 2)


class TestMoneyGuardNinja(_MoneyGuardBase):
    def test_text_in_cod_rejected(self):
        df = _nv_df([("NVMYTEST0001", "100.00", "95.00"),
                     ("NVMYTEST0002", "PENDING", "95.00")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertEqual(cm.exception.detected_type, "ninja")
        self.assertIn(ingest.NV_COD, cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_text_in_net_rejected(self):
        # NET rosak = fee dikira COD penuh (kurier nampak ambil semua duit).
        df = _nv_df([("NVMYTEST0001", "100.00", "tiada")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn(ingest.NV_NET, cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_majority_empty_cod_rejected(self):
        df = _nv_df([("NVMYTEST0001", "100.00", "95.00"),
                     ("NVMYTEST0002", "", "95.00"),
                     ("NVMYTEST0003", None, "95.00")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn("empty", cm.exception.message)

    def test_clean_soa_still_passes(self):
        n = ingest.ingest_ninja(_nv_df([("NVMYTEST0001", "100.00", "95.00"),
                                        ("NVMYTEST0002", "0.00", "0.00")]),
                                "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(n, 2)
        self.assertEqual(self._bill_counts(), (1, 2))


class TestMoneyGuardDhl(_MoneyGuardBase):
    def test_text_in_cod_rejected(self):
        parsed = _dhl_parsed([("TESTREF001", "397.00"), ("TESTREF002", "-")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(parsed, "advice.xls", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertEqual(cm.exception.detected_type, "dhl")
        # Mesej sebut nama lajur SEBENAR dalam advice, bukan nama pembolehubah.
        self.assertIn(ingest.D_COD, cm.exception.message)
        self.assertNotIn("'cod'", cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_majority_empty_cod_rejected(self):
        parsed = _dhl_parsed([("TESTREF001", "397.00"), ("TESTREF002", ""),
                              ("TESTREF003", "")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(parsed, "advice.xls", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn("empty", cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_clean_advice_still_passes(self):
        n = ingest.ingest_dhl(_dhl_parsed([("TESTREF001", "397.00"),
                                           ("TESTREF002", "157.00")]),
                              "advice.xls", self.conn)
        self.assertEqual(n, 2)
        self.assertEqual(self._bill_counts(), (1, 2))


class TestMoneyGuardWallet(_MoneyGuardBase):
    def test_text_in_amount_rejected(self):
        df = _wallet_df([("TXN1", "50.00"), ("TXN2", "PENDING")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_wallet(df, "wallet.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertEqual(cm.exception.detected_type, "wallet")
        self.assertIn(ingest.W_AMOUNT, cm.exception.message)
        self.assertEqual(self._n("wallet_txns"), 0)

    def test_majority_empty_amount_rejected(self):
        df = _wallet_df([("TXN1", "50.00"), ("TXN2", ""), ("TXN3", None)])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_wallet(df, "wallet.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn("empty", cm.exception.message)

    def test_trailing_total_row_does_not_trip_guard(self):
        # Baris total hujung export (tiada Transaction ID, amaun kosong) tak boleh
        # jadi penggera palsu , guard kira atas baris ber-Transaction ID sahaja.
        # Baris tu juga TIDAK disimpan lagi (dulu ia runtuh jadi satu rekod PK
        # "nan"), jadi kaunter sekarang 2, bukan 4.
        df = _wallet_df([("TXN1", "50.00"), ("TXN2", "60.00"),
                         (None, ""), (None, "")])
        self.assertEqual(ingest.ingest_wallet(df, "wallet.xlsx", self.conn), 2)
        self.assertEqual(self._n("wallet_txns"), 2)

    def test_clean_wallet_still_passes(self):
        n = ingest.ingest_wallet(_wallet_df([("TXN1", "50.00"), ("TXN2", "0.00")]),
                                 "wallet.xlsx", self.conn)
        self.assertEqual(n, 2)
        self.assertEqual(self._n("wallet_txns"), 2)


class TestMoneyGuardChip(_MoneyGuardBase):
    def test_text_in_amount_rejected(self):
        df = _chip_df([{"Reference Nr.": "FIGHTER-1001", "Amount": "100.00"},
                       {"Reference Nr.": "FIGHTER-1002", "Amount": "PENDING"}])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertEqual(cm.exception.detected_type, "chip")
        self.assertIn(ingest.C_AMOUNT, cm.exception.message)
        self.assertEqual(self._n("prepaid_payments"), 0)

    def test_text_in_fee_rejected(self):
        df = _chip_df([{"Reference Nr.": "FIGHTER-1001", "Fee": "rosak"}])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertIn(ingest.C_FEE, cm.exception.message)

    def test_guard_ignores_rows_already_filtered_out(self):
        # Baris 'custom' (disbursement) memang tak disimpan, jadi amaun rosaknya
        # TAK boleh tolak statement yang baris purchase-nya bersih.
        df = _chip_df([{"Reference Nr.": "FIGHTER-1001", "Amount": "100.00"},
                       {"Type": "custom", "Reference Nr.": "PAYOUT-1",
                        "Amount": "rosak"}])
        self.assertEqual(
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn), 1)

    def test_clean_statement_still_passes(self):
        df = _chip_df([{"Reference Nr.": "FIGHTER-1001", "Amount": "RM 150.00"},
                       {"Reference Nr.": "FIGHTER-1002", "Amount": "0.00"}])
        self.assertEqual(
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn), 2)
        self.assertEqual(self._n("prepaid_payments"), 2)


class TestMoneyGuardRegistry(_MoneyGuardBase):
    def test_every_registered_feed_has_a_money_guard(self):
        # Backbone: tambah feed baru dalam FEED_SCHEMA tanpa lajur duit dalam
        # FEED_MONEY = lubang RM0 senyap terbuka semula. Ujian ni yang menjaga.
        self.assertEqual(set(ingest.FEED_MONEY), set(ingest.FEED_SCHEMA))
        for kind, spec in ingest.FEED_MONEY.items():
            self.assertTrue(spec["primary"], kind)      # mesti ada lajur utama
            self.assertTrue(spec["fix"], kind)          # mesti ada arahan pembetulan

    def test_guard_silent_for_unregistered_kind(self):
        ingest.guard_feed_values("tiada_feed_ni", _jnt_df([("A", "x", "y")]))

    def test_guard_silent_when_money_column_absent(self):
        # Lajur duit tiada = kerja guard LAJUR, bukan guard nilai (jangan crash).
        ingest.guard_feed_values("jnt", pd.DataFrame({ingest.J_AWB: ["A"]}))

    def test_rejection_logged_via_ingest_bytes(self):
        # Laluan sebenar route upload: TIADA exception naik, hanya IngestResult
        # berkod + SATU baris cap jari selamat PII.
        buf = io.BytesIO()
        _nv_df([("NVMYTEST0001", "100.00", "95.00"),
                ("NVMYTEST0002", "PENDING", "95.00")]).to_excel(buf, index=False)
        res = ingest.ingest_bytes(buf.getvalue(), "NVSOA-20260618.xlsx", self.conn)
        self.assertIsNone(res.kind)
        self.assertEqual(res.rows, 0)
        self.assertEqual(res.reason, ingest.REASON_SUSPECT_VALUES)
        self.assertEqual(res.detected_type, "ninja")
        self.assertEqual(self._bill_counts(), (0, 0))
        rej = self.conn.execute(text(
            "SELECT reason, columns_json FROM ingest_rejections")).fetchall()
        self.assertEqual(len(rej), 1)
        self.assertEqual(rej[0][0], ingest.REASON_SUSPECT_VALUES)
        # Cap jari simpan nama LAJUR sahaja, tiada nilai baris (selamat PII).
        self.assertIn(ingest.NV_COD, rej[0][1])
        self.assertNotIn("NVMYTEST0001", rej[0][1])


# =====================================================================
# 20. Hardening CHIP (sesi guard duit). Empat lubang kecil yang ditutup:
#     (a) 'Status' bukan lajur wajib , kalau hilang, tapisan status DILANGKAU
#         senyap dan bayaran pending/gagal masuk sebagai bukti duit sampai;
#     (b) tapisan Type tak strip ruang , " purchase" jatuh senyap dari statement;
#     (c) prefix "FIGHTER-" dibuang case-sensitive dan di MANA MANA kedudukan;
#     (d) tapisan buang 100% baris tapi hasil pulang HIJAU "0 rows" (nampak macam
#         berjaya), jadi kerani tak pernah tahu statement tu tiada bayaran.
#     Semua fixture SINTETIK.
# =====================================================================
class TestChipHardening(_MoneyGuardBase):
    def _refs(self):
        rows = self.conn.execute(text(
            "SELECT order_ref FROM prepaid_payments ORDER BY order_ref")).fetchall()
        return [r[0] for r in rows]

    def test_status_column_now_required(self):
        df = _chip_df([{"Reference Nr.": "FIGHTER-1001"}]).drop(
            columns=[ingest.C_STATUS])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.C_STATUS, cm.exception.message)
        self.assertEqual(self._n("prepaid_payments"), 0)

    def test_type_with_spaces_still_counted(self):
        df = _chip_df([{"Type": " purchase ", "Reference Nr.": "FIGHTER-1001"}])
        self.assertEqual(
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn), 1)
        self.assertEqual(self._refs(), ["1001"])

    def test_status_with_spaces_still_counted(self):
        df = _chip_df([{"Reference Nr.": "FIGHTER-1001", "Status": "  paid  "}])
        self.assertEqual(
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn), 1)

    def test_lowercase_fighter_prefix_stripped(self):
        df = _chip_df([{"Reference Nr.": "fighter-1001"},
                       {"Reference Nr.": "Fighter-1002"},
                       {"Reference Nr.": "FIGHTER-1003"}])
        self.assertEqual(
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn), 3)
        self.assertEqual(self._refs(), ["1001", "1002", "1003"])

    def test_prefix_stripped_only_at_front(self):
        # Rujukan yang KEBETULAN ada teks tu di tengah kekal utuh (dulu replace
        # global potong ia jadi rujukan lain = bayaran jadi yatim).
        df = _chip_df([{"Reference Nr.": "X-FIGHTER-77"}])
        self.assertEqual(
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn), 1)
        self.assertEqual(self._refs(), ["X-FIGHTER-77"])

    def test_all_disbursement_rows_warns_not_silent_green(self):
        df = _chip_df([{"Type": "custom", "Reference Nr.": "PAYOUT-1"},
                       {"Type": "custom", "Reference Nr.": "PAYOUT-2"}])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_NO_PAYMENT_ROWS)
        self.assertEqual(cm.exception.detected_type, "chip")
        self.assertIn("2 row(s)", cm.exception.message)
        self.assertEqual(self._n("prepaid_payments"), 0)

    def test_all_pending_status_warns(self):
        df = _chip_df([{"Reference Nr.": "FIGHTER-1001", "Status": "overdue"}])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_NO_PAYMENT_ROWS)

    def test_statement_with_zero_rows_stays_quiet(self):
        # Statement sah tapi memang tiada baris data langsung = bukan amaran
        # (tiada apa apa untuk diadukan), kekal 0 baris macam dulu.
        self.assertEqual(
            ingest.ingest_chip(_chip_df([]), "chipEmpty.xlsx", self.conn), 0)

    def test_no_payment_rows_has_friendly_message(self):
        msg = ingest.reason_message(ingest.REASON_NO_PAYMENT_ROWS)
        self.assertIn("Nothing was saved", msg)
        self.assertNotEqual(msg, ingest.reason_message(ingest.REASON_UNKNOWN))

    def test_mixed_statement_keeps_only_successful_purchases(self):
        df = _chip_df([{"Reference Nr.": "FIGHTER-1001"},
                       {"Reference Nr.": "FIGHTER-1002", "Status": "overdue"},
                       {"Type": "custom", "Reference Nr.": "PAYOUT-1"}])
        self.assertEqual(
            ingest.ingest_chip(df, "chipStatement2026-07-16.xlsx", self.conn), 1)
        self.assertEqual(self._refs(), ["1001"])


# =====================================================================
# 21. SEMAKAN JUMLAH KAWALAN (reason=tally_mismatch). Lubang yang ditutup:
#     fail kurier CETAK jumlah besarnya sendiri (baris TOTAL kaki SOA Ninja,
#     "Sum Total"/"Payment amount" advice DHL, GRAND TOTAL statement J&T), tapi
#     kita gugurkan baris tu tanpa memakainya. Jadi kalau parser terlepas baris
#     (format berubah, sel rosak, baris tanpa tracking dibuang), fail tetap
#     "berjaya" dengan duit KURANG dan tiada siapa perasan.
#     Sekarang jumlah yang kita baca DIBANDING jumlah yang fail isytihar.
#     Fail LAMA tanpa baris total = semakan dilangkau SENYAP (tak boleh mengarang
#     jumlah kawalan yang tak wujud). Semua fixture SINTETIK.
# =====================================================================
def _nv_df_with_total(rows, total_cod, total_net):
    """SOA Ninja sintetik + baris TOTAL kaki (tiada Tracking ID, ada duit)."""
    return _nv_df(list(rows) + [(None, total_cod, total_net)])


class TestNinjaControlTotal(_MoneyGuardBase):
    def test_matching_total_passes_and_total_row_not_saved(self):
        df = _nv_df_with_total(
            [("NVMYTEST0001", "100.00", "95.00"),
             ("NVMYTEST0002", "50.00", "45.00")], "150.00", "140.00")
        self.assertEqual(ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn), 2)
        self.assertEqual(self._bill_counts(), (1, 2))     # baris TOTAL tak masuk

    def test_short_read_rejected(self):
        # Fail isytihar COD 587 tapi baris yang boleh dibaca cuma 500 = duit
        # tercicir. Dulu ia masuk senyap sebagai 500.
        df = _nv_df_with_total([("NVMYTEST0001", "500.00", "480.00")],
                               "587.00", "560.00")
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)
        self.assertEqual(cm.exception.detected_type, "ninja")
        self.assertIn("500.00", cm.exception.message)     # yang kita baca
        self.assertIn("587.00", cm.exception.message)     # yang fail isytihar
        self.assertIn(ingest.NV_COD, cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))     # sifar kesan DB

    def test_net_mismatch_alone_is_enough_to_reject(self):
        df = _nv_df_with_total([("NVMYTEST0001", "100.00", "95.00")],
                               "100.00", "90.00")
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)
        self.assertIn(ingest.NV_NET, cm.exception.message)

    def test_dropped_non_nv_row_is_caught(self):
        # Baris tracking BUKAN NV dibuang oleh penapis; jumlah kawalan yang kini
        # dibaca itulah yang menangkap duit yang terbuang tu.
        df = _nv_df_with_total([("NVMYTEST0001", "100.00", "95.00"),
                                ("XYZ0001", "80.00", "75.00")],
                               "180.00", "170.00")
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)

    def test_file_without_total_row_still_passes(self):
        # Format lama (tiada baris TOTAL) TIDAK boleh ditolak , semakan dilangkau.
        n = ingest.ingest_ninja(_nv_df([("NVMYTEST0001", "100.00", "95.00")]),
                                "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(n, 1)

    def test_two_total_like_rows_skip_check_silently(self):
        # Bentuk fail tak dikenali (dua baris tanpa tracking tapi berduit) =
        # jangan teka, langkau semakan. Lebih baik senyap daripada tolak fail sah.
        df = _nv_df([("NVMYTEST0001", "100.00", "95.00"),
                     (None, "999.00", "999.00"), (None, "888.00", "888.00")])
        self.assertEqual(ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn), 1)

    def test_blank_separator_row_is_not_a_total(self):
        # Baris pemisah kosong tulen (tiada tracking, tiada duit) bukan total.
        df = _nv_df([("NVMYTEST0001", "100.00", "95.00"), (None, None, None)])
        self.assertEqual(ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn), 1)

    def test_cents_rounding_within_tolerance_passes(self):
        # Pembundaran sen kurier (<= 1 sen) BUKAN ketidaktepatan , mesti lulus.
        df = _nv_df_with_total([("NVMYTEST0001", "100.00", "95.005")],
                               "100.00", "95.00")
        self.assertEqual(ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn), 1)

    def test_ingest_bytes_logs_rejection(self):
        buf = io.BytesIO()
        _nv_df_with_total([("NVMYTEST0001", "500.00", "480.00")],
                          "587.00", "560.00").to_excel(buf, index=False)
        res = ingest.ingest_bytes(buf.getvalue(), "NVSOA-20260618.xlsx", self.conn)
        self.assertIsNone(res.kind)
        self.assertEqual(res.reason, ingest.REASON_TALLY_MISMATCH)
        self.assertEqual(self._bill_counts(), (0, 0))
        rej = self.conn.execute(text(
            "SELECT reason, columns_json FROM ingest_rejections")).fetchall()
        self.assertEqual(len(rej), 1)
        self.assertEqual(rej[0][0], ingest.REASON_TALLY_MISMATCH)
        self.assertNotIn("NVMYTEST0001", rej[0][1])       # cap jari kekal PII-safe


def _dhl_totals(before=None, deduction=0.0, sum_total=None, payment=None):
    """Blok jumlah kawalan advice PDF (nilai rekaan)."""
    return {"before_deduction": before, "deduction": deduction,
            "sum_total": sum_total, "payment_amount": payment}


def _dhl_parsed_with_totals(rows, totals):
    p = _dhl_parsed(rows)
    p["totals"] = totals
    return p


class TestDhlControlTotal(_MoneyGuardBase):
    def test_matching_totals_pass(self):
        p = _dhl_parsed_with_totals(
            [("TESTREF001", "397.00"), ("TESTREF002", "157.00")],
            _dhl_totals(before=554.0, sum_total=554.0, payment=554.0))
        self.assertEqual(ingest.ingest_dhl(p, "advice.pdf", self.conn), 2)

    def test_missing_line_rejected(self):
        p = _dhl_parsed_with_totals(
            [("TESTREF001", "397.00")],
            _dhl_totals(before=554.0, sum_total=554.0, payment=554.0))
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(p, "advice.pdf", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)
        self.assertEqual(cm.exception.detected_type, "dhl")
        self.assertIn("397.00", cm.exception.message)
        self.assertIn("554.00", cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_payment_amount_alone_can_reject(self):
        # Bank bayar 900 tapi baris cuma 554 = ada baris yang tak dibaca.
        p = _dhl_parsed_with_totals(
            [("TESTREF001", "397.00"), ("TESTREF002", "157.00")],
            _dhl_totals(payment=900.0))
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(p, "advice.pdf", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)
        self.assertIn("Payment amount", cm.exception.message)

    def test_advice_without_totals_still_passes(self):
        # Laluan .xls (tiada blok jumlah) TIDAK boleh ditolak.
        self.assertEqual(
            ingest.ingest_dhl(_dhl_parsed([("TESTREF001", "397.00")]),
                              "advice.xls", self.conn), 1)

    def test_totals_parsed_from_wrapped_pdf_text(self):
        # Label "Total before deduction:" PECAH dua baris dalam extract_text.
        txt = ("some advice text\nTotal before\ndeduction: 3,162.00\n"
               "Total deduction: 0.00\nSum Total: 3,162.00\n")
        t = ingest._dhl_pdf_totals(txt, "3,162.00")
        self.assertEqual(t["before_deduction"], 3162.00)
        self.assertEqual(t["deduction"], 0.00)
        self.assertEqual(t["sum_total"], 3162.00)
        self.assertEqual(t["payment_amount"], 3162.00)

    def test_totals_absent_are_none_not_zero(self):
        # Tiada label = None (langkau semakan), BUKAN 0.00 yang akan tolak fail
        # sah secara palsu.
        t = ingest._dhl_pdf_totals("advice tanpa blok jumlah", None)
        self.assertEqual(list(t.values()), [None, None, None, None])


class TestControlTotalHelper(unittest.TestCase):
    def test_none_stated_is_skipped(self):
        ingest.guard_control_total("ninja", [("COD Amount", 100.0, None)])

    def test_within_one_cent_passes(self):
        ingest.guard_control_total("ninja", [("COD Amount", 100.00, 100.005)])

    def test_beyond_tolerance_rejects(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.guard_control_total("ninja", [("COD Amount", 100.00, 100.02)])
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)

    def test_message_carries_courier_fix_hint(self):
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.guard_control_total("jnt", [("COD", 1.0, 2.0)])
        self.assertIn(ingest.FEED_MONEY["jnt"]["fix"], cm.exception.message)


# =====================================================================
# 22. "Total deduction" DHL (reason=not_modelled). Advice boleh potong sesuatu
#     daripada bayaran (caj, tuntutan, pelarasan). Kita TAK modelkan potongan
#     lagi, dan fee DHL dikunci 0.0 , jadi advice berpotongan akan simpan angka
#     yang kita TAHU salah. Lebih jujur berhenti dan hantar pada owner daripada
#     mencipta nombor. Fixture SINTETIK.
# =====================================================================
class TestDhlDeduction(_MoneyGuardBase):
    def test_zero_deduction_proceeds_as_usual(self):
        p = _dhl_parsed_with_totals([("TESTREF001", "397.00")],
                                    _dhl_totals(before=397.0, deduction=0.0,
                                                sum_total=397.0, payment=397.0))
        self.assertEqual(ingest.ingest_dhl(p, "advice.pdf", self.conn), 1)
        self.assertEqual(self._bill_counts(), (1, 1))

    def test_non_zero_deduction_rejected(self):
        p = _dhl_parsed_with_totals([("TESTREF001", "397.00")],
                                    _dhl_totals(before=397.0, deduction=25.0,
                                                sum_total=372.0, payment=372.0))
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(p, "advice.pdf", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_NOT_MODELLED)
        self.assertEqual(cm.exception.detected_type, "dhl")
        self.assertIn("25.00", cm.exception.message)
        self.assertIn("Total deduction", cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_negative_deduction_also_rejected(self):
        p = _dhl_parsed_with_totals([("TESTREF001", "397.00")],
                                    _dhl_totals(deduction=-10.0))
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(p, "advice.pdf", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_NOT_MODELLED)

    def test_deduction_checked_before_tally(self):
        # Advice berpotongan MEMANG tak tally (Sum Total < baris), tapi sebab
        # sebenarnya potongan , mesejnya mesti yang itu, bukan tally_mismatch.
        p = _dhl_parsed_with_totals([("TESTREF001", "397.00")],
                                    _dhl_totals(before=397.0, deduction=25.0,
                                                sum_total=372.0, payment=372.0))
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(p, "advice.pdf", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_NOT_MODELLED)

    def test_missing_deduction_field_does_not_reject(self):
        p = _dhl_parsed_with_totals([("TESTREF001", "397.00")],
                                    _dhl_totals(deduction=None))
        self.assertEqual(ingest.ingest_dhl(p, "advice.pdf", self.conn), 1)

    def test_not_modelled_has_friendly_message(self):
        msg = ingest.reason_message(ingest.REASON_NOT_MODELLED)
        self.assertIn("Nothing was saved", msg)
        self.assertNotEqual(msg, ingest.reason_message(ingest.REASON_UNKNOWN))


# =====================================================================
# 23. Statement J&T PDF: semakan PER BARIS + tanda fee.
#     (a) Guard lama semak JUMLAH sahaja (COD & net lawan GRAND TOTAL). Ralat
#         yang saling batal antara baris boleh lepas. Sekarang setiap baris
#         disemak: COD - fee mesti = Net yang statement cetak.
#     (b) Fee dulu dikira abs(txn) + abs(SST) , SENTIASA positif. Baris
#         reversal/kredit (J&T PULANGKAN fee, token TANPA kurungan) jadi kos,
#         bukan kredit. Sekarang fee = -(txn + SST): baris biasa keluar nilai
#         SAMA macam dulu, baris kredit kekal NEGATIF. Fixture SINTETIK.
# =====================================================================
# Baris reversal: COD dipulangkan (kurungan) dan fee dikreditkan balik (tanpa
# kurungan). net = cod - fee = -297.00 + 3.47 = -293.53.
_JNT_REVERSAL_ROW = ("632199999999", "2026-07-21 09:00:00",
                     "(297.00)", "3.27", "0.20", "(293.53)")


class TestJntPdfLineTally(unittest.TestCase):
    def test_line_that_does_not_add_up_rejected(self):
        rows = [("632111663453", "2026-07-21 22:28:06", "297.00", "(3.27)",
                 "(0.20)", "290.00")]        # net salah (patut 293.53)
        with self.assertRaises(ingest.IngestError) as cm:
            ingest._jnt_parse_text(_jnt_stmt_text(rows, ("297.00", "3.27",
                                                         "0.20", "290.00")))
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)
        self.assertIn("632111663453", cm.exception.message)   # AWB contoh

    def test_offsetting_line_errors_no_longer_hide(self):
        # Dua baris silap yang JUMLAHNYA betul: guard jumlah lama lulus, guard
        # per baris yang menangkapnya.
        rows = [("632111663453", "2026-07-21 22:28:06", "297.00", "(3.27)",
                 "(0.20)", "300.00"),
                ("632118893604", "2026-07-21 14:52:52", "180.00", "(2.00)",
                 "(0.12)", "171.41")]
        grand = ("477.00", "5.27", "0.32", "471.41")          # jumlah TETAP tally
        with self.assertRaises(ingest.IngestError) as cm:
            ingest._jnt_parse_text(_jnt_stmt_text(rows, grand))
        self.assertEqual(cm.exception.reason, ingest.REASON_TALLY_MISMATCH)
        self.assertIn("do not add up", cm.exception.message)

    def test_reversal_row_keeps_negative_fee(self):
        # Bukti tanda: fee baris kredit mesti NEGATIF. Dengan abs() dulu ia jadi
        # +3.47 dan baris ni akan gagal semakan COD - fee = Net.
        rows = list(_JNT_GOOD_ROWS) + [_JNT_REVERSAL_ROW]
        grand = ("180.00", "2.00", "0.12", "177.88")   # 477-297 , 471.41-293.53
        df, _, _ = ingest._jnt_parse_text(_jnt_stmt_text(rows, grand))
        self.assertEqual(len(df), 3)
        self.assertAlmostEqual(df[ingest.J_FEE].iloc[2], -3.47, places=2)
        self.assertAlmostEqual(df[ingest.J_COD].iloc[2], -297.00, places=2)

    def test_normal_rows_keep_positive_fee(self):
        # Perangai baris biasa TIDAK berubah (kos kekal positif).
        df, _, _ = ingest._jnt_parse_text(
            _jnt_stmt_text(_JNT_GOOD_ROWS, _JNT_GOOD_GRAND))
        self.assertEqual(list(df[ingest.J_FEE]), [3.47, 2.12])

    def test_every_line_satisfies_cod_minus_fee_equals_net(self):
        rows = list(_JNT_GOOD_ROWS) + [_JNT_REVERSAL_ROW]
        grand = ("180.00", "2.00", "0.12", "177.88")
        df, _, _ = ingest._jnt_parse_text(_jnt_stmt_text(rows, grand))
        for i, r in enumerate(rows):
            net = ingest._jnt_pdf_num(r[5])
            self.assertAlmostEqual(
                df[ingest.J_COD].iloc[i] - df[ingest.J_FEE].iloc[i], net, places=2)

    def test_cent_rounding_on_a_line_still_passes(self):
        rows = [("632111663453", "2026-07-21 22:28:06", "297.00", "(3.27)",
                 "(0.20)", "293.54")]        # 1 sen beza = pembundaran
        df, _, _ = ingest._jnt_parse_text(
            _jnt_stmt_text(rows, ("297.00", "3.27", "0.20", "293.54")))
        self.assertEqual(len(df), 1)


# =====================================================================
# 24. DUPLIKAT KUNCI DALAM SATU FAIL (reason=duplicate_rows). Lubang yang
#     ditutup: cod_bill_lines berkunci AWB, jadi AWB berulang DALAM satu fail
#     ditimpa senyap oleh upsert , duit baris pertama lenyap sedangkan kaunter
#     "x baris" tetap kira dua. Sekarang: duplikat IDENTIK = dedup senyap
#     (kaunter jadi jujur), duplikat bernilai BERBEZA = tolak fail (kita tak
#     boleh pilih sendiri baris mana yang betul). Fixture SINTETIK.
# =====================================================================
class TestDuplicateRowsGuard(_MoneyGuardBase):
    def test_jnt_identical_duplicate_deduped_silently(self):
        df = _jnt_df([("TESTAWB0001", "100.00", "5.00"),
                      ("TESTAWB0001", "100.00", "5.00"),
                      ("TESTAWB0002", "60.00", "3.00")])
        n = ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(n, 2)                       # kaunter jujur, bukan 3
        self.assertEqual(self._bill_counts(), (1, 2))
        total = self.conn.execute(text(
            "SELECT ROUND(SUM(cod_amount),2) FROM cod_bill_lines")).scalar()
        self.assertEqual(total, 160.0)

    def test_jnt_conflicting_duplicate_rejected(self):
        df = _jnt_df([("TESTAWB0001", "100.00", "5.00"),
                      ("TESTAWB0001", "250.00", "5.00")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_DUPLICATE_ROWS)
        self.assertEqual(cm.exception.detected_type, "jnt")
        self.assertIn("TESTAWB0001", cm.exception.message)   # contoh kunci
        self.assertEqual(self._bill_counts(), (0, 0))        # sifar kesan DB

    def test_jnt_duplicate_differing_only_in_date_rejected(self):
        # "Nilai berbeza" bukan duit sahaja , tarikh hantar pun mengubah aging.
        df = _jnt_df([("TESTAWB0001", "100.00", "5.00"),
                      ("TESTAWB0001", "100.00", "5.00")])
        df.loc[1, ingest.J_DELIVERED] = "2026-06-25"
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_DUPLICATE_ROWS)

    def test_ninja_conflicting_duplicate_rejected(self):
        df = _nv_df([("NVMYTEST0001", "100.00", "95.00"),
                     ("NVMYTEST0001", "300.00", "290.00")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_DUPLICATE_ROWS)
        self.assertEqual(cm.exception.detected_type, "ninja")
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_ninja_identical_duplicate_deduped(self):
        df = _nv_df([("NVMYTEST0001", "100.00", "95.00"),
                     ("NVMYTEST0001", "100.00", "95.00")])
        self.assertEqual(ingest.ingest_ninja(df, "NVSOA-20260618.xlsx", self.conn), 1)

    def test_dhl_conflicting_duplicate_rejected(self):
        p = _dhl_parsed([("TESTREF001", "397.00"), ("TESTREF001", "157.00")])
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(p, "advice.xls", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_DUPLICATE_ROWS)
        self.assertEqual(cm.exception.detected_type, "dhl")
        self.assertEqual(self._bill_counts(), (0, 0))

    def test_dhl_identical_duplicate_deduped(self):
        p = _dhl_parsed([("TESTREF001", "397.00"), ("TESTREF001", "397.00")])
        self.assertEqual(ingest.ingest_dhl(p, "advice.xls", self.conn), 1)

    def test_dedup_keeps_original_order_and_is_idempotent(self):
        df = _jnt_df([("TESTAWB0002", "60.00", "3.00"),
                      ("TESTAWB0001", "100.00", "5.00"),
                      ("TESTAWB0002", "60.00", "3.00")])
        ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)
        ingest.ingest_jnt(df, "JTMYAAA-20260618.xlsx", self.conn)   # re-upload
        rows = self.conn.execute(text(
            "SELECT awb FROM cod_bill_lines ORDER BY awb")).fetchall()
        self.assertEqual([r[0] for r in rows], ["TESTAWB0001", "TESTAWB0002"])

    def test_ingest_bytes_logs_rejection(self):
        buf = io.BytesIO()
        _nv_df([("NVMYTEST0001", "100.00", "95.00"),
                ("NVMYTEST0001", "300.00", "290.00")]).to_excel(buf, index=False)
        res = ingest.ingest_bytes(buf.getvalue(), "NVSOA-20260618.xlsx", self.conn)
        self.assertIsNone(res.kind)
        self.assertEqual(res.reason, ingest.REASON_DUPLICATE_ROWS)
        self.assertEqual(self._bill_counts(), (0, 0))
        self.assertEqual(self.conn.execute(text(
            "SELECT COUNT(*) FROM ingest_rejections")).scalar(), 1)


class TestDuplicateGuardHelper(unittest.TestCase):
    def test_empty_rows_safe(self):
        self.assertEqual(ingest.guard_duplicate_rows("jnt", []), [])

    def test_unique_rows_pass_through_unchanged(self):
        rows = [{"awb": "A", "cod_amount": 1.0}, {"awb": "B", "cod_amount": 2.0}]
        self.assertEqual(ingest.guard_duplicate_rows("jnt", rows), rows)

    def test_message_counts_distinct_keys(self):
        rows = [{"awb": "A", "cod_amount": 1.0}, {"awb": "A", "cod_amount": 2.0},
                {"awb": "B", "cod_amount": 3.0}, {"awb": "B", "cod_amount": 4.0}]
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.guard_duplicate_rows("jnt", rows)
        self.assertIn("2 tracking number(s)", cm.exception.message)


# =====================================================================
# 25. Feed Wallet: dua lubang kecil.
#     (a) Baris tanpa Transaction ID (baris total/blank hujung export) dulu TIDAK
#         ditapis. txn_id ialah PK wallet_txns dan sel kosong jadi string "nan",
#         jadi SEMUA baris tanpa ID runtuh jadi SATU rekod "nan" yang bertimpa
#         timpa , kaunter tetap kira penuh, duit komisennya hilang.
#     (b) Teks status/type/source/nama disimpan mentah. SQL komisen banding teks
#         TEPAT, jadi satu ruang ekor (" Approved") buat transaksi tu hilang dari
#         kiraan secara senyap. Sekarang dikemas DI PINTU. Fixture SINTETIK.
# =====================================================================
class TestWalletHardening(_MoneyGuardBase):
    def _rows(self):
        return self.conn.execute(text(
            "SELECT txn_id, seller_name, txn_type, source, status "
            "FROM wallet_txns ORDER BY txn_id")).fetchall()

    def test_rows_without_txn_id_are_dropped(self):
        df = _wallet_df([("TXN1", "50.00"), (None, "60.00"), (None, "70.00")])
        self.assertEqual(ingest.ingest_wallet(df, "wallet.xlsx", self.conn), 1)
        self.assertEqual([r[0] for r in self._rows()], ["TXN1"])

    def test_blank_string_txn_id_also_dropped(self):
        df = _wallet_df([("TXN1", "50.00"), ("   ", "60.00")])
        self.assertEqual(ingest.ingest_wallet(df, "wallet.xlsx", self.conn), 1)

    def test_no_nan_sentinel_row_saved(self):
        # Bukti langsung lubang lama: sel ID kosong jadi string "nan" selepas
        # astype(str), jadi SEMUA baris tanpa ID runtuh jadi satu rekod "nan".
        df = _wallet_df([("TXN1", "50.00"), (float("nan"), "60.00"),
                         (float("nan"), "70.00")])
        self.assertEqual(ingest.ingest_wallet(df, "wallet.xlsx", self.conn), 1)
        ids = [r[0] for r in self._rows()]
        self.assertEqual(ids, ["TXN1"])
        for sentinel in ("nan", "NAN", "None", "NaT"):
            self.assertNotIn(sentinel, ids)

    def test_text_columns_are_trimmed(self):
        df = _wallet_df([("TXN1", "50.00")])
        df.loc[0, ingest.W_STATUS] = " Approved "
        df.loc[0, ingest.W_TYPE] = " IN "
        df.loc[0, ingest.W_SOURCE] = "Sales  "
        df.loc[0, ingest.W_SELLER] = "  Rekaan Stockist "
        ingest.ingest_wallet(df, "wallet.xlsx", self.conn)
        row = self._rows()[0]
        self.assertEqual(row[1], "Rekaan Stockist")
        self.assertEqual(row[2], "IN")
        self.assertEqual(row[3], "Sales")
        self.assertEqual(row[4], "Approved")

    def test_blank_text_stays_null_not_nan_string(self):
        df = _wallet_df([("TXN1", "50.00")])
        df.loc[0, ingest.W_SELLER] = None
        ingest.ingest_wallet(df, "wallet.xlsx", self.conn)
        self.assertIsNone(self._rows()[0][1])

    def test_clean_wallet_values_unchanged(self):
        # Nilai yang memang bersih TIDAK berubah langsung (strip bukan penulisan
        # semula data).
        ingest.ingest_wallet(_wallet_df([("TXN1", "50.00")]), "w.xlsx", self.conn)
        self.assertEqual(self._rows()[0],
                         ("TXN1", "Rekaan Stockist", "IN", "Sales", "Approved"))


# =====================================================================
# 26. Header jadual PDF DHL dibaca ikut NAMA, bukan POSISI.
#     Lubang yang ditutup: kod dulu tampal senarai 7 nama TETAP atas baris data.
#     Satu lajur baru yang DHL sisip di tengah akan menggeser semua nama satu
#     lajur , lajur duit dibaca dari sel sebelahnya, amaun salah masuk tanpa
#     bunyi. Sekarang header datang dari fail itu sendiri (nama ringkas
#     diterjemah ke nama kanonik advice), dan nama yang tak dikenali jatuh ke
#     guard lajur = reason missing_columns. Fixture SINTETIK.
# =====================================================================
_DHL_PDF_REAL_HEAD = ["No.", "Delivery Date", "DHL Parcel ID", "Customer Ref.ID",
                      "Consignee Name", "Deposit Date", "CoD Amount", ""]


class TestDhlPdfHeaderMap(unittest.TestCase):
    def test_short_names_canonicalised_in_place(self):
        out = ingest._dhl_pdf_header(_DHL_PDF_REAL_HEAD)
        self.assertEqual(len(out), len(_DHL_PDF_REAL_HEAD))   # posisi dikekalkan
        self.assertEqual(out[3], ingest.D_REF)                # Ref.ID -> kanonik
        self.assertEqual(out[6], ingest.D_COD)

    def test_inserted_column_shifts_money_index(self):
        # Lajur baru disisip SEBELUM lajur duit: indeks duit mesti ikut fail.
        head = ["No.", "Delivery Date", "DHL Parcel ID", "Customer Ref.ID",
                "Consignee Name", "Service Type", "Deposit Date", "CoD Amount"]
        out = ingest._dhl_pdf_header(head)
        self.assertEqual(out.index(ingest.D_COD), 7)          # bukan 6
        self.assertEqual(out[5], "Service Type")              # nama asing kekal

    def test_unknown_name_kept_as_is(self):
        self.assertEqual(ingest._dhl_pdf_header(["Lajur Baru"]), ["Lajur Baru"])

    def test_empty_and_none_header_safe(self):
        self.assertEqual(ingest._dhl_pdf_header(None), [])
        self.assertEqual(ingest._dhl_pdf_header([None, "  "]), ["", ""])


class TestDhlPdfHeaderDrivesMoney(_MoneyGuardBase):
    def _parsed_with_extra_column(self):
        """Advice dengan satu lajur baru disisip sebelum lajur duit (bentuk
        sama macam yang parse_dhl_pdf akan keluarkan untuk PDF begitu)."""
        head = ingest._dhl_pdf_header(
            ["No.", "Delivery Date", "DHL Parcel ID", "Customer Ref.ID",
             "Consignee Name", "Service Type", "Deposit Date", "CoD Amount"])
        return {"meta": {"Payment Reference": "TESTPAYREF001",
                         "Payment Date": "20260618"},
                "header": head,
                "rows": [["1", "18.06.2026", "TESTPARCEL", "TESTREF001",
                          "Nama Rekaan", "EXPRESS", "19.06.2026", "397.00"]]}

    def test_money_read_from_named_column_not_position(self):
        # Dengan senarai posisi TETAP lama, "397.00" duduk di indeks 7 sedangkan
        # kod cari indeks 6 ("EXPRESS") = COD jadi RM0. Sekarang betul.
        n = ingest.ingest_dhl(self._parsed_with_extra_column(), "advice.pdf",
                              self.conn)
        self.assertEqual(n, 1)
        row = self.conn.execute(text(
            "SELECT awb, cod_amount, delivered_date FROM cod_bill_lines")).fetchone()
        self.assertEqual(row[0], "TESTREF001")
        self.assertEqual(row[1], 397.0)
        self.assertEqual(row[2], "2026-06-18 00:00:00")

    def test_unrecognised_money_column_rejected_as_missing(self):
        # Nama lajur duit berubah jadi sesuatu yang kita tak kenal = TOLAK,
        # bukan baca dari lajur sebelah.
        p = self._parsed_with_extra_column()
        p["header"] = [c if c != ingest.D_COD else "Amount Paid"
                       for c in p["header"]]
        with self.assertRaises(ingest.IngestError) as cm:
            ingest.ingest_dhl(p, "advice.pdf", self.conn)
        self.assertEqual(cm.exception.reason, ingest.REASON_MISSING_COLUMNS)
        self.assertIn(ingest.D_COD, cm.exception.message)
        self.assertEqual(self._bill_counts(), (0, 0))


@unittest.skipUnless(os.path.exists(_PDF_TWIN) and os.path.exists(_PDF_SOLO),
                     "sampel DHL PDF (gitignored) tiada, langkau")
class TestDhlPdfRealSampleTotals(unittest.TestCase):
    """Gate mutlak: sampel PDF SEBENAR mesti kekal reason=ok, dan jumlah kawalan
    yang dibaca mesti sepadan dengan jumlah barisnya."""

    def _ingest(self, path):
        eng = create_engine("sqlite://")
        conn = eng.connect()
        db.init_db(conn)
        with open(path, "rb") as fh:
            res = ingest.ingest_bytes(fh.read(), os.path.basename(path), conn)
        rows = conn.execute(text(
            "SELECT COUNT(*), ROUND(SUM(cod_amount),2) FROM cod_bill_lines")
        ).fetchone()
        conn.close()
        return res, rows

    def test_real_pdf_totals_are_read(self):
        with open(_PDF_SOLO, "rb") as fh:
            parsed = ingest.parse_dhl_pdf(fh.read())
        t = parsed["totals"]
        self.assertEqual(t["deduction"], 0.00)
        self.assertEqual(t["sum_total"], 3162.00)
        self.assertEqual(t["payment_amount"], 3162.00)
        # Header datang dari fail, sudah dikanonkan ikut nama.
        self.assertIn(ingest.D_COD, parsed["header"])
        self.assertIn(ingest.D_REF, parsed["header"])

    def test_real_pdfs_still_ingest_ok(self):
        res, rows = self._ingest(_PDF_SOLO)
        self.assertEqual((res.kind, res.reason, res.rows), ("dhl", ingest.REASON_OK, 16))
        self.assertEqual(rows, (16, 3162.00))
        res, rows = self._ingest(_PDF_TWIN)
        self.assertEqual((res.kind, res.reason, res.rows), ("dhl", ingest.REASON_OK, 1))
        self.assertEqual(rows, (1, 397.00))


if __name__ == "__main__":
    unittest.main(verbosity=2)
