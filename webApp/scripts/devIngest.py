#!/usr/bin/env python3
"""Laluan ingest untuk DEV lokal , dipanggil oleh route handler /api/upload
(INGEST_MODE=local). Guna enjin rujukan di root repo terus (bukan salinan),
tulis ke DATABASE_URL semasa (dev Postgres embedded).

Guna: python3 scripts/devIngest.py <fail_tmp> <nama_asal>
Output: JSON {"kind": ..., "rows": n} ke stdout.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import db      # noqa: E402
import ingest  # noqa: E402


def main():
    tmp_path, filename = sys.argv[1], sys.argv[2]
    data = Path(tmp_path).read_bytes()
    db.init_db()
    conn = db.get_conn()
    try:
        res = ingest.ingest_bytes(data, filename, conn)
        if not res.kind:
            # Fail ditolak: sebab + mesej plain (bukan error mentah).
            print(json.dumps({
                "kind": None, "rows": 0, "reason": res.reason,
                "message": res.message, "detectedType": res.detected_type,
            }))
        else:
            print(json.dumps({
                "kind": res.kind, "rows": res.rows,
                "quarantined": res.quarantined, "reason": res.reason,
            }))
    except Exception as e:
        conn.rollback()
        print(json.dumps({
            "reason": "server_error",
            "message": ("Upload failed due to a server error. Please try again, "
                        "or send the file to the owner."),
            "detail": str(e)[:300],
        }))
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
