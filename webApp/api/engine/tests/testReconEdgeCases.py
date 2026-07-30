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

    # ---- (E) Baris bil RM0 BUKAN bukti duit masuk ----
    # Bil courier bukan hanya senarai duit dikutip: ia pun ada baris caj RM0
    # (contoh baris Returned to Sender Ninja Van , parcel dipulangkan, sifar duit
    # masuk). Baris macam tu TAK boleh mengesahkan order. Order jatuh BALIK ke
    # kategori ikut aging / status, sama macam order yang memang tiada bil.
    ("TEST-RM0-MUDA", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", "7770000001", 150.0),
    ("TEST-RM0-TUA", "2026-04-01 10:00:00", COMPLETED, JNT, "COD", "7770000002", 150.0),
    ("TEST-RM0-RETURNED", "2026-06-10 10:00:00", RETURNED, JNT, "COD", "7770000003", 150.0),
    ("TEST-RM0-REJECTED", "2026-06-10 10:00:00", REJECTED, JNT, "COD", "7770000004", 150.0),
    ("TEST-RM0-TRANSIT", "2026-06-10 10:00:00", "In Transit", JNT, "COD", "7770000005", 150.0),
    # cod_amount NULL dan NEGATIF pun bukan bukti duit masuk (NULL > 0 bukan
    # TRUE dalam SQL; NaN > 0 False dalam pandas , dua dua enjin sepakat).
    ("TEST-RM0-NULLAMT", "2026-04-01 10:00:00", COMPLETED, JNT, "COD", "7770000006", 150.0),
    ("TEST-RM0-NEGATIF", "2026-04-01 10:00:00", COMPLETED, JNT, "COD", "7770000007", 150.0),
    # KAWALAN: 1 sen tetap duit. Fix ni jangan sekali kali buang baris kecil.
    ("TEST-RM0-KAWALAN-SEN", "2026-04-01 10:00:00", COMPLETED, JNT, "COD", "7770000008", 0.01),

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
    ("7770000001", BILL_A, 0.0),           # RM0 + order Completed muda
    ("7770000002", BILL_A, 0.0),           # RM0 + order Completed tua
    ("7770000003", BILL_A, 0.0),           # RM0 + order Returned
    ("7770000004", BILL_A, 0.0),           # RM0 + order Rejected
    ("7770000005", BILL_A, 0.0),           # RM0 + order In Transit
    ("7770000006", BILL_A, None),          # cod_amount NULL
    ("7770000007", BILL_A, -50.0),         # cod_amount negatif
    ("7770000008", BILL_A, 0.01),          # kawalan: 1 sen = duit betul
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

    # Bil RM0 tak sahkan order: umur 8 hari (< 14) jadi ia balik ke belum_remit.
    # SEBELUM fix ia 'amount_mismatch', iaitu order dikira "ada dalam bil" walhal
    # sifar duit masuk , dan ia terlepas dari baldi aging.
    ("TEST-BIL-RM0", "7740000001"): "belum_remit",
    ("TEST-PECAH", "7740000002"): "amount_mismatch",
    ("", "7740000012"): "duit_hantu",
    ("TEST-STATUS-RETURNED", "7740000003"): "duit_masuk_order_returned",
    ("TEST-STATUS-REJECTED", "7740000004"): "duit_masuk_order_rejected",
    ("TEST-STATUS-TRANSIT", "7740000005"): "in_bil_tapi_intransit",
    ("TEST-SENTINEL-INSKOP", ""): "takde_awb_jnt",
    ("TEST-AWBKONGSI-1", "7750000001"): "amount_mismatch",
    ("TEST-AWBKONGSI-2", "7750000001"): "amount_mismatch",

    # Baris bil RM0 / NULL / negatif = order kembali ke laluan "takde bil".
    ("TEST-RM0-MUDA", "7770000001"): "belum_remit",
    ("TEST-RM0-TUA", "7770000002"): "hilang_lewat",
    ("TEST-RM0-RETURNED", "7770000003"): "returned",
    ("TEST-RM0-REJECTED", "7770000004"): "rejected",
    ("TEST-RM0-TRANSIT", "7770000005"): "pending",
    ("TEST-RM0-NULLAMT", "7770000006"): "hilang_lewat",
    ("TEST-RM0-NEGATIF", "7770000007"): "hilang_lewat",
    ("TEST-RM0-KAWALAN-SEN", "7770000008"): "tally",
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


class TestBilRm0BukanDuitMasuk(FixtureCase):
    """FIX C , baris bil RM0 tak boleh mengesahkan order sebagai duit masuk.

    Punca dunia sebenar: bil Ninja Van ada baris caj "Returned to Sender" dengan
    cod_amount 0. Sebelum fix, baris tu cukup untuk order dikira "ada dalam bil",
    jadi ia hilang dari baldi belum_remit / hilang_lewat (duit lewat tersorok)
    DAN dikira 'duit disahkan' oleh db.confirmed_paid_order_ids (botol dikira
    walhal duit tak pernah masuk).
    """

    def _dua_enjin(self, kunci, jangka):
        self.assertEqual(peta(hasil_e1(self.conn, "jnt"))[kunci], jangka,
                         f"E1 salah untuk {kunci}")
        self.assertEqual(peta(hasil_e2(self.conn, "courier", "jnt"))[kunci], jangka,
                         f"E2 salah untuk {kunci}")

    def test_rm0_completed_muda_jadi_belum_remit(self):
        self._dua_enjin(("TEST-RM0-MUDA", "7770000001"), "belum_remit")

    def test_rm0_completed_tua_jadi_hilang_lewat(self):
        # Ini kes paling mahal: order tua tanpa duit MESTI menjerit di baldi aging.
        self._dua_enjin(("TEST-RM0-TUA", "7770000002"), "hilang_lewat")

    def test_rm0_returned_bukan_duit_masuk_order_returned(self):
        # 'duit_masuk_order_returned' bermaksud DUIT masuk untuk order dipulangkan.
        # Baris RM0 = sifar duit, jadi ia cuma 'returned' biasa, bukan exception.
        self._dua_enjin(("TEST-RM0-RETURNED", "7770000003"), "returned")

    def test_rm0_rejected_bukan_duit_masuk_order_rejected(self):
        self._dua_enjin(("TEST-RM0-REJECTED", "7770000004"), "rejected")

    def test_rm0_transit_bukan_in_bil_tapi_intransit(self):
        self._dua_enjin(("TEST-RM0-TRANSIT", "7770000005"), "pending")

    def test_cod_amount_null_pun_bukan_bukti(self):
        self._dua_enjin(("TEST-RM0-NULLAMT", "7770000006"), "hilang_lewat")

    def test_cod_amount_negatif_pun_bukan_bukti(self):
        self._dua_enjin(("TEST-RM0-NEGATIF", "7770000007"), "hilang_lewat")

    def test_kawalan_satu_sen_kekal_duit(self):
        # Penjaga arah bertentangan: fix ni JANGAN buang baris bernilai kecil.
        self._dua_enjin(("TEST-RM0-KAWALAN-SEN", "7770000008"), "tally")

    def test_confirmed_paid_tolak_order_baris_rm0(self):
        # db.confirmed_paid_order_ids = titik sambungan TUNGGAL "duit disahkan"
        # (botol dikira, baldi confirmed). Order baris RM0 mesti TIADA di situ.
        paid = db.confirmed_paid_order_ids(self.conn)
        for oid in ("TEST-RM0-MUDA", "TEST-RM0-TUA", "TEST-RM0-RETURNED",
                    "TEST-RM0-NULLAMT", "TEST-RM0-NEGATIF", "TEST-BIL-RM0"):
            self.assertNotIn(oid, paid, f"{oid} tak sepatutnya dikira duit disahkan")
        # Kawalan: yang betul betul ada duit kekal disahkan.
        for oid in ("TEST-RM0-KAWALAN-SEN", "TEST-BUNDAR-A", "TEST-PECAH"):
            self.assertIn(oid, paid, f"{oid} sepatutnya kekal duit disahkan")


# =====================================================================
# GAP DIDOKUMEN , tracking berisi whitespace BUKAN space
# ---------------------------------------------------------------------
# Penemuan verify 2026-07-29. Tracking yang isinya cuma tab / newline / NBSP
# (\xa0) dilayan BERBEZA oleh dua enjin:
#   E1 (pandas): .str.strip() buang SEMUA whitespace Unicode termasuk \xa0,
#       jadi tracking jadi '' = sentinel. Order tak padan baris bil.
#   E2/E3 (SQL): TRIM() hanya buang SPACE (' '), jadi '\t' kekal "tracking
#       sebenar" dan JOIN ke baris bil BERJAYA , jadi 'tally'.
# Kesan: satu baris duit boleh dilabel 'tally' oleh app tapi 'match_luar_skop'
# oleh rujukan kebenaran. Belum ada kes sebenar dalam data (pintu ingest sepatutnya
# kemas whitespace), jadi ia DIDOKUMEN sebagai gap, bukan dibaiki di enjin , sama
# corak dengan TestGapDialekSen. Ujian ni MENGUNCI kelakuan semasa: kalau sesiapa
# ubah normalisasi sentinel mana mana enjin, ujian ni menjerit dan keputusan boleh
# dibuat sedar sedar (fix di pintu ingest, atau selaraskan tiga tiga enjin).
# =====================================================================
WS_TRACKINGS = ["\t", "\n", "\xa0"]
GAP_WS_ORDERS = [
    (f"TEST-WS-{nama}", "2026-06-10 10:00:00", COMPLETED, JNT, "COD", trk, 100.0)
    for nama, trk in zip(("TAB", "NEWLINE", "NBSP"), WS_TRACKINGS)
]
GAP_WS_LINES = [(trk, BILL_A, 100.0) for trk in WS_TRACKINGS]


class TestGapSentinelWhitespace(FixtureCase):
    orders = GAP_WS_ORDERS
    lines = GAP_WS_LINES
    prepaid = []

    def _kira(self, rows):
        """kategori -> bilangan. Guna kiraan, bukan peta ikut AWB: _s() strip
        whitespace jadi kunci AWB runtuh sesama sendiri."""
        n = {}
        for _oid, _awb, kat in rows:
            n[kat] = n.get(kat, 0) + 1
        return n

    def test_e1_layan_whitespace_sebagai_sentinel(self):
        # E1: 3 order tak padan (takde AWB sah) + 3 baris duit jadi yatim tapi
        # BENIGN (trackingnya dikenali, cuma tak boleh jadi kunci padanan).
        self.assertEqual(self._kira(hasil_e1(self.conn, "jnt")),
                         {"takde_awb_jnt": 3, "match_luar_skop": 3})

    def test_e2_layan_whitespace_sebagai_tracking_sebenar(self):
        # E2: TRIM() SQL tak buang tab/newline/NBSP, jadi JOIN menjadi dan
        # ketiga tiga dilabel 'tally'. INI GAP, bukan kelakuan yang diingini.
        self.assertEqual(self._kira(hasil_e2(self.conn, "courier", "jnt")),
                         {"tally": 3})

    def test_gap_ni_memang_divergen_e1_lawan_e2(self):
        # Penegasan eksplisit supaya niat ujian jelas: ini SATU SATUNYA tempat
        # dalam fail ni yang E1 dan E2 SENGAJA dibenarkan bercanggah pada duit.
        self.assertNotEqual(hasil_e1(self.conn, "jnt"),
                            hasil_e2(self.conn, "courier", "jnt"))


# =====================================================================
# GAP DIDOKUMEN , tarikh bukan kanonik
# ---------------------------------------------------------------------
# Owner putuskan: tarikh dikemas di PINTU INGEST, enjin recon TIDAK diubah.
# Ujian ni mengunci sebab keputusan tu: selagi order_date bukan kanonik boleh
# masuk DB, E1 dan E2 memang akan bercanggah. Kalau suatu hari enjin diselaraskan
# untuk kes ni, ujian ni akan GAGAL , itu isyarat padam ujian ni, bukan bug.
#
# TAPI ada satu perkara yang BUKAN gap dan mesti kekal dijaga: MOD RUNTUH CASCADE.
# pd.to_datetime tanpa format="mixed" teka SATU format dari sel PERTAMA lalu paksa
# ke SELURUH lajur. Satu order bertarikh bukan kanonik di kedudukan pertama boleh
# jadikan SEMUA tarikh kanonik selepasnya NaT , order lain hilang umur dan tak
# pernah naik ke baldi hilang_lewat (duit lewat tersorok, senyap, seluruh lajur).
# Fix 2026-07-30: reconcile.py + reconSql.py guna db.parse_dt (format="mixed"),
# corak sama macam pintu ingest. Kelas ni menguji dua benda sekali:
#   (1) CASCADE ditutup , order LAIN kekal betul walau ada tarikh bukan kanonik
#   (2) gap yang tinggal (E1 lawan E2 pada tarikh teks) kekal didokumen
# PENTING, susunan yang mengena bukan susunan senarai ni: `m` dibina dari merge
# outer atas kunci tracking, jadi pandas SUSUN IKUT TRACKING. Sel pertama lajur
# order_date = order dengan tracking TERKECIL. Sebab itu order bukan kanonik
# sengaja diberi tracking '7790000000' (terkecil) , itulah yang jadikan dia sel
# yang diteka pandas, dan itulah yang dulu meracuni seluruh lajur.
# =====================================================================
GAP_ORDERS = [
    # Bukan kanonik + tracking TERKECIL = sel yang diteka = pemicu cascade lama.
    ("TEST-GAP-A-BUKANKANONIK", "01/07/2026", COMPLETED, JNT, "COD", "7790000000", 100.0),
    # Mangsa cascade: tarikh KANONIK dan memang tua. Mesti kekal hilang_lewat.
    ("TEST-GAP-B-TUA", "2026-04-01 10:00:00", COMPLETED, JNT, "COD", "7790000001", 100.0),
    # Mangsa cascade sisi lain: kanonik dan muda. Mesti kekal belum_remit.
    ("TEST-GAP-C-MUDA", "2026-06-15 10:00:00", COMPLETED, JNT, "COD", "7790000003", 100.0),
    ("TEST-GAP-KOSONG", "", COMPLETED, JNT, "COD", "7790000002", 100.0),
    # Tarikh songsang: '07/01/2026'. E1 baca 7 Julai 2026 (masa depan), E2 banding
    # TEKS lawan cutoff dan '0...' < '2...' jadi ia "lama". Penemuan verify 29 Jul.
    ("TEST-GAP-SONGSANG", "07/01/2026", COMPLETED, JNT, "COD", "7790000004", 100.0),
]


class TestGapTarikhBukanKanonik(FixtureCase):
    orders = GAP_ORDERS
    lines = []
    prepaid = []

    def test_cascade_tarikh_bukan_kanonik_tak_merosakkan_order_lain(self):
        """FIX B , inti kelas ni. Tarikh rosak di baris pertama TAK boleh
        menjangkiti umur order lain dalam lajur yang sama."""
        p1 = peta(hasil_e1(self.conn, "jnt"))
        # SEBELUM fix: pandas teka format dari '01/07/2026', semua tarikh ISO
        # jadi NaT, TEST-GAP-B-TUA (1 April, 78 hari) jatuh jadi 'belum_remit'
        # dan hilang dari baldi aging. Itulah kebocoran yang ujian ni jaga.
        self.assertEqual(p1[("TEST-GAP-B-TUA", "")], "hilang_lewat")
        self.assertEqual(p1[("TEST-GAP-C-MUDA", "")], "belum_remit")

    def test_cascade_e2_pun_selamat_dan_selari_dengan_e1(self):
        # E2 banding teks (tiada parsing) jadi ia memang immune pada cascade;
        # ujian ni mengunci yang E1 kini SETUJU dengannya pada tarikh kanonik.
        p1 = peta(hasil_e1(self.conn, "jnt"))
        p2 = peta(hasil_e2(self.conn, "courier", "jnt"))
        for kunci in (("TEST-GAP-B-TUA", ""), ("TEST-GAP-C-MUDA", "")):
            self.assertEqual(p1[kunci], p2[kunci], f"E1 lawan E2 tak selari: {kunci}")

    def test_tarikh_bukan_kanonik_sendiri_masih_diparse_sel_demi_sel(self):
        # '01/07/2026' dibaca 7 Januari 2026 (dayfirst=False), memang tua.
        # Ia kebetulan sama dengan jawapan teks E2, tapi kebetulan tu BUKAN
        # jaminan , lihat TEST-GAP-SONGSANG di bawah untuk kes ia terbelah.
        p1 = peta(hasil_e1(self.conn, "jnt"))
        p2 = peta(hasil_e2(self.conn, "courier", "jnt"))
        self.assertEqual(p1[("TEST-GAP-A-BUKANKANONIK", "")], "hilang_lewat")
        self.assertEqual(p2[("TEST-GAP-A-BUKANKANONIK", "")], "hilang_lewat")

    def test_cascade_lajur_umur_hari_paparan_pun_selamat(self):
        """FIX B (sisi kedua) , reconSql._umur_hari bina lajur 'Age (days)' yang
        finance BACA dalam jadual exception. Ia pun dulu terdedah pada cascade
        yang sama: satu tarikh bukan kanonik dalam senarai = umur SEMUA baris
        lain jadi kosong, jadi baris tua nampak macam takde umur."""
        s = reconSql.stream_summary(self.conn, "courier", "jnt", PENDING_DAYS)
        umur = dict(zip(s["aged"]["order_id"], s["aged"]["umur_hari"]))
        # 2026-06-18 00:00 tolak 2026-04-01 10:00 = 77 hari penuh (baki 14 jam
        # dibuang oleh .dt.days). Yang penting: NOMBOR, bukan NaN.
        self.assertEqual(umur.get("TEST-GAP-B-TUA"), 77)

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

    def test_tarikh_songsang_teks_masih_bercanggah(self):
        # GAP kedua (penemuan verify 29 Jul). '07/01/2026':
        #   E1 parse ikut sel -> 1 Julai 2026 -> MASA DEPAN -> belum_remit
        #   E2 banding TEKS lawan cutoff '2026-06-03...' -> '0' < '2' -> "lama"
        # Kesan sebenar: order tarikh teks boleh dikira lewat oleh app tapi tidak
        # oleh rujukan kebenaran. Ubatnya di PINTU INGEST (tulis ISO), bukan di
        # enjin. Kalau suatu hari ia diselaraskan, ujian ni GAGAL , itu isyarat
        # padam ujian ni, bukan bug.
        p1 = peta(hasil_e1(self.conn, "jnt"))
        p2 = peta(hasil_e2(self.conn, "courier", "jnt"))
        kunci = ("TEST-GAP-SONGSANG", "")
        self.assertEqual(p1[kunci], "belum_remit")
        self.assertEqual(p2[kunci], "hilang_lewat")


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
