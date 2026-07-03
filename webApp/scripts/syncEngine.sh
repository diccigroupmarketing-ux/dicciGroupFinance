#!/bin/bash
# Salin enjin ingest (rujukan di root repo) ke api/engine/ untuk function Vercel.
# JANGAN edit fail dalam api/engine/ terus , edit versi root, lepas tu run skrip ni.
# Run dari folder webApp:  bash scripts/syncEngine.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p api/engine
cp ../db.py ../ingest.py api/engine/
echo "engine sync: db.py + ingest.py -> api/engine/"
diff -q ../db.py api/engine/db.py && diff -q ../ingest.py api/engine/ingest.py && echo "sahkan: salinan identik"
