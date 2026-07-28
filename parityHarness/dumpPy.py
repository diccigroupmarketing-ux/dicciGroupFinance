#!/usr/bin/env python3
"""Dump kategori PER ORDER dari enjin Python, untuk banding silang enjin.

E1 = reconcile.py (rujukan kebenaran, pandas)
E2 = reconSql.py  (laluan SQL; jalan atas sqlite ATAU postgres, ikut DATABASE_URL)

Kunci baris: (order_id, awb, bill_id, kategori). Baris dibanding sebagai MULTISET
disusun, jadi ia perbandingan per-order sebenar (bukan agregat).

Guna (dari root repo, laluan fixture MESTI absolut untuk sqlite):
  DATABASE_URL="sqlite:////abs/path/parityHarness/data/fixture.db" \
      RECON_TODAY=2026-06-18 \
      python3 parityHarness/dumpPy.py e1 > parityHarness/data/e1.json
  DATABASE_URL="postgresql://dev:dev@localhost:5433/parity_tapak" \
      RECON_TODAY=2026-06-18 \
      python3 parityHarness/dumpPy.py e2 > parityHarness/data/e2pg.json

Biasanya awak tak panggil skrip ni terus, guna wrapper: bash parityHarness/jalan.sh
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path("/Users/adizaini/dicciGroupFinance")
sys.path.insert(0, str(ROOT))
assert os.environ.get("DATABASE_URL"), "set DATABASE_URL"
assert "neon" not in os.environ["DATABASE_URL"].lower(), "HARAM sentuh Neon"
os.environ.setdefault("RECON_TODAY", "2026-06-18")

import pandas as pd  # noqa: E402

import db  # noqa: E402

WHICH = sys.argv[1]
COURIERS = ["jnt", "dhl", "ninja"]
PREPAIDS = ["chip"]


def s(v):
    """Normalisasi nilai ke string stabil merentas pandas/sqlite/postgres."""
    if v is None:
        return ""
    if isinstance(v, float) and pd.isna(v):
        return ""
    try:
        if pd.isna(v):
            return ""
    except (TypeError, ValueError):
        pass
    return str(v).strip()


def rows_e1(conn):
    import reconcile
    out = {}
    for k in COURIERS:
        m, _lines, _info = reconcile.reconcile(conn, courier=k)
        out[k] = sorted(
            [s(r.order_id) + "|" + s(r.awb) + "|" + s(r.bill_id) + "|" + s(r.kategori)
             for r in m.itertuples()])
    for k in PREPAIDS:
        m, _p, _info = reconcile.reconcile_prepaid(conn, gateway=k)
        # sisi prepaid: awb = order_ref, bill_id = statement_id
        awbcol = "order_ref" if "order_ref" in m.columns else "awb"
        billcol = "statement_id" if "statement_id" in m.columns else "bill_id"
        out[k] = sorted(
            [s(getattr(r, "order_id", None)) + "|" + s(getattr(r, awbcol, None))
             + "|" + s(getattr(r, billcol, None)) + "|" + s(r.kategori)
             for r in m.itertuples()])
    return out


def rows_e2(conn):
    import reconSql
    from db import REMIT_PENDING_DAYS
    out = {}
    for kind, keys in (("courier", COURIERS), ("prepaid", PREPAIDS)):
        for k in keys:
            reconSql._build_tmp_m(conn, kind, k, REMIT_PENDING_DAYS)
            df = reconSql._read(
                conn, "SELECT order_id, awb, bill_id, kategori FROM tmp_m")
            out[k] = sorted(
                [s(r.order_id) + "|" + s(r.awb) + "|" + s(r.bill_id) + "|" + s(r.kategori)
                 for r in df.itertuples()])
            conn.rollback()
    return out


conn = db.get_conn()
res = rows_e1(conn) if WHICH == "e1" else rows_e2(conn)
json.dump(res, sys.stdout, indent=0, sort_keys=True)
conn.close()
