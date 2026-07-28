#!/usr/bin/env bash
# Wrapper resipi penuh harness parity 3 enjin recon, hujung ke hujung.
#
#   E1 = reconcile.py   (pandas, RUJUKAN KEBENARAN)
#   E2 = reconSql.py    (laluan SQL, dua dialek: sqlite + postgres)
#   E3 = webApp/lib/recon.ts (TypeScript, atas dev Postgres 5433)
#
# Guna:
#   bash parityHarness/jalan.sh                       # fixture default
#   bash parityHarness/jalan.sh /laluan/fixtureLain.db
#
# Exit code 0 = parity LULUS, bukan sifar = ada beza (atau setup gagal).
#
# SYARAT: dev Postgres embedded port 5433 mesti HIDUP.
#   cd webApp && nohup node scripts/devDb.mjs >/tmp/devDb.log 2>&1 &   (tunggu ~12s)
#
# Harness ni TIDAK menyentuh Neon dan TIDAK menyentuh db dev owner (`dicci`).
# Ia bina semula satu db PG berasingan (default `parity_tapak`) setiap run.
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HARNESS")"
DATA="$HARNESS/data"
PGDB="${PARITY_PG_DB:-parity_tapak}"
# awalan nama fail dump, tukar kalau tak nak timpa dump run sebelum ini
PRE="${PARITY_OUT_PREFIX:-}"
export RECON_TODAY="${RECON_TODAY:-2026-06-18}"

FIXTURE="${1:-$DATA/fixture.db}"
[ -f "$FIXTURE" ] || { echo "FIXTURE TIADA: $FIXTURE"; exit 2; }
FIXTURE="$(cd "$(dirname "$FIXTURE")" && pwd)/$(basename "$FIXTURE")"

[ "$PGDB" != "dicci" ] || { echo "HARAM guna db dev owner (dicci)"; exit 2; }
case "${DATABASE_URL:-}" in
  *neon*|*NEON*) echo "HARAM sentuh Neon, buang DATABASE_URL dulu"; exit 2;;
esac
unset DATABASE_URL

mkdir -p "$DATA"
PY="${PYTHON_BIN:-python3}"
TSX="$ROOT/webApp/node_modules/.bin/tsx"

say() { printf '\n=== %s ===\n' "$1"; }

# --- 0. baseline suci mesti kekal -------------------------------------------
say "0. baseline suci (data/baselineRecon.db)"
BASE_OUT="$(cd "$ROOT" && DATABASE_URL="sqlite:///$ROOT/data/baselineRecon.db" "$PY" reconcile.py 2>&1)" || {
  echo "$BASE_OUT" | tail -20; echo "BASELINE GAGAL JALAN"; exit 1; }
echo "$BASE_OUT" | grep -E "Nilai tally" || true
if ! echo "$BASE_OUT" | grep -q "RM 63,912.00"; then
  echo "BASELINE TERCEMAR: RM 63,912.00 tak jumpa"; exit 1
fi
if ! echo "$BASE_OUT" | grep -q "369 order"; then
  echo "BASELINE TERCEMAR: 369 order tak jumpa"; exit 1
fi
echo "baseline OK: RM 63,912.00 (369 order)"

# --- 1. sedia node_modules (symlink ke webApp) -------------------------------
say "1. sedia node_modules"
[ -d "$ROOT/webApp/node_modules" ] || { echo "webApp/node_modules tiada, jalankan npm install dulu"; exit 2; }
ln -sfn "$ROOT/webApp/node_modules" "$HARNESS/node_modules"
[ -x "$TSX" ] || { echo "tsx tiada di $TSX"; exit 2; }
echo "symlink sedia: $HARNESS/node_modules"

# --- 2. salinan kerja fixture (fixture asal kekal tak disentuh) --------------
say "2. salinan kerja fixture"
WORK="$DATA/${PRE}kerjaFixture.db"
cp "$FIXTURE" "$WORK"
echo "fixture : $FIXTURE"
echo "salinan : $WORK"

# --- 3. jana mirror recon.ts dari sumber sebenar ------------------------------
say "3. jana mirror recon.ts"
MIRROR="$DATA/reconMirror.ts"
node "$HARNESS/buatMirror.mjs" "$MIRROR"

# --- 4. muat fixture ke db PG berasingan --------------------------------------
say "4. muat fixture ke Postgres dev ($PGDB)"
"$PY" "$HARNESS/loadFixtureToPg.py" "$WORK" "$PGDB"

SQLITE_URL="sqlite:///$WORK"
PG_URL="postgresql://dev:dev@localhost:5433/$PGDB"

# --- 5. dump 4 enjin -----------------------------------------------------------
say "5. dump E1 (reconcile.py, sqlite)"
DATABASE_URL="$SQLITE_URL" "$PY" "$HARNESS/dumpPy.py" e1 > "$DATA/${PRE}e1.json"

say "5b. dump E2 dialek sqlite (reconSql.py)"
DATABASE_URL="$SQLITE_URL" "$PY" "$HARNESS/dumpPy.py" e2 > "$DATA/${PRE}e2sqlite.json"

say "5c. dump E2 dialek postgres (reconSql.py)"
DATABASE_URL="$PG_URL" "$PY" "$HARNESS/dumpPy.py" e2 > "$DATA/${PRE}e2pg.json"

say "5d. dump E3 (webApp/lib/recon.ts, postgres)"
cd "$HARNESS"
DATABASE_URL="$PG_URL" RECON_MIRROR="$MIRROR" RECON_OUT="$DATA/${PRE}e3.json" \
  "$TSX" "$HARNESS/dumpTs.mts"

# --- 6. banding row-by-row ------------------------------------------------------
say "6. banding 4 dump (multiset per order)"
"$PY" "$HARNESS/banding.py" \
  "$DATA/${PRE}e1.json" "$DATA/${PRE}e2sqlite.json" "$DATA/${PRE}e2pg.json" "$DATA/${PRE}e3.json"
