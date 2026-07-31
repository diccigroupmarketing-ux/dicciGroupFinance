"""
testGoldenParity.py , mini-parity SINTETIK atas fixture emas, untuk CI.

Apa ia buat (dua benda, dua dua penting)
----------------------------------------
1. PARITY: bina fixture golden (genGoldenFixture.buat_golden) dalam tempdir, lalu
   jalankan E1 (reconcile.py, oracle pandas) dan E2 (reconSql.py, dialek sqlite)
   atas SETIAP stream, banding baris demi baris sebagai multiset
   (order_id, awb, bill_id, kategori). Kalau seorang ubah satu enjin tanpa ubah
   yang lain, ujian ni menjerit , sama semangat testReconEdgeCases.py tapi fokus
   LIPUTAN penuh, bukan kes tepi.

2. LIPUTAN: sahkan SETIAP kategori yang fixture sepatutnya cetus BETUL BETUL muncul
   dalam output enjin. Tanpa semakan ni, fixture boleh reput SENYAP (contoh
   seseorang tukar satu tarikh dan satu kategori lesap) dan CI kekal hijau walhal
   ia dah berhenti menguji kategori tu. Kita pun silang semak EXPECTED_COVERAGE
   lawan senarai kanonik theme.KAT_LABEL_EN: kalau ada label BARU ditambah di masa
   depan tapi fixture tak cetuskannya, ujian ni gagal (drift ditangkap).

RECON_TODAY dibekukan 2026-06-18 SEBELUM db diimport (db.TODAY dibaca masa import),
supaya angka aging (hilang_lewat lawan belum_remit) deterministik.

Jalan: cd webApp && python3 scripts/testGoldenParity.py
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

# Bekukan tarikh aging SEBELUM sebarang import enjin.
os.environ.setdefault("RECON_TODAY", "2026-06-18")

# Enjin recon di ROOT repo (scripts -> webApp -> root = dua paras). Buang cache
# modul dan letak ROOT + folder scripts di depan sys.path, supaya kita pasti
# import enjin ROOT (bukan salinan api/engine yang mungkin dicache runner lain).
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
for _mod in ("db", "ingest", "reconcile", "reconSql", "genGoldenFixture"):
    sys.modules.pop(_mod, None)
for _p in (str(HERE), str(ROOT)):
    while _p in sys.path:
        sys.path.remove(_p)
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))

from sqlalchemy import create_engine  # noqa: E402

import db          # noqa: E402
import reconSql    # noqa: E402
import reconcile   # noqa: E402

import genGoldenFixture as gold  # noqa: E402

# Sanity: betul betul enjin ROOT.
assert Path(db.__file__).resolve().parent == ROOT, db.__file__

PENDING_DAYS = db.REMIT_PENDING_DAYS


def _s(v):
    """Normalisasi nilai ke string stabil merentas pandas / sqlite (None/NaN -> '')."""
    if v is None:
        return ""
    try:
        import pandas as pd
        if not isinstance(v, str) and pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    return str(v).strip()


def _tuple_rows(df):
    """DataFrame m -> senarai tuple (order_id, awb, bill_id, kategori) disusun."""
    return sorted(
        (_s(r.order_id), _s(r.awb), _s(r.bill_id), _s(r.kategori))
        for r in df.itertuples())


def hasil_e1(conn, kind, key):
    if kind == "prepaid":
        m, _l, _i = reconcile.reconcile_prepaid(conn, gateway=key)
    else:
        m, _l, _i = reconcile.reconcile(conn, courier=key)
    return _tuple_rows(m)


def hasil_e2(conn, kind, key):
    reconSql._build_tmp_m(conn, kind, key, PENDING_DAYS)
    df = reconSql._read(conn, "SELECT order_id, awb, bill_id, kategori FROM tmp_m")
    conn.rollback()
    return _tuple_rows(df)


def peta_kat(rows):
    """[(order_id, awb, bill_id, kategori)] -> {(order_id, awb): kategori}.
    Kunci (order_id, awb) padan bentuk JANGKA_* dalam genGoldenFixture."""
    return {(o, a): k for o, a, _b, k in rows}


class GoldenCase(unittest.TestCase):
    """Satu fixture golden dikongsi semua ujian (dibina sekali, dibuang di akhir)."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="goldenParity_")
        cls.path = Path(cls._tmp.name) / "golden.db"
        gold.buat_golden(cls.path)
        cls.engine = create_engine(gold._sqlite_url(cls.path))

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()
        cls._tmp.cleanup()

    def setUp(self):
        self.conn = self.engine.connect()
        self.addCleanup(self.conn.close)


class TestGoldenParityE1E2(GoldenCase):
    """E1 (oracle) lawan E2 (SQL sqlite) mesti IDENTIK baris demi baris, tiap stream.

    Fixture golden SENGAJA elak semua baris gap yang didokumen (seri separuh sen,
    tarikh bukan kanonik, whitespace tracking, digit ke-3), jadi di sini TIADA
    divergen dibenarkan , mana mana beza = regresi sebenar, BERHENTI dan lapor."""

    def test_semua_stream_selari(self):
        for kind, key, _jangka in gold.STREAMS:
            with self.subTest(stream=key):
                e1 = hasil_e1(self.conn, kind, key)
                e2 = hasil_e2(self.conn, kind, key)
                if e1 != e2:
                    hanya1 = [r for r in e1 if r not in e2]
                    hanya2 = [r for r in e2 if r not in e1]
                    self.fail(
                        f"DIVERGEN stream {key}:\n"
                        f"  hanya E1 (reconcile.py): {hanya1}\n"
                        f"  hanya E2 (reconSql.py) : {hanya2}")


class TestGoldenKategoriDijangka(GoldenCase):
    """Bukan sekadar dua enjin SETUJU, tapi setuju pada jawapan yang BETUL."""

    def _semak(self, rows, jangka, label):
        got = peta_kat(rows)
        salah = {k: (jangka[k], got.get(k)) for k in jangka
                 if got.get(k) != jangka[k]}
        self.assertEqual(salah, {}, f"{label}: (jangka, dapat) tak padan")

    def test_e1_kategori_tiap_stream(self):
        for kind, key, jangka in gold.STREAMS:
            with self.subTest(engine="E1", stream=key):
                self._semak(hasil_e1(self.conn, kind, key), jangka, f"E1 {key}")

    def test_e2_kategori_tiap_stream(self):
        for kind, key, jangka in gold.STREAMS:
            with self.subTest(engine="E2", stream=key):
                self._semak(hasil_e2(self.conn, kind, key), jangka, f"E2 {key}")


class TestGoldenLiputan(GoldenCase):
    """LIPUTAN , setiap kategori yang fixture sepatutnya cetus MESTI muncul."""

    def _produced(self):
        """Set kategori yang BETUL BETUL dihasilkan E1 merentas semua stream."""
        keluar = set()
        for kind, key, _jangka in gold.STREAMS:
            for _o, _a, _b, kat in hasil_e1(self.conn, kind, key):
                keluar.add(kat)
        return keluar

    def test_setiap_kategori_dijangka_muncul(self):
        # Fixture reput senyap ditangkap di sini: kalau satu kategori yang
        # sepatutnya tercetus HILANG dari output, gagal dengan nama kategori.
        produced = self._produced()
        hilang = sorted(gold.EXPECTED_COVERAGE - produced)
        self.assertEqual(hilang, [], f"kategori dijangka tapi TAK muncul: {hilang}")

    def test_liputan_meliputi_semua_label_kanonik(self):
        # Silang semak drift: EXPECTED_COVERAGE mesti SAMA dengan senarai kanonik
        # theme.KAT_LABEL_EN. Kalau label baru ditambah di masa depan tapi fixture
        # tak cetuskannya, ujian ni gagal (isyarat kemas kini fixture, bukan bug).
        canon, sumber = gold.all_categories()
        if canon is None:
            self.skipTest(f"senarai kanonik tak tersedia {sumber}; "
                          "silang semak drift dilangkau (dep theme hilang)")
        tak_diliput = sorted(canon - gold.EXPECTED_COVERAGE)
        luar_kanonik = sorted(gold.EXPECTED_COVERAGE - canon)
        self.assertEqual(tak_diliput, [],
                         f"label {sumber} tak diliput fixture golden: {tak_diliput}")
        self.assertEqual(luar_kanonik, [],
                         f"fixture cetus kategori bukan label kanonik: {luar_kanonik}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
