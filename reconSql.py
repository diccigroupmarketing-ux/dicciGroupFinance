"""
reconSql.py , dicciGroupFinance

Recon dikira DALAM database: SQL agregat + baris exception sahaja keluar ke app.
Tujuan: pegang ratus ribu hingga jutaan order tanpa tarik semua row ke pandas
(pandas penuh = 1.5GB RAM + puluhan saat pada 1 juta order, mati dalam container
Streamlit Cloud 1GB).

PENTING: logik kategori di sini = salinan SETIA reconcile.py (rujukan kebenaran,
TIDAK disentuh). parityCheck (scratchpad) sahkan output identik row-by-row
sebelum app bertukar ke laluan ini. Kalau logik recon berubah, ubah reconcile.py
dulu, sahkan parity, baru sync sini.

Nota portability (SQLite dev lokal + Postgres Neon produksi):
- Semua tarikh disimpan teks ISO (YYYY-MM-DD HH:MM:SS), jadi perbandingan string
  = perbandingan masa, tiada fungsi tarikh dialek.
- Fork dialek hanya 2: semakan digit tracking (regex ~ vs GLOB) dan ROUND
  (Postgres perlu cast numeric supaya half-away-from-zero macam SQLite/pandas).
- Postgres tak benarkan bind param dalam CREATE TABLE AS (utility statement),
  jadi tmp table dibuat kosong dulu, kemudian INSERT INTO ... SELECT (params OK).
- Neon pooler = pgbouncer transaction mode: TEMP table selamat hanya dalam SATU
  transaksi. Semua kerja satu panggilan guna satu conn tanpa commit, rollback
  di akhir, jadi kekal dalam satu transaksi.
"""

import pandas as pd
from sqlalchemy import bindparam, text

import db
from db import COD_VALUES, REMIT_PENDING_DAYS, TODAY
from reconcile import AGED, INTEGRITY_EXC

EXC_CAP = 5_000      # baris exception maksimum yang ditarik untuk paparan
BILL_CAP = 20_000    # baris maksimum paparan parcel satu bil
DRILL_CAP = 10_000   # baris maksimum drill-down per stokis

SHOW_COLS = ["order_id", "seller_name", "tracking", "awb", "kategori",
             "selling_price", "cod_amount", "umur_hari"]


# ====================================================================
# Fragmen dialek
# ====================================================================
def _frags(conn):
    d = conn.engine.dialect.name

    def digit_ok(col):
        # is_real_awb: semua digit DAN panjang >= 10
        if d == "postgresql":
            return f"{col} ~ '^[0-9]{{10,}}$'"
        return f"(LENGTH({col}) >= 10 AND {col} NOT GLOB '*[^0-9]*')"

    def present_ok(col):
        # _awb_present: bukan kosong dan bukan 'nan'
        return f"(TRIM(COALESCE({col}, '')) <> '' AND UPPER(TRIM({col})) <> 'NAN')"

    def r2(x):
        if d == "postgresql":
            return f"ROUND(CAST({x} AS numeric), 2)"
        return f"ROUND({x}, 2)"

    return digit_ok, present_ok, r2


def _cutoff(pending_days):
    # (TODAY - order_date).days > P  <=>  order_date <= TODAY - (P+1) hari
    return (TODAY - pd.Timedelta(days=pending_days + 1)).strftime("%Y-%m-%d %H:%M:%S")


def _read(conn, sql, expand=(), **params):
    stmt = text(sql)
    if expand:
        stmt = stmt.bindparams(*[bindparam(k, expanding=True) for k in expand])
    return pd.read_sql(stmt, conn, params=params)


def _exec(conn, sql, expand=(), **params):
    stmt = text(sql)
    if expand:
        stmt = stmt.bindparams(*[bindparam(k, expanding=True) for k in expand])
    conn.execute(stmt, params)


# NOTA prestasi: JANGAN join ke subquery agregat "botol per order" , SQLite tiada
# hash join, join ke hasil subquery tanpa index = nested loop penuh (berjam pada
# 1 juta row). Corak selamat: join order_skus terus (PK index) atau scalar
# subquery berkorelasi per baris yang dah di-cap.


# ====================================================================
# m (baris dikategorikan) -> TEMP TABLE, dalam SATU transaksi
# ====================================================================
TMP_DDL = """
    CREATE TEMPORARY TABLE tmp_m (
        order_id      TEXT,
        order_date    TEXT,
        status        TEXT,
        seller_name   TEXT,
        tracking      TEXT,
        selling_price DOUBLE PRECISION,
        awb           TEXT,
        bill_id       TEXT,
        cod_amount    DOUBLE PRECISION,
        fee           DOUBLE PRECISION,
        delivered_date TEXT,
        remit         DOUBLE PRECISION,
        kategori      TEXT
    )
"""


def _m_sql_courier(conn, courier):
    cfg = db.COURIERS[courier]
    digit_ok, present_ok, r2 = _frags(conn)
    awb_ok = digit_ok if cfg["awb_valid"] is db.is_real_awb else present_ok
    # Anti-join ikut dialek. SQLite: NOT EXISTS berkorelasi buat planner pilih
    # idx_orders_scope = scan ratusan ribu baris SETIAP baris bil (terbukti
    # tergantung pada 1 juta row); NOT IN dimaterialisasi + auto-index SEKALI.
    # Postgres: TERBALIK, NOT IN senarai besar tak muat work_mem = linear scan
    # per row; NOT EXISTS dirancang sebagai hash anti-join. Semantik sama
    # (`tracking IS NOT NULL` wajib di sisi NOT IN: satu NULL = hasil kosong).
    if conn.engine.dialect.name == "postgresql":
        known_trk = "EXISTS (SELECT 1 FROM orders ao WHERE ao.tracking = l.awb)"
        anti = """NOT EXISTS (SELECT 1 FROM orders s WHERE s.tracking = l.awb
                              AND s.payment_method IN :cods
                              AND s.shipping_provider IN :prov)"""
    else:
        known_trk = ("l.awb IN (SELECT tracking FROM orders "
                     "WHERE tracking IS NOT NULL)")
        anti = """l.awb NOT IN (SELECT tracking FROM orders
                                WHERE tracking IS NOT NULL
                                  AND payment_method IN :cods
                                  AND shipping_provider IN :prov)"""
    return f"""
        SELECT s.order_id, s.order_date, s.status, s.seller_name, s.tracking,
               s.selling_price,
               l.awb, l.bill_id, l.cod_amount, l.fee, l.delivered_date,
               l.cod_amount - l.fee AS remit,
               CASE
                 WHEN l.awb IS NOT NULL THEN
                   CASE
                     WHEN s.status = 'Completed' THEN
                       CASE WHEN {r2('s.selling_price')} = {r2('l.cod_amount')}
                            THEN 'tally' ELSE 'amount_mismatch' END
                     WHEN s.status = 'Returned' THEN 'duit_masuk_order_returned'
                     WHEN s.status = 'Rejected' THEN 'duit_masuk_order_rejected'
                     ELSE 'in_bil_tapi_intransit'
                   END
                 ELSE
                   CASE
                     WHEN s.status = 'Completed' THEN
                       CASE
                         WHEN s.tracking IS NULL THEN :no_awb
                         WHEN NOT {awb_ok('s.tracking')} THEN :no_awb
                         WHEN s.order_date <= :cutoff THEN 'hilang_lewat'
                         ELSE 'belum_remit'
                       END
                     WHEN s.status = 'Returned' THEN 'returned'
                     WHEN s.status = 'Rejected' THEN 'rejected'
                     ELSE 'pending'
                   END
               END AS kategori
        FROM orders s
        LEFT JOIN tmp_lines l ON l.awb = s.tracking
        WHERE s.payment_method IN :cods AND s.shipping_provider IN :prov

        UNION ALL

        SELECT NULL, NULL, NULL, NULL, NULL, NULL,
               l.awb, l.bill_id, l.cod_amount, l.fee, l.delivered_date,
               l.cod_amount - l.fee,
               CASE WHEN {known_trk}
                    THEN 'match_luar_skop' ELSE 'duit_hantu' END
        FROM tmp_lines l
        WHERE {anti}
    """


def _m_sql_prepaid(conn, gateway):
    cfg = db.PREPAID[gateway]
    _, _, r2 = _frags(conn)
    assert cfg  # methods dibind sebagai param
    # Fork anti-join sama seperti _m_sql_courier (lihat nota di situ).
    if conn.engine.dialect.name == "postgresql":
        anti = """NOT EXISTS (SELECT 1 FROM orders s
                              WHERE s.order_id = p.order_ref
                                AND s.payment_method IN :methods)"""
    else:
        anti = """p.order_ref NOT IN (SELECT order_id FROM orders
                                      WHERE order_id IS NOT NULL
                                        AND payment_method IN :methods)"""
    return f"""
        SELECT s.order_id, s.order_date, s.status, s.seller_name, s.tracking,
               s.selling_price,
               p.order_ref AS awb, p.statement_id AS bill_id, p.amount AS cod_amount,
               p.fee, p.paid_on AS delivered_date,
               p.amount - p.fee AS remit,
               CASE
                 WHEN p.order_ref IS NOT NULL THEN
                   CASE WHEN {r2('s.selling_price')} = {r2('p.amount')}
                        THEN 'tally' ELSE 'amount_mismatch' END
                 ELSE 'belum_bayar'
               END AS kategori
        FROM orders s
        LEFT JOIN tmp_lines p ON p.order_ref = s.order_id
        WHERE s.payment_method IN :methods

        UNION ALL

        SELECT NULL, NULL, NULL, NULL, NULL, NULL,
               p.order_ref, p.statement_id, p.amount, p.fee, p.paid_on,
               p.amount - p.fee,
               'duit_hantu'
        FROM tmp_lines p
        WHERE {anti}
    """


def _build_tmp_m(conn, kind, key, pending_days):
    """Isi tmp_m untuk satu stream. MESTI dalam transaksi yang sama dengan
    query agregat selepasnya (pgbouncer transaction mode).

    Baris bil courier dimaterialisasi dulu ke tmp_lines BER-INDEX: SQLite tiada
    hash join, jadi join set besar tanpa index = nested loop penuh (berjam pada
    1 juta row). Dengan index awb, dua dua dialek kekal laju."""
    _exec(conn, "DROP TABLE IF EXISTS tmp_m")
    _exec(conn, "DROP TABLE IF EXISTS tmp_lines")
    _exec(conn, TMP_DDL)
    if kind == "courier":
        cfg = db.COURIERS[key]
        _exec(conn, """
            CREATE TEMPORARY TABLE tmp_lines AS
            SELECT li.awb, li.bill_id, li.cod_amount, li.fee, li.delivered_date
            FROM cod_bill_lines li
            JOIN cod_bills b ON b.bill_id = li.bill_id
            WHERE b.courier = '{}'""".format(cfg["courier_label"].replace("'", "''")))
        _exec(conn, "CREATE INDEX idx_tmp_lines_awb ON tmp_lines(awb)")
        _exec(conn, "INSERT INTO tmp_m " + _m_sql_courier(conn, key),
              expand=("cods", "prov"),
              no_awb=cfg["no_awb_cat"], cutoff=_cutoff(pending_days),
              cods=sorted(COD_VALUES), prov=sorted(cfg["provider"]))
    else:
        cfg = db.PREPAID[key]
        _exec(conn, """
            CREATE TEMPORARY TABLE tmp_lines AS
            SELECT order_ref, statement_id, amount, fee, paid_on
            FROM prepaid_payments WHERE gateway = '{}'""".format(key.replace("'", "''")))
        _exec(conn, "CREATE INDEX idx_tmp_lines_ref ON tmp_lines(order_ref)")
        _exec(conn, "INSERT INTO tmp_m " + _m_sql_prepaid(conn, key),
              expand=("methods",), methods=sorted(cfg["methods"]))
    # Index untuk agregat berikutnya (SQLite perlu; Postgres pun untung sikit).
    _exec(conn, "CREATE INDEX idx_tmp_m_oid ON tmp_m(order_id)")
    _exec(conn, "CREATE INDEX idx_tmp_m_bill ON tmp_m(bill_id)")
    _exec(conn, "CREATE INDEX idx_tmp_m_kat ON tmp_m(kategori)")


def _umur_hari(df):
    if len(df):
        df["umur_hari"] = (TODAY - pd.to_datetime(df["order_date"], errors="coerce")).dt.days
    else:
        df["umur_hari"] = pd.Series(dtype="float64")
    return df


# ====================================================================
# Ringkasan satu stream (courier atau prepaid): SEMUA yang UI perlukan,
# dalam bentuk agregat + baris exception capped. Selamat pada jutaan row.
# ====================================================================
def stream_summary(conn, kind, key, pending_days=REMIT_PENDING_DAYS):
    _build_tmp_m(conn, kind, key, pending_days)

    kat = _read(conn, """
        SELECT kategori, COUNT(*) AS n, SUM(cod_amount) AS cod_sum,
               SUM(selling_price) AS selling_sum
        FROM tmp_m GROUP BY kategori""")
    kat_n = dict(zip(kat["kategori"], kat["n"]))
    kat_cod = dict(zip(kat["kategori"], kat["cod_sum"].fillna(0.0)))
    kat_sell = dict(zip(kat["kategori"], kat["selling_sum"].fillna(0.0)))

    # Daily dipecah dua: kiraan asas atas tmp_m, dan botol via join TERUS ke
    # order_skus (PK index; satu order = maksimum satu baris bil, jadi tiada
    # penggandaan). Digabung balik ikut hari dalam pandas (baris sikit).
    daily = _read(conn, """
        SELECT SUBSTR(m.delivered_date, 1, 10) AS day,
               COUNT(*) AS parcel,
               SUM(m.cod_amount) AS cod_dikutip,
               SUM(m.fee) AS fee,
               SUM(CASE WHEN m.kategori = 'tally' THEN 1 ELSE 0 END) AS tally,
               SUM(CASE WHEN m.kategori IN :integ THEN 1 ELSE 0 END) AS exception
        FROM tmp_m m
        WHERE m.bill_id IS NOT NULL AND m.delivered_date IS NOT NULL
        GROUP BY 1 ORDER BY 1""", expand=("integ",), integ=INTEGRITY_EXC)
    daily_b = _read(conn, """
        SELECT SUBSTR(m.delivered_date, 1, 10) AS day,
               SUM(os.qty * (COALESCE(sb.paid, 0) + COALESCE(sb.free, 0))) AS botol,
               SUM(os.qty * COALESCE(sb.free, 0)) AS botol_free
        FROM tmp_m m
        JOIN order_skus os ON os.order_id = m.order_id
        LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
        WHERE m.bill_id IS NOT NULL AND m.delivered_date IS NOT NULL
        GROUP BY 1""")
    daily = daily.merge(daily_b, on="day", how="left")
    daily[["botol", "botol_free"]] = daily[["botol", "botol_free"]].fillna(0)

    integ = _umur_hari(_read(conn, """
        SELECT order_id, seller_name, tracking, awb, kategori, selling_price,
               cod_amount, order_date
        FROM tmp_m WHERE kategori IN :integ
        ORDER BY order_date LIMIT :cap""",
        expand=("integ",), integ=INTEGRITY_EXC, cap=EXC_CAP))
    aged = _umur_hari(_read(conn, """
        SELECT order_id, seller_name, tracking, awb, kategori, selling_price,
               cod_amount, order_date
        FROM tmp_m WHERE kategori IN :aged
        ORDER BY order_date LIMIT :cap""",
        expand=("aged",), aged=AGED, cap=EXC_CAP))

    per_bill = _read(conn, """
        SELECT bill_id, COUNT(*) AS parcel, SUM(cod_amount) AS cod,
               SUM(fee) AS fee,
               SUM(CASE WHEN kategori = 'tally' THEN 1 ELSE 0 END) AS tally,
               SUM(CASE WHEN kategori IN :integ THEN 1 ELSE 0 END) AS exc
        FROM tmp_m WHERE bill_id IS NOT NULL
        GROUP BY bill_id""", expand=("integ",), integ=INTEGRITY_EXC)

    stokis_kat = _read(conn, """
        SELECT COALESCE(seller_name, '(no order)') AS seller, kategori,
               COUNT(*) AS n
        FROM tmp_m GROUP BY 1, 2""")

    _exec(conn, "DROP TABLE IF EXISTS tmp_m")
    _exec(conn, "DROP TABLE IF EXISTS tmp_lines")

    # ---- Bahagian luar tmp_m ----
    if kind == "courier":
        cfg = db.COURIERS[key]
        lines_total = _read(conn, """
            SELECT COUNT(*) AS n, SUM(l.cod_amount) AS cod, SUM(l.fee) AS fee
            FROM cod_bill_lines l JOIN cod_bills b ON b.bill_id = l.bill_id
            WHERE b.courier = :label""", label=cfg["courier_label"]).iloc[0]
        bills = _read(conn, """
            SELECT bill_id, settlement_date, source_file FROM cod_bills
            WHERE courier = :label
            ORDER BY settlement_date IS NULL, settlement_date, bill_id""",
            label=cfg["courier_label"])
        other = _read(conn, """
            SELECT shipping_provider, COUNT(*) AS n, SUM(selling_price) AS nilai
            FROM orders
            WHERE payment_method IN :cods AND shipping_provider NOT IN :prov
            GROUP BY shipping_provider""",
            expand=("cods", "prov"), cods=sorted(COD_VALUES),
            prov=sorted(cfg["provider"]))
        other_courier = {r.shipping_provider: {"order": int(r.n),
                                               "nilai": float(r.nilai or 0)}
                         for r in other.itertuples()}
        # NOT IN dulu (buang hampir semua baris), baru EXISTS probe PK orders.
        unmapped = _read(conn, """
            SELECT DISTINCT os.sku_raw FROM order_skus os
            WHERE os.sku NOT IN (SELECT UPPER(TRIM(sku)) FROM sku_bottles
                                 WHERE sku IS NOT NULL)
              AND EXISTS (SELECT 1 FROM orders o WHERE o.order_id = os.order_id
                          AND o.payment_method IN :cods
                          AND o.shipping_provider IN :prov)""",
            expand=("cods", "prov"), cods=sorted(COD_VALUES),
            prov=sorted(cfg["provider"]))
    else:
        cfg = db.PREPAID[key]
        lines_total = _read(conn, """
            SELECT COUNT(*) AS n, SUM(amount) AS cod, SUM(fee) AS fee
            FROM prepaid_payments WHERE gateway = :gw""", gw=key).iloc[0]
        bills = _read(conn, """
            SELECT statement_id AS bill_id, MIN(paid_on) AS settlement_date,
                   MIN(source_file) AS source_file
            FROM prepaid_payments
            WHERE gateway = :gw AND statement_id IS NOT NULL
            GROUP BY statement_id
            ORDER BY 2 IS NULL, 2, 1""", gw=key)
        other_courier = {}
        unmapped = _read(conn, """
            SELECT DISTINCT os.sku_raw FROM order_skus os
            WHERE os.sku NOT IN (SELECT UPPER(TRIM(sku)) FROM sku_bottles
                                 WHERE sku IS NOT NULL)
              AND EXISTS (SELECT 1 FROM orders o WHERE o.order_id = os.order_id
                          AND o.payment_method IN :methods)""",
            expand=("methods",), methods=sorted(cfg["methods"]))

    conn.rollback()  # tmp_m + transaksi baca sahaja; tinggalkan conn bersih

    integ_cats = [k for k in kat_n if k in INTEGRITY_EXC]
    return {
        "kat_n": kat_n, "kat_cod": kat_cod, "kat_sell": kat_sell,
        "daily": daily,
        "integ": integ, "integ_n": int(sum(kat_n[k] for k in integ_cats)),
        "integ_risk": float(sum(kat_cod.get(k, 0) or 0 for k in integ_cats)),
        "aged": aged, "aged_n": int(sum(kat_n.get(k, 0) for k in AGED)),
        "aged_selling": float(sum(kat_sell.get(k, 0) or 0 for k in AGED)),
        "per_bill": per_bill, "stokis_kat": stokis_kat,
        "lines_n": int(lines_total["n"] or 0),
        "lines_cod": float(lines_total["cod"] or 0),
        "lines_fee": float(lines_total["fee"] or 0),
        "bills": bills, "n_bills": len(bills),
        "other_courier": other_courier,
        "unmapped_skus": sorted(unmapped["sku_raw"].dropna().tolist()),
        "tally_n": int(kat_n.get("tally", 0)),
        "tally_cod": float(kat_cod.get("tally", 0) or 0),
    }


def bill_parcels(conn, kind, key, pending_days, bill_id, cap=BILL_CAP):
    """Baris parcel SATU bil (dikategorikan), untuk tab By Bill. Scope kecil."""
    _build_tmp_m(conn, kind, key, pending_days)
    rows = _read(conn, """
        SELECT awb, order_id, seller_name, kategori, selling_price, cod_amount,
               fee, remit
        FROM tmp_m WHERE bill_id = :bid ORDER BY awb LIMIT :cap""",
        bid=bill_id, cap=cap)
    _exec(conn, "DROP TABLE IF EXISTS tmp_m")
    _exec(conn, "DROP TABLE IF EXISTS tmp_lines")
    conn.rollback()
    return rows


# ====================================================================
# Botol per stokis (semua courier + payment; confirmed via feed duit)
# ====================================================================
CONF_SQL = """
    CASE WHEN EXISTS (SELECT 1 FROM cod_bill_lines cl WHERE cl.awb = o.tracking)
           OR EXISTS (SELECT 1 FROM prepaid_payments pp WHERE pp.order_ref = o.order_id)
         THEN 1 ELSE 0 END
"""


def stockist_bottles(conn):
    # Satu laluan: orders x order_skus (PK index) x sku_bottles. Join 1:N
    # menggandakan baris per SKU, jadi kiraan order guna COUNT(DISTINCT);
    # jumlah botol memang per baris order_skus, tak terjejas.
    return _read(conn, f"""
        SELECT stockist,
               COUNT(DISTINCT CASE WHEN conf = 1 THEN order_id END) AS confirmed_orders,
               SUM(CASE WHEN conf = 1 THEN bp ELSE 0 END) AS paid_bottles,
               SUM(CASE WHEN conf = 1 THEN bf ELSE 0 END) AS free_bottles,
               SUM(CASE WHEN conf = 1 THEN bp + bf ELSE 0 END) AS total_bottles,
               SUM(CASE WHEN conf = 0 THEN bp + bf ELSE 0 END) AS unconfirmed_bottles
        FROM (SELECT o.order_id,
                     COALESCE(o.seller_name, '(no stockist)') AS stockist,
                     COALESCE(os.qty * COALESCE(sb.paid, 0), 0) AS bp,
                     COALESCE(os.qty * COALESCE(sb.free, 0), 0) AS bf,
                     {CONF_SQL} AS conf
              FROM orders o
              LEFT JOIN order_skus os ON os.order_id = o.order_id
              LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
              WHERE o.status = 'Completed') x
        GROUP BY stockist""")


def stockist_names(conn):
    d = _read(conn, "SELECT DISTINCT COALESCE(seller_name, '(no stockist)') AS s "
                    "FROM orders")
    return sorted(d["s"].tolist())


def stockist_orders(conn, seller, cap=DRILL_CAP):
    # Cap dulu (subquery LIMIT), lepas tu botol via scalar subquery berkorelasi
    # per baris (PK index order_skus), selamat pada mana mana saiz DB.
    rows = _read(conn, f"""
        SELECT o.order_id, o.order_date, o.status, o.payment_method,
               o.shipping_provider, o.tracking,
               COALESCE((SELECT SUM(os.qty * COALESCE(sb.paid, 0))
                         FROM order_skus os
                         LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
                         WHERE os.order_id = o.order_id), 0) AS botol_paid,
               COALESCE((SELECT SUM(os.qty * COALESCE(sb.free, 0))
                         FROM order_skus os
                         LEFT JOIN sku_bottles sb ON UPPER(TRIM(sb.sku)) = os.sku
                         WHERE os.order_id = o.order_id), 0) AS botol_free,
               CASE WHEN {CONF_SQL.strip()} = 1 THEN 'confirmed'
                    ELSE 'unconfirmed' END AS duit
        FROM (SELECT * FROM orders
              WHERE COALESCE(seller_name, '(no stockist)') = :seller
              ORDER BY order_date DESC LIMIT :cap) o
        ORDER BY o.order_date DESC""", seller=seller, cap=cap)
    rows["botol_total"] = rows["botol_paid"] + rows["botol_free"]
    total = _read(conn, "SELECT COUNT(*) AS n FROM orders "
                        "WHERE COALESCE(seller_name, '(no stockist)') = :seller",
                  seller=seller)["n"].iloc[0]
    return rows, int(total)


# ====================================================================
# Commission (Fighter Wallet)
# ====================================================================
def commission_summary(conn):
    g = _read(conn, """
        SELECT seller_name, MIN(seller_role) AS level,
               SUM(CASE WHEN status = 'Approved' AND txn_type = 'IN'
                        THEN amount ELSE 0 END) AS earned,
               SUM(CASE WHEN status = 'Approved' AND txn_type = 'OUT'
                             AND source = 'Withdraw'
                        THEN amount ELSE 0 END) AS paid
        FROM wallet_txns
        WHERE seller_name IS NOT NULL
        GROUP BY seller_name
        HAVING SUM(CASE WHEN status = 'Approved'
                             AND (txn_type = 'IN'
                                  OR (txn_type = 'OUT' AND source = 'Withdraw'))
                        THEN 1 ELSE 0 END) > 0""")
    g["level"] = g["level"].fillna("")
    g["earned"] = g["earned"].fillna(0.0)
    g["paid"] = g["paid"].fillna(0.0)
    g["balance"] = (g["earned"] - g["paid"]).round(2)
    return (g.sort_values("earned", ascending=False)
             [["seller_name", "level", "earned", "paid", "balance"]]
             .reset_index(drop=True))


def commission_names(conn):
    d = _read(conn, "SELECT DISTINCT seller_name FROM wallet_txns "
                    "WHERE seller_name IS NOT NULL")
    return sorted(d["seller_name"].tolist())


def commission_breakdown(conn, seller, cap=DRILL_CAP):
    by_src = _read(conn, """
        SELECT source, txn_type, COUNT(*) AS count, SUM(amount) AS total
        FROM wallet_txns
        WHERE seller_name = :s AND status = 'Approved'
        GROUP BY source, txn_type ORDER BY source, txn_type""", s=seller)
    by_src["total"] = by_src["total"].round(2)
    det = _read(conn, """
        SELECT txn_date, order_id, source, txn_type, status, amount
        FROM wallet_txns WHERE seller_name = :s
        ORDER BY txn_date LIMIT :cap""", s=seller, cap=cap)
    total = _read(conn, "SELECT COUNT(*) AS n FROM wallet_txns "
                        "WHERE seller_name = :s", s=seller)["n"].iloc[0]
    return by_src, det, int(total)
