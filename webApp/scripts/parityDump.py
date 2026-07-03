#!/usr/bin/env python3
"""Dump agregat reconSql.py (enjin Python, rujukan) ke JSON untuk parity check
lawan lib/recon.ts. Jalankan lawan dev Postgres embedded.

Guna: python3 scripts/parityDump.py > scripts/parityPython.json
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ["DATABASE_URL"] = "postgresql://dev:dev@localhost:5433/dicci"

import db
import reconSql


def r2(x):
    return round(float(x or 0), 2)


def main():
    out = {}
    conn = db.get_conn()
    for key in ("jnt", "dhl", "ninja"):
        s = reconSql.stream_summary(conn, "courier", key)
        daily = [
            {"day": r["day"], "parcel": int(r["parcel"]), "cod": r2(r["cod_dikutip"]),
             "fee": r2(r["fee"]), "tally": int(r["tally"]),
             "exception": int(r["exception"]), "botol": int(r["botol"]),
             "botol_free": int(r["botol_free"])}
            for _, r in s["daily"].iterrows()
        ]
        per_bill = sorted(
            [{"bill_id": r["bill_id"], "parcel": int(r["parcel"]), "cod": r2(r["cod"]),
              "fee": r2(r["fee"]), "tally": int(r["tally"]), "exc": int(r["exc"])}
             for _, r in s["per_bill"].iterrows()],
            key=lambda x: x["bill_id"],
        )
        out[key] = {
            "katN": {k: int(v) for k, v in sorted(s["kat_n"].items())},
            "linesN": int(s["lines_n"]), "linesCod": r2(s["lines_cod"]),
            "linesFee": r2(s["lines_fee"]),
            "integN": int(s["integ_n"]), "agedN": int(s["aged_n"]),
            "tallyN": int(s["tally_n"]), "tallyCod": r2(s["tally_cod"]),
            "daily": daily, "perBill": per_bill,
        }
    conn.close()
    json.dump(out, sys.stdout, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
