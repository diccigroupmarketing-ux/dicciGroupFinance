#!/usr/bin/env python3
"""backfillJntBillId.py , kira semula bill_id baris bil J&T LAMA ikut peraturan
baru (akaun + HARI penghantaran), tanpa menyentuh sen pun nilai duit.

KENAPA: sebelum 30 Jul 2026 bill_id J&T diambil dari NAMA fail dengan regex
(JTMY\\w+), dan itu nombor AKAUN, bukan nombor bil. Semua statement runtuh jadi
SATU baris cod_bills. Lihat nota "IDENTITI BIL J&T" dalam ingest.py untuk cerita
penuh. Skrip ni memindahkan data yang sudah masuk ke identiti baru:

    JTMY031691  ->  JTMY031691-20260520, JTMY031691-20260521, ...

APA YANG DIUBAH (hanya baris courier = 'J&T Express'):
  * cod_bill_lines.bill_id     , ikut delivered_date baris itu sendiri
  * cod_bills                  , baris lama dipecah jadi satu baris per hari;
                                 settlement_date + source_file diwarisi dari
                                 baris lama, courier kekal 'J&T Express'
  * bill_line_conflicts        , bill_id_new/bill_id_existing dipetakan semula
                                 kalau boleh; baris yang jadi bertindih dibuang
                                 (konflik yang sebenarnya bukan konflik)
TIDAK DIUBAH: cod_bill_lines.cod_amount/fee/tarikh, orders, wallet, apa apa
jadual duit lain. bank_deposits SENGAJA tak disentuh (lihat bawah).

bank_deposits: amaun bank ditaip TANGAN oleh finance dan kuncinya bill_id. Satu
bill_id lama boleh pecah jadi belasan bil harian, jadi TIADA cara jujur untuk
membahagi amaun tu automatik. Skrip cuma LAPOR baris yang jadi yatim supaya
finance taip semula ikut bil harian yang betul.

IDEMPOTENT: jalankan berulang kali selamat. Baris yang sudah ikut format baru
(mengandungi '-' selepas token akaun) dikesan dan dilangkau.

Guna:
    python3 backfillJntBillId.py                     # DRY RUN (default)
    python3 backfillJntBillId.py --write             # betul betul tulis
    DATABASE_URL=... python3 backfillJntBillId.py    # DB lain

JANGAN jalankan atas prod tanpa keputusan owner. Pilihan lain yang sama sah:
padam data J&T dan minta team re-upload fail asal (ingest baru terus betul).
"""
import argparse
import re

from sqlalchemy import bindparam, text

import db
import ingest

COURIER = "J&T Express"
# Format baru: <akaun>-<8 digit> atau <akaun>-UNDATED.
_NEW_FORMAT = re.compile(r"-(\d{8}|UNDATED)$")


def _is_new_format(bill_id):
    return bool(_NEW_FORMAT.search(bill_id or ""))


def plan(conn):
    """Kira pelan pemindahan TANPA menulis apa apa.

    Pulang dict: bills lama (id -> meta), peta baris (awb -> bill_id baru),
    bil baru yang perlu wujud, dan senarai bank_deposits yang jadi yatim."""
    bills = {r[0]: {"settlement_date": r[1], "source_file": r[2]}
             for r in conn.execute(text(
                 "SELECT bill_id, settlement_date, source_file FROM cod_bills "
                 "WHERE courier = :c"), {"c": COURIER})}
    old_ids = [b for b in bills if not _is_new_format(b)]

    line_map, new_bills, untouched = {}, {}, 0
    if old_ids:
        rows = conn.execute(
            text("SELECT awb, bill_id, delivered_date FROM cod_bill_lines "
                 "WHERE bill_id IN :ids")
            .bindparams(bindparam("ids", expanding=True)),
            {"ids": old_ids}).fetchall()
        for awb, bill_id, delivered in rows:
            account = ingest.jnt_account(bill_id)
            new_id = ingest.jnt_bill_id(account, delivered)
            if new_id == bill_id:
                untouched += 1
                continue
            line_map[awb] = (bill_id, new_id)
            if new_id not in bills and new_id not in new_bills:
                new_bills[new_id] = dict(bills[bill_id])

    # bank_deposits yang kuncinya bil lama = tidak lagi ada padanan.
    orphan_bank = []
    try:
        orphan_bank = [(r[0], r[1]) for r in conn.execute(text(
            "SELECT bill_id, actual_amount FROM bank_deposits"))
            if r[0] in bills and not _is_new_format(r[0])]
    except Exception:
        pass          # jadual dicipta malas oleh webApp; tiada = tiada masalah

    return {"old_bills": old_ids, "line_map": line_map, "new_bills": new_bills,
            "untouched": untouched, "orphan_bank": orphan_bank,
            "all_bills": bills}


def apply_plan(conn, p):
    """Tulis pelan. Turutan: cipta bil baru -> pindah baris -> petakan konflik
    -> buang bil lama yang dah kosong."""
    stamp = ingest.now_iso()
    if p["new_bills"]:
        conn.execute(ingest.BILLS_UPSERT, [
            {"bill_id": bid, "courier": COURIER,
             "settlement_date": meta["settlement_date"],
             "source_file": meta["source_file"], "ingested_at": stamp}
            for bid, meta in sorted(p["new_bills"].items())])
    for awb, (_, new_id) in p["line_map"].items():
        conn.execute(text("UPDATE cod_bill_lines SET bill_id = :new "
                          "WHERE awb = :awb"), {"new": new_id, "awb": awb})

    # Konflik kuarantin: petakan dua dua hujung ikut baris yang sama.
    remap = {awb: new for awb, (_, new) in p["line_map"].items()}
    conflicts = conn.execute(text(
        "SELECT awb, bill_id_new, bill_id_existing FROM bill_line_conflicts")
    ).fetchall()
    for awb, bnew, bexist in conflicts:
        mapped = remap.get(awb)
        if mapped is None or _is_new_format(bnew):
            continue
        # bill_id_existing = bil baris yang MENANG (ada dalam cod_bill_lines).
        # bill_id_new = bil fail kedua; kita tak tahu harinya, jadi kekalkan
        # nilai lama dengan penanda supaya finance nampak ia warisan.
        if mapped == bexist:
            conn.execute(text("DELETE FROM bill_line_conflicts "
                              "WHERE awb = :a AND bill_id_new = :n"),
                         {"a": awb, "n": bnew})
            continue
        conn.execute(text(
            "UPDATE bill_line_conflicts SET bill_id_existing = :e "
            "WHERE awb = :a AND bill_id_new = :n"),
            {"e": mapped, "a": awb, "n": bnew})

    # Bil lama yang sudah tiada baris = buang (kalau masih ada baris, biarkan,
    # supaya tiada baris jadi yatim tanpa header).
    for bid in p["old_bills"]:
        left = conn.execute(text("SELECT COUNT(*) FROM cod_bill_lines "
                                 "WHERE bill_id = :b"), {"b": bid}).scalar()
        if not left:
            conn.execute(text("DELETE FROM cod_bills WHERE bill_id = :b"),
                         {"b": bid})
    conn.commit()


def money_snapshot(conn):
    """Cap duit J&T (bilangan baris + jumlah COD + fee). Mesti IDENTIK sebelum
    dan selepas , backfill ni pindah label, bukan duit."""
    return conn.execute(text(
        "SELECT COUNT(*), ROUND(COALESCE(SUM(cod_amount),0),2), "
        "       ROUND(COALESCE(SUM(fee),0),2) "
        "FROM cod_bill_lines l JOIN cod_bills b ON b.bill_id = l.bill_id "
        "WHERE b.courier = :c"), {"c": COURIER}).fetchone()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true",
                    help="betul betul tulis (default: dry run, papar sahaja)")
    args = ap.parse_args()

    with db.get_engine().connect() as conn:
        before = money_snapshot(conn)
        p = plan(conn)
        print("Bil J&T format LAMA  : %d" % len(p["old_bills"]))
        for bid in sorted(p["old_bills"]):
            print("   %s" % bid)
        print("Baris akan berpindah : %d" % len(p["line_map"]))
        print("Baris sudah betul    : %d" % p["untouched"])
        print("Bil BARU akan dicipta: %d" % len(p["new_bills"]))
        for bid in sorted(p["new_bills"]):
            n = sum(1 for _, (_, new) in p["line_map"].items() if new == bid)
            print("   %-28s %4d baris" % (bid, n))
        if p["orphan_bank"]:
            print("\n⚠ bank_deposits guna bill_id LAMA (finance kena taip semula "
                  "ikut bil harian, skrip TIDAK sentuh):")
            for bid, amt in p["orphan_bank"]:
                print("   %-28s RM %s" % (bid, amt))
        print("\nDuit J&T sebelum (baris, COD, fee): %s" % (tuple(before),))

        if not args.write:
            print("\nDRY RUN , tiada apa apa ditulis. Tambah --write untuk tulis.")
            return
        apply_plan(conn, p)
        after = money_snapshot(conn)
        print("Duit J&T selepas (baris, COD, fee): %s" % (tuple(after),))
        if tuple(before) != tuple(after):
            raise SystemExit(
                "BERHENTI: jumlah duit J&T BERUBAH selepas backfill. Ini patut "
                "mustahil (skrip hanya menukar label bil). Rollback dari backup.")
        print("Siap. Duit identik, label bil sahaja berubah.")


if __name__ == "__main__":
    main()
