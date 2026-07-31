"""
genGoldenFixture.py , penjana fixture emas untuk mini-parity CI.

KENAPA WUJUD (baca ni dulu)
---------------------------
CI awam (`.github/workflows/ci.yml`) jalankan subset sintetik SAHAJA sebab semua
fixture parity SEBENAR (`parityHarness/data/`, `data/baselineRecon.db`) gitignored
(repo PUBLIC). Akibatnya enjin recon TAK dijalankan hujung ke hujung dalam CI atas
data yang menyentuh SEMUA kategori. Fail ni tutup lubang tu: ia bina satu DB sqlite
SINTETIK kecil yang SENGAJA dibentuk supaya SETIAP kategori recon (15 label dalam
theme.KAT_LABEL_EN) tercetus sekurang kurangnya sekali, merentas stream jnt + dhl +
prepaid chip. `testGoldenParity.py` guna fixture ni untuk banding E1 (reconcile.py,
oracle) lawan E2 (reconSql.py, dialek sqlite) baris demi baris, DAN mengesahkan
liputan (kalau satu kategori hilang senyap, fixture reput dan ujian menjerit).

PILIHAN DESIGN: JANA ON-THE-FLY, BUKAN COMMIT BINARI
----------------------------------------------------
Fixture ni deterministik PENUH: tiada random, tiada tarikh dari masa sebenar (semua
nilai hardcoded, aging dibekukan lawan RECON_TODAY=2026-06-18). Sebab tu ia dijana
dalam tempdir masa ujian (`buat_golden(path)`) dan TIDAK di-commit sebagai .db.
Sebabnya: (1) binari dalam repo public = bunyi + risiko (payah audit, senang basi),
(2) sumber kebenaran = kod Python di sini yang manusia boleh baca dan semak, bukan
byte legap, (3) sama corak dengan testReconEdgeCases.py yang sudah terbukti. Kalau
nak periksa DB dengan mata: `python3 scripts/genGoldenFixture.py /tmp/golden.db`
(fail tu JANGAN di-commit).

SEMUA data di sini REKAAN. order GOLD-*, tracking 90xxxxxxxx / 902xxxxxxx (10 digit
palsu), nama "GOLD STOCKIST". Tiada satu pun nilai sebenar. Repo public.
"""

import sqlite3
import sys
from pathlib import Path

# Enjin recon (db.py, reconcile.py, reconSql.py) duduk di ROOT repo. Dari
# webApp/scripts/, ROOT dua paras naik: scripts -> webApp -> root.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# ====================================================================
# Pemalar fixture (tarikh dibekukan lawan RECON_TODAY=2026-06-18)
# ====================================================================
# CUTOFF hilang_lewat = TODAY - (REMIT_PENDING_DAYS + 1) = 2026-06-03 00:00:00.
# OLD  jauh sebelum cutoff (78 hari) -> hilang_lewat.
# YOUNG selepas cutoff (3 hari)      -> belum_remit.
OLD = "2026-04-01 10:00:00"
YOUNG = "2026-06-15 10:00:00"
NORMAL = "2026-06-10 10:00:00"
DELIVERED = "2026-06-11 10:00:00"
PICKUP = "2026-06-09 10:00:00"

SELLER = "GOLD STOCKIST"
BILL_JNT = "GOLDBILL-JNT"
STMT_CHIP = "GOLDSTMT-1"

JNT = "J&T Express"
DHL = "DHL eCommerce"
COMPLETED, RETURNED, REJECTED, TRANSIT = "Completed", "Returned", "Rejected", "In Transit"

# --------------------------------------------------------------------
# ORDERS: (order_id, order_date, status, provider, payment, tracking, harga)
# --------------------------------------------------------------------
ORDERS = [
    # ---- Stream jnt: kategori "ada dalam bil" (baris bil bernilai > 0) ----
    ("GOLD-TALLY",        NORMAL, COMPLETED, JNT, "COD", "9010000001", 100.0),
    ("GOLD-MISMATCH",     NORMAL, COMPLETED, JNT, "COD", "9010000002", 100.0),
    ("GOLD-RET-PAID",     NORMAL, RETURNED,  JNT, "COD", "9010000003", 100.0),
    ("GOLD-REJ-PAID",     NORMAL, REJECTED,  JNT, "COD", "9010000004", 100.0),
    ("GOLD-TRANSIT-PAID", NORMAL, TRANSIT,   JNT, "COD", "9010000005", 100.0),

    # ---- Stream jnt: kategori "takde bil" (jatuh ikut aging / status) ----
    ("GOLD-NOAWB-JNT",   NORMAL, COMPLETED, JNT, "COD", "NONE",       100.0),  # tracking sentinel = AWB tak sah
    ("GOLD-OVERDUE",     OLD,    COMPLETED, JNT, "COD", "9010000007", 100.0),  # tua, tiada bil
    ("GOLD-AWAIT-REMIT", YOUNG,  COMPLETED, JNT, "COD", "9010000008", 100.0),  # muda, tiada bil
    ("GOLD-RETURNED",    NORMAL, RETURNED,  JNT, "COD", "9010000009", 100.0),
    ("GOLD-REJECTED",    NORMAL, REJECTED,  JNT, "COD", "9010000010", 100.0),
    ("GOLD-PENDING",     NORMAL, TRANSIT,   JNT, "COD", "9010000011", 100.0),

    # ---- Order LUAR SKOP jnt (provider DHL) yang trackingnya dirujuk baris bil
    #      J&T = match_luar_skop di stream jnt, DAN belum_remit di stream dhl. ----
    ("GOLD-OOS-DHL", YOUNG, COMPLETED, DHL, "COD", "9020000001", 100.0),

    # ---- Stream dhl: order Completed tanpa tracking = takde_tracking ----
    ("GOLD-NOTRACK-DHL", NORMAL, COMPLETED, DHL, "COD", "", 100.0),

    # ---- Stream prepaid chip (padan ikut order_id) ----
    ("GOLD-PREPAID-TALLY",    NORMAL, COMPLETED, JNT, "CHIP", "9030000001", 100.0),
    ("GOLD-PREPAID-MISMATCH", NORMAL, COMPLETED, JNT, "CHIP", "9030000002", 100.0),
    ("GOLD-PREPAID-AWAIT",    NORMAL, COMPLETED, JNT, "CHIP", "9030000003", 100.0),
]

# --------------------------------------------------------------------
# LINES (semua pada BILL_JNT, courier J&T): (awb, cod_amount)
# --------------------------------------------------------------------
LINES = [
    ("9010000001", 100.0),   # GOLD-TALLY        -> tally
    ("9010000002", 90.0),    # GOLD-MISMATCH     -> amount_mismatch
    ("9010000003", 100.0),   # GOLD-RET-PAID     -> duit_masuk_order_returned
    ("9010000004", 100.0),   # GOLD-REJ-PAID     -> duit_masuk_order_rejected
    ("9010000005", 100.0),   # GOLD-TRANSIT-PAID -> in_bil_tapi_intransit
    ("9020000001", 100.0),   # AWB = tracking order luar skop (DHL) -> match_luar_skop
    ("9099999999", 100.0),   # tiada order langsung -> duit_hantu
]

# --------------------------------------------------------------------
# PREPAID (gateway chip): (order_ref, amount)
# --------------------------------------------------------------------
PREPAID = [
    ("GOLD-PREPAID-TALLY",    100.0),   # padan tepat -> tally
    ("GOLD-PREPAID-MISMATCH", 90.0),    # beza harga  -> amount_mismatch
    ("GOLD-PREPAID-GHOST",    55.0),    # bayaran tanpa order -> duit_hantu
]

# ====================================================================
# Kategori DIJANGKA per stream. Kunci = (order_id, awb).
# (E1 dan E2 kedua duanya MESTI setuju pada nilai ni; testGoldenParity sahkan.)
# ====================================================================
JANGKA_JNT = {
    ("GOLD-TALLY", "9010000001"): "tally",
    ("GOLD-MISMATCH", "9010000002"): "amount_mismatch",
    ("GOLD-RET-PAID", "9010000003"): "duit_masuk_order_returned",
    ("GOLD-REJ-PAID", "9010000004"): "duit_masuk_order_rejected",
    ("GOLD-TRANSIT-PAID", "9010000005"): "in_bil_tapi_intransit",
    ("GOLD-NOAWB-JNT", ""): "takde_awb_jnt",
    ("GOLD-OVERDUE", ""): "hilang_lewat",
    ("GOLD-AWAIT-REMIT", ""): "belum_remit",
    ("GOLD-RETURNED", ""): "returned",
    ("GOLD-REJECTED", ""): "rejected",
    ("GOLD-PENDING", ""): "pending",
    ("", "9020000001"): "match_luar_skop",
    ("", "9099999999"): "duit_hantu",
}

JANGKA_DHL = {
    ("GOLD-OOS-DHL", ""): "belum_remit",
    ("GOLD-NOTRACK-DHL", ""): "takde_tracking",
}

JANGKA_CHIP = {
    ("GOLD-PREPAID-TALLY", "GOLD-PREPAID-TALLY"): "tally",
    ("GOLD-PREPAID-MISMATCH", "GOLD-PREPAID-MISMATCH"): "amount_mismatch",
    ("GOLD-PREPAID-AWAIT", ""): "belum_bayar",
    ("", "GOLD-PREPAID-GHOST"): "duit_hantu",
}

# Stream yang testGoldenParity jalankan (kind, key). Nota: stream 'ninja' guna
# laluan kod SAMA dengan 'dhl' (awb_valid = _awb_present, no_awb_cat =
# takde_tracking), jadi ia dilindungi secara struktur oleh dhl; tak perlu baris
# ninja berasingan untuk liputan kategori.
STREAMS = [
    ("courier", "jnt", JANGKA_JNT),
    ("courier", "dhl", JANGKA_DHL),
    ("prepaid", "chip", JANGKA_CHIP),
]

# Liputan yang fixture ni SEPATUTNYA cetus = gabungan semua nilai JANGKA.
EXPECTED_COVERAGE = (set(JANGKA_JNT.values())
                     | set(JANGKA_DHL.values())
                     | set(JANGKA_CHIP.values()))


def all_categories():
    """Set kanonik SEMUA label kategori recon = kunci theme.KAT_LABEL_EN.

    Pulang (set_atau_None, sumber). Import theme dijaga (import streamlit +
    altair): kalau env minimum tiada dep tu, pulang None supaya pemanggil boleh
    degrade dengan jujur (bukan crash), tapi bila dep ada (CI + dev), silang
    semak drift dikuatkuasakan."""
    try:
        import theme
        return set(theme.KAT_LABEL_EN), "theme.KAT_LABEL_EN"
    except Exception as e:  # noqa: BLE001 , dep hilang / import streamlit gagal
        return None, f"(theme tak boleh diimport: {e})"


def _sqlite_url(path):
    return "sqlite:///" + str(path)


def buat_golden(path, orders=ORDERS, lines=LINES, prepaid=PREPAID):
    """Bina DB sqlite golden lengkap di `path` guna skema sebenar db.SCHEMA."""
    from sqlalchemy import create_engine

    import db  # ROOT

    eng = create_engine(_sqlite_url(path))
    conn = eng.connect()
    db.init_db(conn)
    conn.close()
    eng.dispose()

    c = sqlite3.connect(str(path))
    cur = c.cursor()
    cur.execute(
        "INSERT INTO cod_bills (bill_id, courier, settlement_date, source_file,"
        " ingested_at) VALUES (?,?,?,?,?)",
        (BILL_JNT, JNT, "2026-06-12", "goldenFixture.xlsx", "2026-06-18 00:00:00"))
    for oid, odate, status, prov, pay, trk, price in orders:
        cur.execute(
            "INSERT INTO orders (order_id, order_date, status, seller_name,"
            " payment_method, shipping_provider, tracking, selling_price,"
            " sales_commission, skus, item_count, source_file, ingested_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (oid, odate, status, SELLER, pay, prov, trk, price, 0.0, None, 1,
             "goldenFixture.xlsx", "2026-06-18 00:00:00"))
    for awb, cod in lines:
        cur.execute(
            "INSERT INTO cod_bill_lines (awb, bill_id, cod_amount, fee,"
            " delivered_date, pickup_date, source_file, ingested_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (awb, BILL_JNT, cod, 1.0, DELIVERED, PICKUP,
             "goldenFixture.xlsx", "2026-06-18 00:00:00"))
    for ref, amt in prepaid:
        cur.execute(
            "INSERT INTO prepaid_payments (gateway, order_ref, amount, fee, status,"
            " paid_on, settled_on, statement_id, source_file, ingested_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("chip", ref, amt, 0.0, "paid", DELIVERED, None, STMT_CHIP,
             "goldenFixture.xlsx", "2026-06-18 00:00:00"))
    c.commit()
    c.close()


if __name__ == "__main__":
    # Guna untuk periksa DB dengan mata (JANGAN commit fail keluaran).
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("golden.db")
    buat_golden(out)
    print(f"[golden fixture ditulis ke {out}] "
          f"({len(ORDERS)} order, {len(LINES)} baris bil, {len(PREPAID)} prepaid)")
    print(f"[liputan dijangka: {len(EXPECTED_COVERAGE)} kategori]")
