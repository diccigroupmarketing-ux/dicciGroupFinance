"""Function ingest di Vercel (runtime Python) , guna semula parser ingest.py sebenar.

Laluan: POST /api/pyIngest
  Headers : x-upload-token (mesti padan env UPLOAD_TOKEN),
            x-filename (nama fail asal, URL-encoded)
  Body    : bytes fail mentah (xlsx/xls/csv)
  Respons : {"kind": "fighter|jnt|dhl|ninja|chip|wallet"|null, "rows": n}

Keselamatan: endpoint ni TIDAK dipanggil terus dari browser. Browser -> route
handler Next (/api/upload) -> sini, dengan token yang duduk server-side sahaja.
Enjin: salinan setia db.py + ingest.py dalam api/engine/ (sync via
scripts/syncEngine.sh , jangan edit salinan terus).
"""
import json
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

import db      # noqa: E402  (dari api/engine/)
import ingest  # noqa: E402

_SCHEMA_READY = False


def _ensure_schema():
    global _SCHEMA_READY
    if not _SCHEMA_READY:
        db.init_db()
        _SCHEMA_READY = True


class handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        token = os.environ.get("UPLOAD_TOKEN")
        if not token or self.headers.get("x-upload-token") != token:
            return self._json(401, {"error": "unauthorized"})

        filename = urllib.parse.unquote(self.headers.get("x-filename", "") or "")
        if not filename:
            return self._json(400, {"error": "x-filename header diperlukan"})

        length = int(self.headers.get("content-length", 0) or 0)
        if length <= 0:
            return self._json(400, {"error": "body kosong"})
        data = self.rfile.read(length)

        conn = None
        try:
            _ensure_schema()
            conn = db.get_conn()
            kind, n = ingest.ingest_bytes(data, filename, conn)
            if not kind:
                # Format tak dikenali = TIADA apa ditulis (ingest_bytes tak sentuh DB).
                return self._json(200, {"kind": None, "rows": 0})
            # Bilangan baris bil dikuarantin (double-billed) untuk fail ni; 0
            # untuk feed bukan-bil (fighter/wallet/chip tiada baris konflik).
            q = ingest.conflicts_count(conn, filename)
            return self._json(200, {"kind": kind, "rows": n, "quarantined": q})
        except Exception as e:  # rollback supaya fail rosak tak tinggalkan separuh tulis
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:
                    pass
            return self._json(500, {"error": str(e)[:300]})
        finally:
            if conn is not None:
                conn.close()
