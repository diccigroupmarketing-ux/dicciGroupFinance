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


if __name__ == "__main__":
    unittest.main(verbosity=2)
