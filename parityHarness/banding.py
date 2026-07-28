#!/usr/bin/env python3
"""Banding dump kategori per order 3 enjin (multiset, row-by-row).
Guna (dari root repo):
  python3 parityHarness/banding.py parityHarness/data/e1.json \\
      parityHarness/data/e2sqlite.json parityHarness/data/e2pg.json \\
      parityHarness/data/e3.json
Fail pertama = rujukan (E1). Exit code 1 kalau ada beza."""
import collections
import json
import sys

names = sys.argv[1:]
data = {n: json.load(open(n)) for n in names}
base = names[0]
fail = 0
for k in sorted(data[base]):
    A = collections.Counter(data[base][k])
    line = [f"[{k}] {len(data[base][k])} baris"]
    for n in names[1:]:
        B = collections.Counter(data[n].get(k, []))
        if A == B:
            line.append(f"{n}=PADAN")
        else:
            fail += 1
            line.append(f"{n}=TAK PADAN")
            for it, c in (A - B).items():
                line.append(f"    hanya {base}: {it} x{c}")
            for it, c in (B - A).items():
                line.append(f"    hanya {n}: {it} x{c}")
    print("  ".join(line[:len(names)]) if not fail else "\n".join(line))
    # ringkasan kategori
    print("      kat:", dict(sorted(collections.Counter(
        x.rsplit("|", 1)[1] for x in data[base][k]).items())))
print("\nPARITY 3 ENJIN: " + ("GAGAL" if fail else "LULUS"))
sys.exit(1 if fail else 0)
