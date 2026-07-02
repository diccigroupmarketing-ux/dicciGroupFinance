#!/usr/bin/env python3
"""backup.py , snapshot semua table durable ke fail luar Neon (jaring keselamatan data upload finance).

Kenapa: data hidup dalam Neon Postgres. Redeploy kod TAK sentuh data, tapi backup luar
melindungi senario yang Neon sendiri tak boleh (URL salah, branch/history habis, project
hilang, overwrite senyap). Jalankan SEBELUM setiap deploy kita, dan simpan folder backups/
di tempat selamat (folder ni gitignored, takkan masuk repo).

Guna:
    python backup.py                      # snapshot (auto: Postgres kalau DATABASE_URL ada, else SQLite lokal)
    python backup.py --verify backups/<folder>   # banding DB semasa vs snapshot (kesan overwrite/wipe/re-point)

Output: backups/<YYYYMMDD-HHMMSS>/<table>.csv + manifest.json (row count + content hash per table).
Hash = seed-immune content check: kesan bukan setakat wipe, tapi juga overwrite senyap & re-point awb.
"""
import os
import sys
import json
import hashlib
import datetime

import pandas as pd

import db

# Table durable yang enjin recon baca. sku_bottles = config (self-healing) tapi disertakan
# supaya restore penuh + mapping SKU custom finance turut selamat. order_skus = derived
# (boleh dibina semula dari orders.skus) tapi murah untuk disertakan.
TABLES = ["orders", "order_skus", "cod_bills", "cod_bill_lines", "prepaid_payments",
          "wallet_txns", "sku_bottles"]


def _table_hash(dff):
    """Hash kandungan deterministik (susun ikut semua lajur dulu, jadi bebas dari urutan baris)."""
    if dff.empty:
        return "empty"
    ordered = dff.sort_values(list(dff.columns)).reset_index(drop=True)
    return hashlib.sha256(ordered.to_csv(index=False).encode("utf-8")).hexdigest()[:16]


def snapshot():
    eng = db.get_engine()
    dialect = eng.dialect.name
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = os.path.join("backups", ts)
    os.makedirs(outdir, exist_ok=True)
    manifest = {"timestamp": ts, "dialect": dialect, "tables": {}}
    with eng.connect() as conn:
        for t in TABLES:
            try:
                dff = pd.read_sql(f"SELECT * FROM {t}", conn)
            except Exception as e:  # table tak wujud lagi, dll
                manifest["tables"][t] = {"error": str(e)}
                continue
            dff.to_csv(os.path.join(outdir, t + ".csv"), index=False)
            manifest["tables"][t] = {"rows": int(len(dff)), "hash": _table_hash(dff)}
    with open(os.path.join(outdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Snapshot -> {outdir}  ({dialect})")
    for t, m in manifest["tables"].items():
        print(f"  {t:<18} {m}")
    return outdir


def verify(folder):
    with open(os.path.join(folder, "manifest.json")) as f:
        man = json.load(f)
    eng = db.get_engine()
    print(f"Verify DB semasa ({eng.dialect.name}) lawan snapshot {folder} ({man['dialect']})")
    ok = True
    with eng.connect() as conn:
        for t in TABLES:
            snap = man["tables"].get(t, {})
            try:
                dff = pd.read_sql(f"SELECT * FROM {t}", conn)
                cur = {"rows": int(len(dff)), "hash": _table_hash(dff)}
            except Exception as e:
                cur = {"error": str(e)}
            match = snap.get("hash") is not None and snap.get("hash") == cur.get("hash")
            ok = ok and match
            print(f"  {t:<18} snapshot={snap}  semasa={cur}  {'OK' if match else 'DIFF'}")
    print("SEMUA PADAN" if ok else "TAK PADAN , siasat sebelum deploy")
    return ok


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--verify":
        verify(sys.argv[2])
    else:
        snapshot()
