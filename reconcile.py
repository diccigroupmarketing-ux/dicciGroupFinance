"""
reconcile.py , dicciGroupFinance Fasa 1

Baca stor (recon.db), padan order Fighter (COD, J&T) dengan baris bil COD J&T
ikut tracking, kategorikan, dan keluarkan report + exceptions.csv.

Model: bil COD = realiti duit yang dah remit. Order Completed yang belum masuk
mana mana bil = belum_remit (normal kalau baru) atau hilang_lewat (alert kalau > X hari).

Guna: python reconcile.py   (ingest dulu dengan `python ingest.py`)
"""

import warnings
warnings.filterwarnings("ignore")

import re

import pandas as pd

import db
from db import (COD_VALUES, JNT_PROVIDER, COMPLETED, RETURNED, REJECTED,
                REMIT_PENDING_DAYS, TODAY, is_real_awb)

# Exception integriti: masalah betul, tak kira berapa bil dimuatkan
INTEGRITY_EXC = [
    "duit_hantu", "amount_mismatch", "duit_masuk_order_returned",
    "duit_masuk_order_rejected", "in_bil_tapi_intransit", "takde_awb_jnt",
    "takde_tracking", "match_luar_skop",
]
# Aged: tak padan + dah lama. Dalam fasa data tak lengkap, ni didominasi artifak bil tak cukup.
AGED = ["hilang_lewat"]


def _bottles_for_skus(skus_str, sku_map):
    """Pulang (botol_paid, botol_free, senarai_sku_tak_dipetakan) untuk satu order."""
    if not isinstance(skus_str, str) or not skus_str.strip():
        return 0, 0, []
    paid = free = 0
    unmapped = []
    for part in skus_str.split(","):
        part = part.strip()
        if not part:
            continue
        mm = re.match(r"(\d+)x\s*(.+)", part)
        qty, base = (int(mm.group(1)), mm.group(2).strip()) if mm else (1, part)
        key = base.upper()
        if key in sku_map:
            p, f = sku_map[key]
            paid += qty * p
            free += qty * f
        else:
            unmapped.append(base)
    return paid, free, unmapped


def reconcile(conn, pending_days=REMIT_PENDING_DAYS, courier="jnt"):
    """Recon satu courier income stream. Default 'jnt' = tingkah laku asal (baseline).

    Padan order (shipping_provider courier ni) lawan baris bil (courier ni) ikut
    tracking. Schema cod_bills/cod_bill_lines dikongsi semua courier; kita tapis ikut
    cod_bills.courier supaya setiap stream berasingan dan baseline J&T kekal identik.
    """
    cfg = db.COURIERS[courier]
    provider = cfg["provider"]
    courier_label = cfg["courier_label"]
    awb_valid = cfg["awb_valid"]
    no_awb_cat = cfg["no_awb_cat"]

    orders = pd.read_sql("SELECT * FROM orders", conn)
    lines = pd.read_sql("SELECT * FROM cod_bill_lines", conn)
    bills_all = pd.read_sql(
        "SELECT bill_id, courier, settlement_date, source_file FROM cod_bills", conn)

    # Tapis baris bil kepada courier ni sahaja (via bill -> courier).
    courier_bill_ids = set(bills_all.loc[bills_all["courier"] == courier_label, "bill_id"])
    lines = lines[lines["bill_id"].isin(courier_bill_ids)].copy()

    all_trk = set(orders["tracking"].dropna())

    cod = orders[orders["payment_method"].isin(COD_VALUES)].copy()
    other = cod[~cod["shipping_provider"].isin(provider)]
    cbills = bills_all[bills_all["courier"] == courier_label][
        ["bill_id", "settlement_date", "source_file"]].sort_values("settlement_date")
    info = {
        "other_courier": other.groupby("shipping_provider").agg(
            order=("selling_price", "size"), nilai=("selling_price", "sum")
        ).to_dict("index"),
        "n_bills": len(courier_bill_ids),
        "bills": cbills,
    }

    scoped = cod[cod["shipping_provider"].isin(provider)].copy()
    m = scoped.merge(lines, left_on="tracking", right_on="awb",
                     how="outer", indicator=True, suffixes=("_o", "_l"))
    m["umur_hari"] = (TODAY - pd.to_datetime(m["order_date"], errors="coerce")).dt.days

    def cat(r):
        side = r["_merge"]
        if side == "right_only":
            return "duit_hantu" if str(r["awb"]) not in all_trk else "match_luar_skop"
        if side == "both":
            st = r["status"]
            if st == COMPLETED:
                return "tally" if round(r["selling_price"], 2) == round(r["cod_amount"], 2) else "amount_mismatch"
            if st == RETURNED:
                return "duit_masuk_order_returned"
            if st == REJECTED:
                return "duit_masuk_order_rejected"
            return "in_bil_tapi_intransit"
        # left_only: order COD courier ni, takde dalam mana mana bil
        st = r["status"]
        if st == COMPLETED:
            if not awb_valid(str(r["tracking"])):
                return no_awb_cat
            if pd.notna(r["umur_hari"]) and r["umur_hari"] > pending_days:
                return "hilang_lewat"
            return "belum_remit"
        if st == RETURNED:
            return "returned"
        if st == REJECTED:
            return "rejected"
        return "pending"

    m["kategori"] = m.apply(cat, axis=1)
    m["remit"] = m["cod_amount"] - m["fee"]

    sku_map = db.get_sku_map(conn)
    res = m["skus"].apply(lambda s: _bottles_for_skus(s, sku_map))
    m["botol_paid"] = res.map(lambda x: x[0])
    m["botol_free"] = res.map(lambda x: x[1])
    m["botol_total"] = m["botol_paid"] + m["botol_free"]
    info["unmapped_skus"] = sorted({u for x in res for u in x[2]})
    return m, lines, info


def bottles_per_order(conn):
    """Botol per order untuk SEMUA order (semua courier + semua payment) + flag duit.

    Asing dari reconcile() (yang J&T-only) sebab paparan Per Stokis nak gambaran penuh
    botol setiap stokis. Guna semula _bottles_for_skus + sku_map yang sama.

    Lajur tambahan:
      botol_paid / botol_free / botol_total , botol per order ikut mapping SKU.
      duit_disahkan , True bila feed duit sebenar dah sahkan order ni paid.
      botol_dikira  , True bila order Completed DAN duit dah disahkan (botol "betul betul").
    """
    od = pd.read_sql("SELECT * FROM orders", conn)
    sku_map = db.get_sku_map(conn)
    res = od["skus"].apply(lambda s: _bottles_for_skus(s, sku_map))
    od["botol_paid"] = res.map(lambda x: x[0])
    od["botol_free"] = res.map(lambda x: x[1])
    od["botol_total"] = od["botol_paid"] + od["botol_free"]
    paid_ids = db.confirmed_paid_order_ids(conn)
    od["duit_disahkan"] = od["order_id"].isin(paid_ids)
    od["botol_dikira"] = od["duit_disahkan"] & (od["status"] == COMPLETED)
    return od


def reconcile_prepaid(conn, gateway="chip", pending_days=REMIT_PENDING_DAYS):
    """Recon satu gateway prepaid (CHIP / online transfer). Padan ikut order_id (BUKAN
    tracking) sebab prepaid dibayar online masa order. Pulang (m, lines, info) dengan
    nama lajur serasi renderer COD (amount->cod_amount, order_ref->awb, statement->bill_id).
    """
    cfg = db.PREPAID[gateway]
    methods = cfg["methods"]

    orders = pd.read_sql("SELECT * FROM orders", conn)
    pays = pd.read_sql(
        "SELECT order_ref, amount, fee, status, paid_on, settled_on, statement_id, "
        "source_file FROM prepaid_payments WHERE gateway = :g",
        conn, params={"g": gateway})

    scoped = orders[orders["payment_method"].isin(methods)].copy()
    # Elak lajur bertembung masa merge (orders.status vs payment status).
    p = pays.rename(columns={"status": "pay_status", "source_file": "pay_source"})
    m = scoped.merge(p, left_on="order_id", right_on="order_ref",
                     how="outer", indicator=True)
    m["umur_hari"] = (TODAY - pd.to_datetime(m["order_date"], errors="coerce")).dt.days

    # Lajur serasi renderer COD.
    m["cod_amount"] = m["amount"]
    m["awb"] = m["order_ref"]
    m["bill_id"] = m["statement_id"]
    m["delivered_date"] = m["paid_on"]

    def cat(r):
        side = r["_merge"]
        if side == "right_only":
            return "duit_hantu"            # bayaran masuk, takde order Fighter dimuat
        if side == "both":
            return "tally" if round(r["selling_price"], 2) == round(r["amount"], 2) else "amount_mismatch"
        return "belum_bayar"               # order prepaid, takde rekod bayaran lagi

    m["kategori"] = m.apply(cat, axis=1)
    m["remit"] = m["amount"] - m["fee"]

    sku_map = db.get_sku_map(conn)
    res = m["skus"].apply(lambda s: _bottles_for_skus(s, sku_map))
    m["botol_paid"] = res.map(lambda x: x[0])
    m["botol_free"] = res.map(lambda x: x[1])
    m["botol_total"] = m["botol_paid"] + m["botol_free"]

    stmts = (p[["statement_id", "paid_on", "pay_source"]]
             .dropna(subset=["statement_id"]).drop_duplicates("statement_id")
             .rename(columns={"statement_id": "bill_id", "paid_on": "settlement_date",
                              "pay_source": "source_file"})
             .sort_values("settlement_date"))
    lines = pd.DataFrame({"cod_amount": pays["amount"], "fee": pays["fee"]})
    info = {
        "other_courier": {},
        "n_bills": int(stmts["bill_id"].nunique()) if len(stmts) else 0,
        "bills": stmts,
        "unmapped_skus": sorted({u for x in res for u in x[2]}),
    }
    return m, lines, info


def report(m, lines, info):
    db.OUTPUT_DIR.mkdir(exist_ok=True)
    L = []
    L.append("=" * 64)
    L.append("RECONCILIATION FASA 1 , Dicci Impact x J&T COD")
    L.append("=" * 64)

    # Bil dimuatkan
    bills = info["bills"]
    L.append(f"\n### BIL COD DIMUATKAN ({info['n_bills']}) ###")
    if len(bills):
        L.append(bills.to_string(index=False))

    # Kategori
    L.append("\n### RINGKASAN KATEGORI ###")
    for kat, n in m["kategori"].value_counts().items():
        tag = ""
        if kat in INTEGRITY_EXC:
            tag = "  [EXCEPTION]"
        elif kat in AGED:
            tag = "  [aged, perlu lebih bil]"
        L.append(f"  {kat:<26} {n:>5}{tag}")

    # Duit (dari semua baris bil)
    total_cod = lines["cod_amount"].sum()
    total_fee = lines["fee"].sum()
    tally = m["kategori"] == "tally"
    L.append("\n### DUIT (semua bil COD dimuatkan) ###")
    L.append(f"  Parcel dalam bil          : {len(lines)}")
    L.append(f"  Total COD dikutip         : RM {total_cod:,.2f}")
    L.append(f"  Total fee J&T             : RM {total_fee:,.2f}")
    L.append(f"  Net remit (COD - fee)     : RM {total_cod - total_fee:,.2f}")
    L.append(f"  Nilai tally (padan tepat) : RM {m.loc[tally, 'cod_amount'].sum():,.2f} ({int(tally.sum())} order)")

    # Konteks period
    completed = m["status"] == COMPLETED
    L.append("\n### KONTEKS PERIOD (Fighter COD Completed, J&T) ###")
    L.append(f"  Order COD Completed (J&T)  : {int(completed.sum())}")
    L.append(f"  Nilai sepatutnya (Selling) : RM {m.loc[completed, 'selling_price'].sum():,.2f}")
    unmatched = m["kategori"].isin(["belum_remit", "hilang_lewat"])
    L.append(f"  Belum jumpa dalam bil      : {int(unmatched.sum())} order, "
             f"RM {m.loc[unmatched, 'selling_price'].sum():,.2f}")
    L.append("  (Tinggi kalau bil belum lengkap. Tambah bil COD lain untuk resolve.)")

    # Courier lain
    L.append("\n### LUAR SKOP FASA 1 (order COD courier lain) ###")
    if info["other_courier"]:
        for prov, d in info["other_courier"].items():
            L.append(f"  {prov:<18} {int(d['order']):>4} order, RM {d['nilai']:,.2f}")
    else:
        L.append("  (tiada)")

    # Tier 1: exception integriti
    integ = m[m["kategori"].isin(INTEGRITY_EXC)]
    L.append(f"\n### TIER 1 , EXCEPTION INTEGRITI PERLU SIASAT ({len(integ)}) ###")
    cols = ["order_id", "seller_name", "tracking", "awb", "kategori",
            "selling_price", "cod_amount", "umur_hari"]
    cols = [c for c in cols if c in m.columns]
    L.append(integ[cols].to_string(index=False, max_rows=50) if len(integ) else "  (tiada , bersih)")

    # Tier 2: aged unmatched
    aged = m[m["kategori"].isin(AGED)]
    L.append(f"\n### TIER 2 , AGED UNMATCHED ({len(aged)}, RM {aged['selling_price'].sum():,.2f}) ###")
    L.append("  Order Completed > %d hari tapi tak jumpa dalam mana mana bil." % REMIT_PENDING_DAYS)
    L.append("  Dalam fasa ni kemungkinan besar artifak sebab bil belum lengkap.")

    # Pecahan stokis
    L.append("\n### PECAHAN IKUT STOKIS (Seller Name) ###")
    seller = m["seller_name"].fillna("(takde order)")
    L.append(pd.crosstab(seller, m["kategori"]).to_string())

    # Diagnostik
    L.append("\n### DIAGNOSTIK ###")
    if len(lines):
        feepct = (lines["fee"] / lines["cod_amount"] * 100).replace([float("inf")], pd.NA).dropna()
        if len(feepct):
            L.append(f"  Fee % COD : min {feepct.min():.2f}%, purata {feepct.mean():.2f}%, max {feepct.max():.2f}%")
        L.append(f"  Fee/parcel: min RM{lines['fee'].min():.2f}, purata RM{lines['fee'].mean():.2f}, max RM{lines['fee'].max():.2f}")
        d = pd.to_datetime(lines["delivered_date"], errors="coerce")
        p = pd.to_datetime(lines["pickup_date"], errors="coerce")
        transit = (d - p).dt.days.dropna()
        if len(transit):
            L.append(f"  Transit pickup->delivered: min {transit.min()}, median {int(transit.median())}, max {transit.max()}")

    out = "\n".join(L)
    (db.OUTPUT_DIR / "report.txt").write_text(out)
    print(out)

    # exceptions.csv (Tier 1 + Tier 2)
    exc = m[m["kategori"].isin(INTEGRITY_EXC + AGED)]
    exc[cols].to_csv(db.OUTPUT_DIR / "exceptions.csv", index=False)
    print(f"\n[report.txt + exceptions.csv ditulis ke {db.OUTPUT_DIR}]")


if __name__ == "__main__":
    conn = db.get_conn()
    db.init_db(conn)
    report(*reconcile(conn))
    conn.close()
