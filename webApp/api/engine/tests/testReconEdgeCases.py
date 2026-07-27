"""
testReconEdgeCases.py , penggera kekal untuk kes tepi enjin recon.

KENAPA WUJUD (baca ni dulu)
---------------------------
Repo ada TIGA enjin recon yang sepatutnya bagi jawapan SAMA:
  E1  reconcile.py   (pandas, RUJUKAN KEBENARAN)
  E2  reconSql.py    (SQL, dua dialek: sqlite dev + postgres prod)
  E3  webApp/lib/recon.ts (TypeScript, port cabang postgres E2)

Sebelum fail ni wujud, TIADA satu pun ujian automatik yang banding E1 lawan E2:
harness parity rasmi (scripts/parityDump.py) import reconSql sahaja, jadi E2 lawan
E3 boleh "LULUS" atas nombor yang bercanggah dengan rujukan kebenaran. Audit
reconTrust (2026-07-27) tangkap 3 divergen sebenar sebab lubang tu. Fail ni tutup
lubang: fixture sqlite SINTETIK kecil dibina dalam tempdir, kedua dua enjin Python
dijalankan atasnya, dan hasilnya dibanding BARIS DEMI BARIS (bukan agregat).

"Apa maksudnya": ni penggera kebakaran untuk kes duit yang jarang berlaku tapi
mahal. Kalau sesiapa ubah satu enjin tanpa ubah yang lain, ujian ni menjerit.

SEMUA data di sini REKAAN (order TEST-*, tracking 77xxxxxxxx). Tiada nilai
sebenar, repo public.

Jalan: cd webApp && python3 api/engine/tests/testReconEdgeCases.py
"""

import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

# Tarikh rujukan aging DIBEKUKAN sebelum db diimport (db.TODAY dibaca masa import).
os.environ["RECON_TODAY"] = "2026-06-18"

# Enjin recon (reconcile.py, reconSql.py, db.py) duduk di ROOT repo, EMPAT paras
# naik: tests -> engine -> api -> webApp -> root. Sengaja TIDAK guna salinan
# api/engine (salinan tu untuk function ingest Vercel, bukan laluan recon).
ROOT = Path(__file__).resolve().parents[4]
# Paksa import dari ROOT walaupun runner lain (cth unittest discover yang muat
# testIngestParsers dulu) sudah cache modul 'db'/'ingest' dari salinan api/engine:
# buang cache dan letak ROOT di kedudukan pertama sys.path.
for _mod in ("db", "ingest", "reconcile", "reconSql"):
    sys.modules.pop(_mod, None)
while str(ROOT) in sys.path:
    sys.path.remove(str(ROOT))
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402

import db          # noqa: E402
import reconSql    # noqa: E402
import reconcile   # noqa: E402

# Sanity: kita betul betul import enjin ROOT, bukan salinan lain.
assert Path(db.__file__).resolve().parent == ROOT, db.__file__

PENDING_DAYS = db.REMIT_PENDING_DAYS          # 14
CUTOFF = "2026-06-03 00:00:00"                # TODAY - 15 hari
BILL_A = "TESTBILL-A"
BILL_B = "TESTBILL-B"
SELLER = "TEST STOKIS"
DELIVERED = "2026-06-11 10:00:00"


# =====================================================================
# Fixture sintetik
# ---------------------------------------------------------------------
# ORDERS: (order_id, order_date, status, provider, payment, tracking, harga)
# LINES : (awb, bill_id, cod_amount)
# JANGKA: (order_id, awb) -> kategori yang KETIGA TIGA enjin mesti setuju,
#         untuk stream jnt.
# =====================================================================
JNT = "J&T Express"
DHL = "DHL eCommerce"
COMPLETED, RETURNED, REJECTED = "Completed", "Returned", "Rejected"

ORDERS = [
    # ---- (A) Sempadan aging, tarikh KANONIK sahaja (tiada baris bil) ----
    ("TEST-AGE-MUDA", "2026-06-15 10:00:00", COMPLETED, JNT, "COD", "7710000001", 150.0),
    ("TEST-AGE-TUA", "2026-04-01 10:00:00", COMPLETED, JNT, "COD", "7710000002", 150.0),
    ("TEST-AGE-CUTOFF15", CUTOFF, COMPLETED, JNT, "COD", "7710000003", 150.0),
    ("TEST-AGE-CUTOFF14", "2026-06-04 00:00:00", COMPLETED, JNT, "COD", "7710000004", 150.0),
    ("TEST-AGE-NULL", None, COMPLETED, JNT, "COD", "7710000005", 150.0),

    # ---- (C) Sempadan pembundaran sen ----
    # .125 dan .625 = seri TEPAT pada separuh sen. Python round() lama bundar
    # half-to-EVEN (100.12), SQL bundar half-UP (100.13). Keputusan owner: half-up.
    ("TEST-BUNDAR-A", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7720000001", 100.125),
    ("TEST-BUNDAR-B", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7720000002", 100.125),
    ("TEST-BUNDAR-C", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7720000003", 100.625),
    ("TEST-BUNDAR-KAWALAN", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7720000004", 100.0),
    ("TEST-BUNDAR-FLOAT", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7720000005", 0.1 + 0.2),

    # ---- (B) AWB dikenali tapi order LUAR SKOP stream jnt ----
    # Order ni COD tapi naik DHL, jadi ia bukan sebahagian stream jnt. Baris bil
    # J&T yang AWB nya padan tracking order luar skop = match_luar_skop (benign),
    # BUKAN duit_hantu (duit yang tiada tuannya).
    ("TEST-LUARSKOP-DIGIT", "2026-06-10 10:00:00", COMPLETED, DHL, "COD", "7730000001", 100.0),
    # Tracking 'none' huruf KECIL. reconcile.py buang sentinel ikut padanan
    # LITERAL {"NAN","NONE",""} (tiada upper/trim) masa bina all_trk, jadi 'none'
    # KEKAL tracking dikenali. Ini punca divergen #2 audit reconTrust.
    ("TEST-LUARSKOP-SENTINEL", "2026-06-10 10:00:00", COMPLETED, DHL, "COD", "none", 100.0),
    # Tracking 'NONE' huruf BESAR = sentinel LITERAL, memang dibuang semua enjin.
    ("TEST-LUARSKOP-NONEBESAR", "2026-06-10 10:00:00", COMPLETED, DHL, "COD", "NONE", 100.0),

    # ---- (D) Kes yang SEMUA enjin sudah setuju = penjaga regresi ----
    ("TEST-BIL-RM0", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7740000001", 150.0),
    ("TEST-PECAH", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7740000002", 100.0),
    ("TEST-STATUS-RETURNED", "2026-06-10 10:00:00", RETURNED, JNT, "COD", "7740000003", 100.0),
    ("TEST-STATUS-REJECTED", "2026-06-10 10:00:00", REJECTED, JNT, "COD", "7740000004", 100.0),
    ("TEST-STATUS-TRANSIT", "2026-06-10 10:00:00", "In Transit", JNT, "COD", "7740000005", 100.0),
    # Sentinel DALAM skop: tracking 'NONE' tak boleh dikira AWB sah (D4).
    ("TEST-SENTINEL-INSKOP", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "NONE", 100.0),
    # AWB dikongsi dua order: duit satu parcel tak boleh tally berganda.
    ("TEST-AWBKONGSI-1", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7750000001", 100.0),
    ("TEST-AWBKONGSI-2", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7750000001", 100.0),

    # ---- Prepaid (CHIP), padan ikut order_id ----
    ("TEST-PREPAID-BUNDAR", "2026-06-10 10:00:00", COMPLETED, JNT, "CHIP", "7760000001", 100.125),
    ("TEST-PREPAID-KAWALAN", "2026-06-10 10:00:00", COMPLETED, JNT, "CHIP", "7760000002", 100.0),
]

LINES = [
    ("7720000001", BILL_A, 100.13),        # BUNDAR-A  , half-up = tally
    ("7720000002", BILL_A, 100.12),        # BUNDAR-B  , half-up = mismatch
    ("7720000003", BILL_A, 100.63),        # BUNDAR-C  , half-up = tally
    ("7720000004", BILL_A, 100.0),         # kawalan
    ("7720000005", BILL_A, 0.30),          # kawalan artifak float
    ("7730000001", BILL_A, 100.0),         # AWB = tracking order luar skop (digit)
    ("none", BILL_A, 100.0),               # AWB = tracking order luar skop (sentinel kecil)
    ("NONE", BILL_A, 100.0),               # AWB sentinel LITERAL, tiada tuan sah
    ("7730000009", BILL_A, 100.0),         # tiada order langsung = duit hantu
    ("7740000001", BILL_A, 0.0),           # bil RM0 untuk order RM150
    ("7740000002", BILL_A, 60.0),          # bil pecah, bhg 1 (order RM100)
    ("7740000012", BILL_B, 40.0),          # bil pecah, bhg 2 (AWB lain, tiada order)
    ("7740000003", BILL_A, 100.0),         # order Returned
    ("7740000004", BILL_A, 100.0),         # order Rejected
    ("7740000005", BILL_A, 100.0),         # order In Transit
    ("7750000001", BILL_A, 100.0),         # AWB dikongsi 2 order
]

PREPAID = [
    # (gateway, order_ref, amount)
    ("chip", "TEST-PREPAID-BUNDAR", 100.13),
    ("chip", "TEST-PREPAID-KAWALAN", 100.0),
    ("chip", "TEST-PREPAID-HANTU", 55.0),   # bayaran tanpa order = duit_hantu
]

# Kategori yang DIJANGKA untuk stream jnt. Kunci = (order_id, awb).
JANGKA_JNT = {
    ("TEST-AGE-MUDA", ""): "belum_remit",
    ("TEST-AGE-TUA", ""): "hilang_lewat",
    ("TEST-AGE-CUTOFF15", ""): "hilang_lewat",
    ("TEST-AGE-CUTOFF14", ""): "belum_remit",
    ("TEST-AGE-NULL", ""): "belum_remit",

    ("TEST-BUNDAR-A", "7720000001"): "tally",
    ("TEST-BUNDAR-B", "7720000002"): "amount_mismatch",
    ("TEST-BUNDAR-C", "7720000003"): "tally",
    ("TEST-BUNDAR-KAWALAN", "7720000004"): "tally",
    ("TEST-BUNDAR-FLOAT", "7720000005"): "tally",

    ("", "7730000001"): "match_luar_skop",
    ("", "none"): "match_luar_skop",
    ("", "NONE"): "duit_hantu",
    ("", "7730000009"): "duit_hantu",

    ("TEST-BIL-RM0", "7740000001"): "amount_mismatch",
    ("TEST-PECAH", "7740000002"): "amount_mismatch",
    ("", "7740000012"): "duit_hantu",
    ("TEST-STATUS-RETURNED", "7740000003"): "duit_masuk_order_returned",
    ("TEST-STATUS-REJECTED", "7740000004"): "duit_masuk_order_rejected",
    ("TEST-STATUS-TRANSIT", "7740000005"): "in_bil_tapi_intransit",
    ("TEST-SENTINEL-INSKOP", ""): "takde_awb_jnt",
    ("TEST-AWBKONGSI-1", "7750000001"): "amount_mismatch",
    ("TEST-AWBKONGSI-2", "7750000001"): "amount_mismatch",
}

JANGKA_CHIP = {
    ("TEST-PREPAID-BUNDAR", "TEST-PREPAID-BUNDAR"): "tally",
    ("TEST-PREPAID-KAWALAN", "TEST-PREPAID-KAWALAN"): "tally",
    ("", "TEST-PREPAID-HANTU"): "duit_hantu",
}


def _sqlite_url(path):
    return "sqlite:///" + str(path)


def buat_fixture(path, orders=ORDERS, lines=LINES, prepaid=PREPAID):
    """Bina DB sqlite sintetik lengkap di `path` (skema sebenar db.SCHEMA)."""
    eng = create_engine(_sqlite_url(path))
    conn = eng.connect()
    db.init_db(conn)
    conn.close()
    eng.dispose()

    c = sqlite3.connect(str(path))
    cur = c.cursor()
    for bid in (BILL_A, BILL_B):
        cur.execute(
            "INSERT INTO cod_bills (bill_id, courier, settlement_date, source_file,"
            " ingested_at) VALUES (?,?,?,?,?)",
            (bid, JNT, "2026-06-12", "testFixture.xlsx", "2026-06-18 00:00:00"))
    for oid, odate, status, prov, pay, trk, price in orders:
        cur.execute(
            "INSERT INTO orders (order_id, order_date, status, seller_name,"
            " payment_method, shipping_provider, tracking, selling_price,"
            " sales_commission, skus, item_count, source_file, ingested_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (oid, odate, status, SELLER, pay, prov, trk, price, 0.0, None, 1,
             "testFixture.xlsx", "2026-06-18 00:00:00"))
    for awb, bid, cod in lines:
        cur.execute(
            "INSERT INTO cod_bill_lines (awb, bill_id, cod_amount, fee,"
            " delivered_date, pickup_date, source_file, ingested_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (awb, bid, cod, 1.0, DELIVERED, "2026-06-09 10:00:00",
             "testFixture.xlsx", "2026-06-18 00:00:00"))
    for gw, ref, amt in prepaid:
        cur.execute(
            "INSERT INTO prepaid_payments (gateway, order_ref, amount, fee, status,"
            " paid_on, settled_on, statement_id, source_file, ingested_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (gw, ref, amt, 0.0, "paid", "2026-06-11 10:00:00", None,
             "TESTSTMT-1", "testFixture.xlsx", "2026-06-18 00:00:00"))
    c.commit()
    c.close()


# =====================================================================
# Pembaca hasil enjin
# =====================================================================
def _s(v):
    """Normalisasi nilai ke string stabil merentas pandas / sqlite."""
    if v is None:
        return ""
    try:
        import pandas as pd
        if not isinstance(v, str) and pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    return str(v).strip()


def hasil_e1(conn, courier):
    m, _lines, _info = reconcile.reconcile(conn, courier=courier)
    return sorted((_s(r.order_id), _s(r.awb), _s(r.kategori)) for r in m.itertuples())


def hasil_e1_prepaid(conn, gateway):
    m, _lines, _info = reconcile.reconcile_prepaid(conn, gateway=gateway)
    return sorted((_s(r.order_id), _s(r.awb), _s(r.kategori)) for r in m.itertuples())


def hasil_e2(conn, kind, key):
    reconSql._build_tmp_m(conn, kind, key, PENDING_DAYS)
    df = reconSql._read(conn, "SELECT order_id, awb, kategori FROM tmp_m")
    conn.rollback()
    return sorted((_s(r.order_id), _s(r.awb), _s(r.kategori)) for r in df.itertuples())


def peta(rows):
    """[(order_id, awb, kategori)] -> {(order_id, awb): kategori}."""
    return {(o, a): k for o, a, k in rows}


class FixtureCase(unittest.TestCase):
    """Base: satu fixture sqlite dalam tempdir, dibuang selepas kelas habis."""

    orders = ORDERS
    lines = LINES
    prepaid = PREPAID

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="reconEdge_")
        cls.path = Path(cls._tmp.name) / "fixture.db"
        buat_fixture(cls.path, cls.orders, cls.lines, cls.prepaid)
        cls.engine = create_engine(_sqlite_url(cls.path))

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()
        cls._tmp.cleanup()

    def setUp(self):
        self.conn = self.engine.connect()
        self.addCleanup(self.conn.close)


class TestParityE1E2(FixtureCase):
    """E1 (rujukan) lawan E2 (SQL) mesti IDENTIK baris demi baris, tiap stream."""

    def _banding(self, kind, key):
        e1 = hasil_e1_prepaid(self.conn, key) if kind == "prepaid" \
            else hasil_e1(self.conn, key)
        e2 = hasil_e2(self.conn, kind, key)
        if e1 != e2:
            hanya1 = [r for r in e1 if r not in e2]
            hanya2 = [r for r in e2 if r not in e1]
            self.fail(
                f"DIVERGEN stream {key}:\n"
                f"  hanya E1 (reconcile.py): {hanya1}\n"
                f"  hanya E2 (reconSql.py) : {hanya2}")

    def test_jnt_parity(self):
        self._banding("courier", "jnt")

    def test_dhl_parity(self):
        self._banding("courier", "dhl")

    def test_ninja_parity(self):
        self._banding("courier", "ninja")

    def test_chip_parity(self):
        self._banding("prepaid", "chip")


class TestKategoriDijangka(FixtureCase):
    """Bukan sekadar dua enjin SETUJU, tapi setuju pada jawapan yang BETUL."""

    def _semak(self, rows, jangka, label):
        got = peta(rows)
        salah = {k: (jangka[k], got.get(k)) for k in jangka
                 if got.get(k) != jangka[k]}
        self.assertEqual(salah, {}, f"{label}: (jangka, dapat) tak padan")

    def test_e1_kategori_jnt(self):
        self._semak(hasil_e1(self.conn, "jnt"), JANGKA_JNT, "E1 jnt")

    def test_e2_kategori_jnt(self):
        self._semak(hasil_e2(self.conn, "courier", "jnt"), JANGKA_JNT, "E2 jnt")

    def test_e1_kategori_chip(self):
        self._semak(hasil_e1_prepaid(self.conn, "chip"), JANGKA_CHIP, "E1 chip")

    def test_e2_kategori_chip(self):
        self._semak(hasil_e2(self.conn, "prepaid", "chip"), JANGKA_CHIP, "E2 chip")


class TestPembundaranHalfUp(FixtureCase):
    """FIX A , seri separuh sen mesti bundar NAIK (keputusan owner)."""

    def test_seri_125_naik_jadi_tally(self):
        # 100.125 lawan bil 100.13: half-up = dua dua 100.13 = tally.
        # Python round() lama (half-to-even) bagi 100.12 = amount_mismatch.
        self.assertEqual(peta(hasil_e1(self.conn, "jnt"))
                         [("TEST-BUNDAR-A", "7720000001")], "tally")

    def test_seri_125_naik_jadi_mismatch_sisi_lain(self):
        self.assertEqual(peta(hasil_e1(self.conn, "jnt"))
                         [("TEST-BUNDAR-B", "7720000002")], "amount_mismatch")

    def test_seri_625_naik(self):
        self.assertEqual(peta(hasil_e1(self.conn, "jnt"))
                         [("TEST-BUNDAR-C", "7720000003")], "tally")

    def test_prepaid_pakai_pembundaran_sama(self):
        self.assertEqual(peta(hasil_e1_prepaid(self.conn, "chip"))
                         [("TEST-PREPAID-BUNDAR", "TEST-PREPAID-BUNDAR")], "tally")


class TestLuarSkopBukanDuitHantu(FixtureCase):
    """FIX B , AWB dikenali tapi ordernya luar skop = match_luar_skop (benign)."""

    def test_e1_sentinel_kecil_luar_skop(self):
        self.assertEqual(peta(hasil_e1(self.conn, "jnt"))[("", "none")],
                         "match_luar_skop")

    def test_e2_sentinel_kecil_luar_skop(self):
        # SEBELUM fix: E2 buang 'none' dari set tracking dikenali (UPPER+TRIM)
        # jadi baris bil ni dilabel duit_hantu, membesarkan page Ghost money.
        self.assertEqual(peta(hasil_e2(self.conn, "courier", "jnt"))[("", "none")],
                         "match_luar_skop")

    def test_sentinel_besar_kekal_duit_hantu(self):
        # 'NONE' HURUF BESAR = sentinel literal reconcile.py, kekal duit_hantu
        # dalam DUA DUA enjin (penjaga regresi D4).
        self.assertEqual(peta(hasil_e1(self.conn, "jnt"))[("", "NONE")], "duit_hantu")
        self.assertEqual(peta(hasil_e2(self.conn, "courier", "jnt"))[("", "NONE")],
                         "duit_hantu")


# =====================================================================
# GAP DIDOKUMEN , tarikh bukan kanonik
# ---------------------------------------------------------------------
# Owner putuskan: tarikh dikemas di PINTU INGEST, enjin recon TIDAK diubah.
# Ujian ni mengunci sebab keputusan tu: selagi order_date bukan kanonik boleh
# masuk DB, E1 dan E2 memang akan bercanggah. Kalau suatu hari enjin diselaraskan
# untuk kes ni, ujian ni akan GAGAL , itu isyarat padam ujian ni, bukan bug.
# =====================================================================
GAP_ORDERS = [
    ("TEST-GAP-KANONIK", "2026-06-01 10:00:00", COMPLETED, JNT, "COD", "7790000001", 100.0),
    ("TEST-GAP-KOSONG", "", COMPLETED, JNT, "COD", "7790000002", 100.0),
]


class TestGapTarikhBukanKanonik(FixtureCase):
    orders = GAP_ORDERS
    lines = []
    prepaid = []

    def test_tarikh_kanonik_selari(self):
        p1 = peta(hasil_e1(self.conn, "jnt"))
        p2 = peta(hasil_e2(self.conn, "courier", "jnt"))
        kunci = ("TEST-GAP-KANONIK", "")
        self.assertEqual(p1[kunci], "hilang_lewat")
        self.assertEqual(p2[kunci], "hilang_lewat")

    def test_rentetan_kosong_masih_bercanggah_sebab_itu_ingest_menapis(self):
        p1 = peta(hasil_e1(self.conn, "jnt"))
        p2 = peta(hasil_e2(self.conn, "courier", "jnt"))
        kunci = ("TEST-GAP-KOSONG", "")
        # E1: pandas parse '' -> NaT -> tiada umur -> belum_remit.
        self.assertEqual(p1[kunci], "belum_remit")
        # E2: perbandingan teks '' <= cutoff = benar -> hilang_lewat.
        self.assertEqual(p2[kunci], "hilang_lewat")
        # Sebab itulah ingest.py WAJIB tulis NULL (bukan ''), diuji dalam
        # testIngestParsers.py (kelas TestFighterDateGuard).


# =====================================================================
# GAP DIDOKUMEN , dialek sqlite lawan postgres pada digit ke-3
# ---------------------------------------------------------------------
# Selepas fix half-up, E1 dan E2 selari pada seri sen SEBENAR (.125, .625).
# Yang TINGGAL: nilai dengan digit ke-3 selepas titik yang TAK boleh diwakili
# tepat dalam float (contoh 100.005 sebenarnya tersimpan 100.00499999...).
#   reconcile._r2 + Postgres ROUND(CAST AS numeric)  -> 100.01 (ikut teks)
#   SQLite ROUND(x, 2)                               -> 100.00 (ikut double)
# reconcile.py sengaja ikut semantik POSTGRES sebab itu dialek PRODUKSI; sqlite
# cuma dev lokal. Kalau suatu hari sqlite diselaraskan, ujian ni GAGAL , itu
# isyarat padam ujian ni, bukan bug.
# =====================================================================
GAP_SEN_ORDERS = [
    ("TEST-SEN3", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7780000001", 100.005),
]
GAP_SEN_LINES = [("7780000001", BILL_A, 100.00)]


class TestGapDialekSen(FixtureCase):
    orders = GAP_SEN_ORDERS
    lines = GAP_SEN_LINES
    prepaid = []

    def test_digit_ketiga_masih_beza_ikut_dialek(self):
        kunci = ("TEST-SEN3", "7780000001")
        # E1 ikut teks '100.005' -> 100.01, tak sama 100.00.
        self.assertEqual(peta(hasil_e1(self.conn, "jnt"))[kunci], "amount_mismatch")
        # E2 sqlite bundar double mentah 100.00499... -> 100.00, jadi tally.
        self.assertEqual(peta(hasil_e2(self.conn, "courier", "jnt"))[kunci], "tally")


if __name__ == "__main__":
    unittest.main(verbosity=2)
