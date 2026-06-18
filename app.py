"""
app.py , dicciGroupFinance

UI web (Streamlit) untuk reconciliation J&T COD.
Balut enjin Python sedia ada (db.py, ingest.py, reconcile.py).
Struktur: OVERVIEW sentiasa di atas (cerita duit), tab cuma drill-down.

Run: streamlit run app.py
"""

import warnings
warnings.filterwarnings("ignore")

import pandas as pd
import streamlit as st
from sqlalchemy import text

import db
import theme
from ingest import ingest_buffer
from reconcile import reconcile, INTEGRITY_EXC, AGED

st.set_page_config(page_title="Dicci Group Finance , Recon J&T COD",
                   page_icon=theme.page_icon(), layout="wide",
                   initial_sidebar_state="collapsed")
theme.inject_css()
db.init_db()

theme.page_header("Reconciliation J&T COD",
                  "Dicci Impact · Fasa 1 · padan ikut nombor tracking")

SHOW_COLS = ["order_id", "seller_name", "tracking", "awb", "kategori",
             "selling_price", "cod_amount", "umur_hari"]
GRAINS = ["Harian", "Mingguan", "Bulanan", "Suku Tahun", "Tahunan"]


def rm_cols(*names):
    # Papar lajur harga dengan prefix "RM " (nilai kekal nombor, boleh sort).
    return {n: st.column_config.NumberColumn(format="RM %.2f") for n in names}


def period_key(ts, grain):
    if grain == "Mingguan":
        return (ts - pd.to_timedelta(ts.dt.weekday, unit="D")).dt.normalize()
    if grain == "Bulanan":
        return ts.dt.to_period("M").dt.start_time
    if grain == "Suku Tahun":
        return ts.dt.to_period("Q").dt.start_time
    if grain == "Tahunan":
        return ts.dt.to_period("Y").dt.start_time
    return ts.dt.normalize()


def period_label(d, grain):
    d = pd.Timestamp(d)
    if grain == "Mingguan":
        return "Minggu " + d.strftime("%d %b %Y")
    if grain == "Bulanan":
        return d.strftime("%b %Y")
    if grain == "Suku Tahun":
        return f"S{(d.month - 1) // 3 + 1} {d.year}"
    if grain == "Tahunan":
        return str(d.year)
    return d.strftime("%d %b %Y")


# ============ Panel operasi (upload + tetapan + status), di halaman utama ============
# Sengaja di main page, BUKAN sidebar: expander main page toggle dia reliable,
# sidebar Streamlit ada bug butang buka balik hilang bila ditutup.
with st.expander("Panel operasi , upload data, tetapan & status stor", expanded=False):
    op_up, op_set = st.columns(2)
    with op_up:
        st.markdown("**Data & Upload**")
        files = st.file_uploader(
            "Export Fighter atau bil COD J&T (.xlsx / .csv). Boleh banyak sekali.",
            type=["xlsx", "xls", "csv"], accept_multiple_files=True,
        )
        if files and st.button("Ingest ke stor", type="primary"):
            conn = db.get_conn()
            db.init_db(conn)
            for f in files:
                try:
                    kind, n = ingest_buffer(f, f.name, conn)
                    if kind:
                        st.success(f"{f.name}: **{kind}**, {n} baris di-upsert")
                    else:
                        st.warning(f"{f.name}: tak kenal format")
                except Exception as e:
                    st.error(f"{f.name}: gagal , {e}")
            conn.close()
            st.rerun()
    with op_set:
        st.markdown("**Tetapan**")
        pending_days = st.slider("Aging: hari sebelum 'hilang_lewat'", 3, 45, db.REMIT_PENDING_DAYS)
        confirm = st.checkbox("Saya faham, benarkan reset stor")
        if st.button("Reset stor (kosongkan semua)", disabled=not confirm):
            db.reset_db()
            st.success("Stor dikosongkan.")
            st.rerun()

    conn = db.get_conn()
    n_ord = conn.execute(text("SELECT COUNT(*) FROM orders")).scalar()
    n_line = conn.execute(text("SELECT COUNT(*) FROM cod_bill_lines")).scalar()
    n_bill = conn.execute(text("SELECT COUNT(*) FROM cod_bills")).scalar()
    conn.close()
    st.caption(f"Stor: {n_ord:,} order · {n_line:,} baris bil · {n_bill} bil COD")


# ============ Reconcile ============
conn = db.get_conn()
db.init_db(conn)
if conn.execute(text("SELECT COUNT(*) FROM orders")).scalar() == 0:
    conn.close()
    st.info("Belum ada data. Buka **Panel operasi** di atas, bahagian **Data & Upload**, "
            "dan muat naik export Fighter (dan bil J&T) dulu.")
    st.stop()

m, lines, info = reconcile(conn, pending_days=pending_days)
conn.close()

tally = m["kategori"] == "tally"
integ = m[m["kategori"].isin(INTEGRITY_EXC)]
aged = m[m["kategori"].isin(AGED)]
total_cod = float(lines["cod_amount"].sum())
total_fee = float(lines["fee"].sum())
show_cols = [c for c in SHOW_COLS if c in m.columns]


# ============ OVERVIEW (sentiasa di atas, cerita duit) ============
bill_rows = m[m["bill_id"].notna()].copy()
g = None
if not len(bill_rows):
    st.info("Belum ada bil COD dimuatkan. Upload bil J&T di sidebar untuk lihat aliran tunai.")
else:
    pcol1, pcol2 = st.columns([2, 1])
    with pcol1:
        grain = st.segmented_control("Tempoh", GRAINS, default="Harian", key="grain") or "Harian"

    bill_rows["dt"] = pd.to_datetime(bill_rows["delivered_date"], errors="coerce")
    bill_rows = bill_rows.dropna(subset=["dt"])
    bill_rows["pkey"] = period_key(bill_rows["dt"], grain)
    g = bill_rows.groupby("pkey").agg(
        parcel=("awb", "size"),
        botol=("botol_total", "sum"),
        botol_free=("botol_free", "sum"),
        cod_dikutip=("cod_amount", "sum"),
        fee=("fee", "sum"),
        tally=("kategori", lambda s: int((s == "tally").sum())),
        exception=("kategori", lambda s: int(s.isin(INTEGRITY_EXC).sum())),
    ).reset_index().sort_values("pkey")
    g["net_remit"] = (g["cod_dikutip"] - g["fee"]).round(2)
    g["cod_dikutip"] = g["cod_dikutip"].round(2)
    g["fee"] = g["fee"].round(2)
    g["tempoh"] = g["pkey"].map(lambda d: period_label(d, grain))

    labels = g["tempoh"].tolist()
    with pcol2:
        sel = st.selectbox("Pilih tempoh", labels, index=len(labels) - 1, key=f"period_{grain}")
    row = g[g["tempoh"] == sel].iloc[0]

    exc_n = int(row["exception"])
    theme.hero_band(
        label=f"Duit patut masuk bank · {sel}",
        value=float(row["net_remit"]),
        sublines=f"net remit selepas fee · {int(row['parcel'])} parcel · {int(row['botol'])} botol",
        flag_text=("Tiada exception tempoh ni" if exc_n == 0 else f"{exc_n} exception tempoh ni"),
        flag_ok=(exc_n == 0),
    )

    risk = float(integ["cod_amount"].sum()) if len(integ) else None
    theme.alert_band(len(integ), risk=risk)

    theme.kpi_row([
        ("COD dikutip", f"RM {row['cod_dikutip']:,.0f}"),
        ("Fee J&T", f"RM {row['fee']:,.0f}"),
        ("Parcel", f"{int(row['parcel'])}"),
        ("Botol", f"{int(row['botol'])}"),
    ])

    theme.section("Net remit ikut tempoh", "semua tempoh, untuk lihat trend")
    st.altair_chart(theme.bar_chart_brand(g, "tempoh", "net_remit"), use_container_width=True)


# ============ Drill-down tabs ============
theme.section("Butiran", "drill-down ikut tempoh, bil, dan audit")
tab_tempoh, tab_bill, tab_audit, tab_sku = st.tabs(
    ["Per Tempoh", "Per Bil", "Audit", "SKU / Botol"])

# ===== Per Tempoh: jadual penuh =====
with tab_tempoh:
    if g is None:
        st.info("Belum ada bil COD dimuatkan.")
    else:
        st.caption(f"Keseluruhan {len(g)} tempoh: {int(g['parcel'].sum())} parcel, "
                   f"{int(g['botol'].sum())} botol, RM {g['net_remit'].sum():,.2f} net remit.")
        st.dataframe(
            g[["tempoh", "parcel", "botol", "botol_free", "cod_dikutip", "fee", "net_remit", "tally", "exception"]],
            width="stretch", hide_index=True,
            column_config=rm_cols("cod_dikutip", "fee", "net_remit"),
        )
        st.caption("Net remit = COD dikutip tolak fee J&T (patut mendarat bank). "
                   "botol = jumlah botol fizikal, botol_free = portion percuma (untuk kira kos nanti). "
                   "Lajur 'bank sebenar' + 'sepadan?' ditambah bila data bank tiba.")

# ===== Per Bil =====
with tab_bill:
    bills = info["bills"]
    if not len(bills):
        st.info("Belum ada bil COD dimuatkan. Upload bil J&T di sidebar dulu.")
    else:
        opts = {}
        for _, r in bills.iterrows():
            opts[f"{r['bill_id']}  ({r['settlement_date'] or 'tarikh?'})"] = r["bill_id"]
        choice = st.selectbox("Pilih bil (satu settlement = satu kali duit masuk)", list(opts.keys()))
        bid = opts[choice]

        b = m[m["bill_id"] == bid].copy()
        b_cod = float(b["cod_amount"].sum())
        b_fee = float(b["fee"].sum())
        b_net = b_cod - b_fee
        b_tally = int((b["kategori"] == "tally").sum())
        b_exc = b[b["kategori"].isin(INTEGRITY_EXC)]

        d1, d2, d3, d4 = st.columns(4)
        d1.metric("Parcel dalam bil", len(b))
        d2.metric("COD dikutip", f"RM {b_cod:,.2f}")
        d3.metric("Net remit (patut masuk bank)", f"RM {b_net:,.2f}", f"tolak fee RM {b_fee:,.2f}")
        d4.metric("Tally / Exception", f"{b_tally} / {len(b_exc)}")

        if len(b_exc) == 0:
            st.success(f"Bil ni bersih: semua {len(b)} parcel tally. RM {b_net:,.2f} patut masuk bank.")
        else:
            st.warning(f"Bil ni ada {len(b_exc)} parcel perlu siasat (duit hantu atau amount mismatch). Lihat jadual bawah.")

        theme.section("Semak lawan bank")
        bank_amt = st.number_input("Jumlah sebenar masuk bank untuk bil ni (RM)",
                                   min_value=0.0, value=0.0, step=1.0, format="%.2f")
        if bank_amt > 0:
            diff = bank_amt - b_net
            if abs(diff) < 0.01:
                st.success(f"Padan tepat dengan Net remit (RM {b_net:,.2f}).")
            else:
                st.error(f"Beza RM {diff:,.2f}  (bank RM {bank_amt:,.2f} vs Net remit RM {b_net:,.2f}). Perlu siasat.")

        theme.section("Senarai parcel dalam bil ni")
        bill_cols = [c for c in ["awb", "order_id", "seller_name", "kategori",
                                 "selling_price", "cod_amount", "fee", "remit"] if c in b.columns]
        st.dataframe(theme.style_kategori(b[bill_cols]), width="stretch", hide_index=True,
                     column_config=rm_cols("selling_price", "cod_amount", "fee", "remit"))

# ===== Audit: integriti penuh =====
with tab_audit:
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Tally (padan tepat)", int(tally.sum()), f"RM {m.loc[tally, 'cod_amount'].sum():,.0f}")
    c2.metric("COD dikutip", f"RM {total_cod:,.0f}")
    c3.metric("Net remit", f"RM {total_cod - total_fee:,.0f}")
    c4.metric("Tier 1 (masalah)", int(len(integ)))
    c5.metric("Tier 2 (aged)", int(len(aged)))

    with st.expander(f"Bil COD dimuatkan ({info['n_bills']})"):
        st.dataframe(info["bills"], width="stretch", hide_index=True)

    col_a, col_b = st.columns(2)
    with col_a:
        theme.section("Ringkasan kategori")
        cc = m["kategori"].value_counts().rename_axis("kategori").reset_index(name="bilangan")
        st.dataframe(theme.style_kategori(cc), width="stretch", hide_index=True)
    with col_b:
        if info["other_courier"]:
            theme.section("Luar skop Fasa 1", "courier lain")
            oc = pd.DataFrame([
                {"courier": k, "order": int(v["order"]), "nilai_RM": round(v["nilai"], 2)}
                for k, v in info["other_courier"].items()
            ])
            st.dataframe(oc, width="stretch", hide_index=True,
                         column_config=rm_cols("nilai_RM"))

    theme.section("Tier 1 , exception integriti", "perlu siasat")
    if len(integ):
        st.dataframe(theme.style_kategori(integ[show_cols]), width="stretch", hide_index=True,
                     column_config=rm_cols("selling_price", "cod_amount"))
    else:
        st.success("Tiada exception integriti. Buku bersih untuk data yang dimuatkan.")

    theme.section("Tier 2 , aged unmatched")
    st.caption(f"Order Completed melebihi {pending_days} hari tapi belum jumpa dalam mana mana bil. "
               "Dalam fasa data tak lengkap, ni biasanya artifak sebab bil belum cukup. "
               "Sepatutnya mengecut bila Adi tambah lebih banyak bil COD.")
    if len(aged):
        st.dataframe(theme.style_kategori(aged[show_cols]), width="stretch", hide_index=True,
                     column_config=rm_cols("selling_price", "cod_amount"))

    theme.section("Pecahan ikut stokis")
    seller = m["seller_name"].fillna("(takde order)")
    st.dataframe(pd.crosstab(seller, m["kategori"]), width="stretch")

    exc = m[m["kategori"].isin(INTEGRITY_EXC + AGED)][show_cols]
    st.download_button("Muat turun exceptions.csv", exc.to_csv(index=False),
                       "exceptions.csv", "text/csv")

# ===== SKU / Botol (editable, Finance maintain sendiri) =====
with tab_sku:
    theme.section("Jadual SKU ke botol", "Finance boleh edit atau tambah SKU baru di sini")
    st.caption("paid = botol bayar, free = botol percuma (contoh +1 / +2 KORBAN). Total botol = paid + free.")
    conn = db.get_conn()
    db.init_db(conn)
    sku_df = pd.read_sql("SELECT sku, product_name, paid, free FROM sku_bottles ORDER BY sku", conn)
    conn.close()
    edited = st.data_editor(
        sku_df, num_rows="dynamic", width="stretch", key="sku_editor",
        column_config={
            "sku": st.column_config.TextColumn("SKU", required=True),
            "product_name": st.column_config.TextColumn("Nama produk"),
            "paid": st.column_config.NumberColumn("Botol bayar", min_value=0, step=1),
            "free": st.column_config.NumberColumn("Botol free", min_value=0, step=1),
        },
    )
    if st.button("Simpan jadual SKU", type="primary"):
        db.save_sku_map(edited)
        st.success("Jadual SKU disimpan. Hasil dikemas kini di overview.")
        st.rerun()
    if info["unmapped_skus"]:
        st.warning("SKU dalam order tapi BELUM dipetakan (botol dikira 0): "
                   + ", ".join(info["unmapped_skus"]) + ". Tambah dalam jadual di atas.")
    else:
        st.success("Semua SKU dalam order ada dalam jadual.")
