"""
app.py , dicciGroupFinance

Web UI (Streamlit) for the Dicci Group finance dashboard.
Shell: Group level -> company (subsidiary) -> income stream. Phase 1 wires
Dicci Impact + J&T COD; other companies/streams are placeholders ("coming soon").
Wraps the existing engine (db.py, ingest.py, reconcile.py) untouched.

No sidebar by design (Streamlit's reopen button can vanish); navigation is button
driven via st.session_state.

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
from reconcile import (reconcile, reconcile_prepaid, bottles_per_order,
                       INTEGRITY_EXC, AGED)

st.set_page_config(page_title="Dicci Group Finance", page_icon=theme.page_icon(),
                   layout="wide", initial_sidebar_state="collapsed")
theme.inject_css()
db.init_db()

# ============ Navigation state (no sidebar) ============
if "subsidiary" not in st.session_state:
    st.session_state.subsidiary = None
if "view" not in st.session_state:
    st.session_state.view = "dashboard"
if "nav_open" not in st.session_state:
    st.session_state.nav_open = True

NAV_ICON = {"dashboard": "📊", "jnt": "🚚", "dhl": "📦", "ninja": "🛵",
            "chip": "💳", "transfer": "🏦", "tiktok": "🎵", "commission": "💰"}

SUBSIDIARIES = [
    {"key": "impact", "name": "Dicci Impact", "tag": "Active · Phase 1", "active": True},
    {"key": "flux", "name": "Flux", "tag": "Coming soon", "active": False},
    {"key": "hub", "name": "HUB", "tag": "Coming soon", "active": False},
    {"key": "group", "name": "Dicci Group", "tag": "Coming soon", "active": False},
]
STREAMS = [
    {"key": "jnt", "name": "J&T COD", "active": True},
    {"key": "dhl", "name": "DHL", "active": True},
    {"key": "ninja", "name": "Ninja Van", "active": True},
    {"key": "chip", "name": "CHIP (prepaid)", "active": False},
    {"key": "transfer", "name": "Bank Transfer", "active": False},
    {"key": "tiktok", "name": "TikTok", "active": False},
]
# Nota: CHIP dikekalkan tapi tak aktif (data dipadam). Enjin penuh (db.PREPAID,
# reconcile_prepaid, ingest parse_chip/ingest_chip) sedia , set active=True untuk hidupkan.
# Duit CHIP mendarat di bank Dicci GROUP, jadi sesuai diaktifkan bawah subsidiary Group.

SHOW_COLS = ["order_id", "seller_name", "tracking", "awb", "kategori",
             "selling_price", "cod_amount", "umur_hari"]
GRAINS = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"]


# ============ Display helpers ============
def colcfg(*names):
    """English column labels (+ money format) for st.dataframe; internal names kept."""
    base = {
        "order_id": st.column_config.TextColumn("Order ID"),
        "seller_name": st.column_config.TextColumn("Stockist"),
        "tracking": st.column_config.TextColumn("Tracking"),
        "awb": st.column_config.TextColumn("AWB"),
        "kategori": st.column_config.TextColumn("Status"),
        "order_date": st.column_config.TextColumn("Order date"),
        "status": st.column_config.TextColumn("Order status"),
        "payment_method": st.column_config.TextColumn("Payment"),
        "shipping_provider": st.column_config.TextColumn("Courier"),
        "umur_hari": st.column_config.NumberColumn("Age (days)"),
        "botol_paid": st.column_config.NumberColumn("Paid bottles"),
        "botol_free": st.column_config.NumberColumn("Free bottles"),
        "botol_total": st.column_config.NumberColumn("Total bottles"),
        "duit": st.column_config.TextColumn("Payment status"),
        "selling_price": st.column_config.NumberColumn("Selling price", format="RM %.2f"),
        "cod_amount": st.column_config.NumberColumn("COD amount", format="RM %.2f"),
        "fee": st.column_config.NumberColumn("Fee", format="RM %.2f"),
        "remit": st.column_config.NumberColumn("Net remit", format="RM %.2f"),
    }
    return {n: base[n] for n in names if n in base}


def period_key(ts, grain):
    if grain == "Weekly":
        return (ts - pd.to_timedelta(ts.dt.weekday, unit="D")).dt.normalize()
    if grain == "Monthly":
        return ts.dt.to_period("M").dt.start_time
    if grain == "Quarterly":
        return ts.dt.to_period("Q").dt.start_time
    if grain == "Yearly":
        return ts.dt.to_period("Y").dt.start_time
    return ts.dt.normalize()


def period_label(d, grain):
    d = pd.Timestamp(d)
    if grain == "Weekly":
        return "Week " + d.strftime("%d %b %Y")
    if grain == "Monthly":
        return d.strftime("%b %Y")
    if grain == "Quarterly":
        return f"Q{(d.month - 1) // 3 + 1} {d.year}"
    if grain == "Yearly":
        return str(d.year)
    return d.strftime("%d %b %Y")


# ============ Group landing ============
def render_group_landing():
    theme.page_header("Companies", "Finance reconciliation across Dicci Group")
    theme.section("Select a company", "open a company to upload data and view numbers")
    cols = st.columns(len(SUBSIDIARIES))
    for col, s in zip(cols, SUBSIDIARIES):
        with col, st.container(border=True):
            st.markdown(f"**{s['name']}**")
            st.caption(s["tag"])
            if s["active"]:
                if st.button("Open", key=f"open_{s['key']}", type="primary",
                             use_container_width=True):
                    st.session_state.subsidiary = s["key"]
                    st.rerun()
            else:
                st.button("Coming soon", key=f"open_{s['key']}", disabled=True,
                          use_container_width=True)


# ============ Top-bar admin (upload + settings popovers, recede the chrome) ============
def render_upload_popover(label="⬆  Upload"):
    with st.popover(label, use_container_width=True):
        st.markdown("**Upload data**")
        st.caption("Fighter export, courier bill (J&T / DHL / Ninja Van), or CHIP "
                   "statement. Type is auto-detected.")
        files = st.file_uploader("Drop files", type=["xlsx", "xls", "csv"],
                                 accept_multiple_files=True, key="up_files",
                                 label_visibility="collapsed")
        st.caption("⚠ Upload only the LATEST FULL export. Re-uploading an older or "
                   "filtered file overwrites current order status, tracking and price.")
        if files and st.button("Ingest", type="primary", key="up_ingest"):
            conn = db.get_conn()
            db.init_db(conn)
            for f in files:
                try:
                    kind, n = ingest_buffer(f, f.name, conn)
                    if kind:
                        st.success(f"{f.name}: **{kind}** · {n} rows")
                    else:
                        st.warning(f"{f.name}: unrecognized format")
                except Exception as e:
                    conn.rollback()
                    st.error(f"{f.name}: failed · {e}")
            conn.close()
            st.rerun()


def render_settings_popover(label="⚙  Settings"):
    pending_days = db.REMIT_PENDING_DAYS
    with st.popover(label, use_container_width=True):
        st.markdown("**Settings**")
        pending_days = st.slider("Aging: days before 'overdue'", 3, 45,
                                 db.REMIT_PENDING_DAYS, key="aging")
        st.caption("Aging reference date: 18 Jun 2026 (fixed).")
        conn = db.get_conn()
        n_ord = conn.execute(text("SELECT COUNT(*) FROM orders")).scalar()
        n_line = conn.execute(text("SELECT COUNT(*) FROM cod_bill_lines")).scalar()
        n_bill = conn.execute(text("SELECT COUNT(*) FROM cod_bills")).scalar()
        conn.close()
        st.caption(f"Store: {n_ord:,} orders · {n_line:,} bill lines · {n_bill} COD bills")
        try:
            admin = bool(st.secrets.get("ADMIN_MODE"))
        except Exception:
            admin = False
        if admin:
            st.divider()
            confirm = st.checkbox("Allow store reset", key="reset_ok")
            if st.button("Reset store (clear all)", disabled=not confirm, key="reset_btn"):
                try:
                    db.reset_db()
                    st.rerun()
                except Exception as e:
                    st.error(f"Reset failed · {e}")
    return pending_days


# ============ Left nav (column-based, collapsible icon-rail; immune to st.sidebar bug) ============
def render_nav(nav_open):
    pending_days = db.REMIT_PENDING_DAYS
    ckey = "impactnav" if nav_open else "impactnavmini"
    with st.container(key=ckey):
        # Toggle (collapse / expand)
        if nav_open:
            if st.button("«  Collapse", key="nav_toggle", use_container_width=True,
                         type="tertiary"):
                st.session_state.nav_open = False
                st.rerun()
            st.markdown('<div class="dicciSideBrand">DICCI · GROUP FINANCE</div>',
                        unsafe_allow_html=True)
            st.markdown('<div class="dicciSideCo">Dicci Impact</div>',
                        unsafe_allow_html=True)
        else:
            if st.button("»", key="nav_toggle", use_container_width=True,
                         type="tertiary", help="Expand menu"):
                st.session_state.nav_open = True
                st.rerun()
        st.write("")

        views = ([("dashboard", "Dashboard")]
                 + [(s["key"], s["name"]) for s in STREAMS if s["active"]]
                 + [("commission", "Commission")])
        for key, label in views:
            selected = st.session_state.get("view", "dashboard") == key
            icon = NAV_ICON.get(key, "•")
            btn_label = f"{icon}  {label}" if nav_open else icon
            if st.button(btn_label, key=f"nav_{key}", use_container_width=True,
                         type="primary" if selected else "secondary",
                         help=(None if nav_open else label)):
                st.session_state.view = key
                st.rerun()

        if nav_open:
            soon = [s["name"] for s in STREAMS if not s["active"]]
            if soon:
                st.caption("Soon · " + " · ".join(soon))

        st.divider()
        if nav_open:
            render_upload_popover("⬆  Upload")
            pending_days = render_settings_popover("⚙  Settings")
        else:
            render_upload_popover("⬆")
            pending_days = render_settings_popover("⚙")
        st.divider()
        back_label = "‹  All companies" if nav_open else "‹"
        if st.button(back_label, key="side_back", use_container_width=True,
                     type="tertiary", help=(None if nav_open else "All companies")):
            st.session_state.subsidiary = None
            st.rerun()
    return pending_days


# ============ Dashboard (roll-up across all active streams) ============
def render_dashboard(pending_days):
    active_keys = [s["key"] for s in STREAMS if s["active"] and s["key"] in db.COURIERS]
    conn = db.get_conn()
    db.init_db(conn)
    if conn.execute(text("SELECT COUNT(*) FROM orders")).scalar() == 0:
        conn.close()
        st.info("No data yet. Use **⬆ Upload** (top right) to add a Fighter export "
                "and courier bills.")
        return

    rows, all_lines, total_integ = [], [], 0
    for k in active_keys:
        m, lines, info = reconcile(conn, pending_days=pending_days, courier=k)
        coll = float(lines["cod_amount"].sum())
        fee = float(lines["fee"].sum())
        exc = int(m["kategori"].isin(INTEGRITY_EXC).sum())
        total_integ += exc
        rows.append({"stream": db.COURIERS[k]["name"], "collected": coll, "fee": fee,
                     "net": round(coll - fee, 2), "parcel": int(len(lines)), "exc": exc})
        if len(lines):
            all_lines.append(lines[["cod_amount", "fee", "delivered_date"]].copy())
    conn.close()

    led = pd.DataFrame(rows)
    tot_net = float(led["net"].sum())
    tot_parcel = int(led["parcel"].sum())

    theme.hero_band(
        label="Net remit · all streams",
        value=tot_net,
        sublines=f"{tot_parcel} parcels across {len(led)} couriers · expected in bank",
        flag_text=("Clean books" if total_integ == 0
                   else f"{total_integ} exceptions to investigate"),
        flag_ok=(total_integ == 0),
    )
    theme.alert_band(total_integ)

    theme.section("Per stream", "money in by income stream")
    disp = led.copy()
    disp.loc[len(disp)] = {"stream": "Total", "collected": led["collected"].sum(),
                           "fee": led["fee"].sum(), "net": led["net"].sum(),
                           "parcel": led["parcel"].sum(), "exc": led["exc"].sum()}
    st.dataframe(disp, width="stretch", hide_index=True, column_config={
        "stream": st.column_config.TextColumn("Stream"),
        "collected": st.column_config.NumberColumn("Collected", format="RM %.2f"),
        "fee": st.column_config.NumberColumn("Fee", format="RM %.2f"),
        "net": st.column_config.NumberColumn("Net remit", format="RM %.2f"),
        "parcel": st.column_config.NumberColumn("Parcels"),
        "exc": st.column_config.NumberColumn("Exceptions"),
    })
    st.caption("Pick a stream in the switcher above to drill into its bills, periods, "
               "and audit.")

    if all_lines:
        Lall = pd.concat(all_lines, ignore_index=True)
        Lall["dt"] = pd.to_datetime(Lall["delivered_date"], errors="coerce")
        Lall = Lall.dropna(subset=["dt"])
        if len(Lall):
            grain = st.segmented_control("Period", GRAINS, default="Daily",
                                         key="dash_grain") or "Daily"
            Lall["pkey"] = period_key(Lall["dt"], grain)
            g = (Lall.groupby("pkey")
                 .apply(lambda x: round(x["cod_amount"].sum() - x["fee"].sum(), 2))
                 .reset_index())
            g.columns = ["pkey", "net_remit"]
            g = g.sort_values("pkey")
            g["tempoh"] = g["pkey"].map(lambda d: period_label(d, grain))
            theme.section("Net remit by period", "all streams combined")
            st.altair_chart(theme.bar_chart_brand(g, "tempoh", "net_remit"),
                            use_container_width=True)

    soon = [s["name"] for s in STREAMS if not s["active"]]
    if soon:
        st.caption("Not yet connected: " + " · ".join(soon))


# ============ Stream renderers (COD courier + prepaid gateway share one body) ============
def render_courier_stream(courier_key, pending_days):
    cname = db.COURIERS[courier_key]["name"]
    conn = db.get_conn()
    db.init_db(conn)
    if conn.execute(text("SELECT COUNT(*) FROM orders")).scalar() == 0:
        conn.close()
        st.info("No data yet. Open the **Operations panel** above and upload a Fighter "
                "export (and courier bills) first.")
        return
    m, lines, info = reconcile(conn, pending_days=pending_days, courier=courier_key)
    od = bottles_per_order(conn)
    conn.close()
    render_stream_body(m, lines, info, od, pending_days,
                       {"name": cname, "money": "COD collected", "bill": "bill",
                        "hero": "Expected to land in bank"})


def render_prepaid_stream(gateway, pending_days):
    gname = db.PREPAID[gateway]["name"]
    conn = db.get_conn()
    db.init_db(conn)
    if conn.execute(text("SELECT COUNT(*) FROM orders")).scalar() == 0:
        conn.close()
        st.info("No data yet. Open the **Operations panel** above and upload a Fighter "
                "export (and a CHIP statement) first.")
        return
    m, lines, info = reconcile_prepaid(conn, gateway=gateway, pending_days=pending_days)
    od = bottles_per_order(conn)
    conn.close()
    render_stream_body(m, lines, info, od, pending_days,
                       {"name": gname, "money": "Collected (gross)", "bill": "statement",
                        "hero": f"Collected via {gname}"})


def render_stream_body(m, lines, info, od, pending_days, L):
    cname = L["name"]
    tally = m["kategori"] == "tally"
    integ = m[m["kategori"].isin(INTEGRITY_EXC)]
    aged = m[m["kategori"].isin(AGED)]
    total_cod = float(lines["cod_amount"].sum())
    total_fee = float(lines["fee"].sum())
    show_cols = [c for c in SHOW_COLS if c in m.columns]

    # ----- Overview (the money story) -----
    bill_rows = m[m["bill_id"].notna()].copy()
    g = None
    if not len(bill_rows):
        st.info(f"No {cname} {L['bill']} loaded yet. Upload a {cname} {L['bill']} in the "
                "Operations panel to see cash flow.")
    else:
        pcol1, pcol2 = st.columns([2, 1])
        with pcol1:
            grain = st.segmented_control("Period", GRAINS, default="Daily",
                                         key="grain") or "Daily"

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
            sel = st.selectbox("Select period", labels, index=len(labels) - 1,
                               key=f"period_{grain}")
        row = g[g["tempoh"] == sel].iloc[0]

        exc_n = int(row["exception"])
        theme.hero_band(
            label=f"{L['hero']} · {sel}",
            value=float(row["net_remit"]),
            sublines=f"net remit after fee · {int(row['parcel'])} parcels · "
                     f"{int(row['botol'])} bottles",
            flag_text=("No exceptions this period" if exc_n == 0
                       else f"{exc_n} exceptions this period"),
            flag_ok=(exc_n == 0),
        )

        risk = float(integ["cod_amount"].sum()) if len(integ) else None
        theme.alert_band(len(integ), risk=risk)

        theme.kpi_row([
            (L["money"], f"RM {row['cod_dikutip']:,.0f}"),
            ("Fee", f"RM {row['fee']:,.0f}"),
            ("Parcels", f"{int(row['parcel'])}"),
            ("Bottles", f"{int(row['botol'])}"),
        ])

        theme.section("Net remit by period", "all periods, to see the trend")
        st.altair_chart(theme.bar_chart_brand(g, "tempoh", "net_remit"),
                        use_container_width=True)

    # ----- Drill-down tabs -----
    theme.section("Details", "drill down by period, bill, stockist, and audit")
    tab_period, tab_bill, tab_stockist, tab_audit, tab_sku = st.tabs(
        ["By Period", f"By {L['bill'].title()}", "By Stockist", "Audit", "SKU / Bottles"])

    # ===== By Period =====
    with tab_period:
        if g is None:
            st.info("No COD bill loaded yet.")
        else:
            st.caption(f"Across {len(g)} periods: {int(g['parcel'].sum())} parcels, "
                       f"{int(g['botol'].sum())} bottles, "
                       f"RM {g['net_remit'].sum():,.2f} net remit.")
            st.dataframe(
                g[["tempoh", "parcel", "botol", "botol_free", "cod_dikutip", "fee",
                   "net_remit", "tally", "exception"]],
                width="stretch", hide_index=True,
                column_config={
                    "tempoh": st.column_config.TextColumn("Period"),
                    "parcel": st.column_config.NumberColumn("Parcels"),
                    "botol": st.column_config.NumberColumn("Bottles"),
                    "botol_free": st.column_config.NumberColumn("Free bottles"),
                    "cod_dikutip": st.column_config.NumberColumn("COD collected",
                                                                 format="RM %.2f"),
                    "fee": st.column_config.NumberColumn("J&T fee", format="RM %.2f"),
                    "net_remit": st.column_config.NumberColumn("Net remit",
                                                              format="RM %.2f"),
                    "tally": st.column_config.NumberColumn("Tally"),
                    "exception": st.column_config.NumberColumn("Exceptions"),
                },
            )
            st.caption("Net remit = collected minus fee (expected to land in "
                       "bank). Bottles = physical bottle count, free bottles = the "
                       "giveaway portion (for costing later). 'Actual bank' + 'matched?' "
                       "columns will be added once bank data arrives.")

    # ===== By Bill =====
    with tab_bill:
        bills = info["bills"]
        if not len(bills):
            st.info(f"No {cname} {L['bill']} loaded yet. Upload a {cname} {L['bill']} "
                    "in the Operations panel first.")
        else:
            opts = {}
            for _, r in bills.iterrows():
                opts[f"{r['bill_id']}  ({r['settlement_date'] or 'date?'})"] = r["bill_id"]
            choice = st.selectbox(f"Select a {L['bill']} (one settlement = one payout)",
                                  list(opts.keys()))
            bid = opts[choice]

            b = m[m["bill_id"] == bid].copy()
            b_cod = float(b["cod_amount"].sum())
            b_fee = float(b["fee"].sum())
            b_net = b_cod - b_fee
            b_tally = int((b["kategori"] == "tally").sum())
            b_exc = b[b["kategori"].isin(INTEGRITY_EXC)]

            d1, d2, d3, d4 = st.columns(4)
            d1.metric(f"Parcels in {L['bill']}", len(b))
            d2.metric(L["money"], f"RM {b_cod:,.2f}")
            d3.metric("Net remit (expected in bank)", f"RM {b_net:,.2f}",
                      f"after fee RM {b_fee:,.2f}")
            d4.metric("Tally / Exceptions", f"{b_tally} / {len(b_exc)}")

            if len(b_exc) == 0:
                st.success(f"This {L['bill']} is clean: all {len(b)} parcels tally. "
                           f"RM {b_net:,.2f} expected in bank.")
            else:
                st.warning(f"This {L['bill']} has {len(b_exc)} parcels to investigate "
                           "(ghost money or amount mismatch). See the table below.")

            theme.section("Check against bank")
            bank_amt = st.number_input("Actual amount received in bank for this bill (RM)",
                                       min_value=0.0, value=0.0, step=1.0, format="%.2f")
            if bank_amt > 0:
                diff = bank_amt - b_net
                if abs(diff) < 0.01:
                    st.success(f"Matches Net remit exactly (RM {b_net:,.2f}).")
                else:
                    st.error(f"Off by RM {diff:,.2f}  (bank RM {bank_amt:,.2f} vs "
                             f"Net remit RM {b_net:,.2f}). Needs investigation.")

            theme.section(f"Parcels in this {L['bill']}")
            bill_cols = [c for c in ["awb", "order_id", "seller_name", "kategori",
                                     "selling_price", "cod_amount", "fee", "remit"]
                         if c in b.columns]
            st.dataframe(theme.style_kategori(b[bill_cols]), width="stretch",
                         hide_index=True, column_config=colcfg(*bill_cols))

    # ===== By Stockist =====
    with tab_stockist:
        theme.section("Bottles per stockist",
                      "paid (sales) + free (cost), counted once payment is confirmed")
        st.caption("Bottles are counted across all couriers, but only for Completed "
                   "orders whose money is confirmed received (via uploaded courier money "
                   "feeds). 'Unconfirmed' flips automatically once the remaining money "
                   "feeds (CHIP / online transfer, more courier bills) are uploaded.")

        comp = od[od["status"] == db.COMPLETED].copy()
        comp["seller_name"] = comp["seller_name"].fillna("(no stockist)")
        if not len(comp):
            st.info("No Completed orders yet. Upload a Fighter export first.")
        else:
            paid = comp[comp["duit_disahkan"]]
            belum = comp[~comp["duit_disahkan"]]
            ringkas = pd.DataFrame(index=sorted(comp["seller_name"].unique()))
            ringkas["Confirmed orders"] = paid.groupby("seller_name")["order_id"].size()
            ringkas["Paid bottles"] = paid.groupby("seller_name")["botol_paid"].sum()
            ringkas["Free bottles"] = paid.groupby("seller_name")["botol_free"].sum()
            ringkas["Total bottles"] = paid.groupby("seller_name")["botol_total"].sum()
            ringkas["Unconfirmed bottles"] = belum.groupby("seller_name")["botol_total"].sum()
            ringkas = ringkas.fillna(0).astype(int).sort_values("Total bottles",
                                                                ascending=False)
            ringkas = ringkas.rename_axis("Stockist").reset_index()

            t = int(ringkas["Total bottles"].sum())
            tf = int(ringkas["Free bottles"].sum())
            tb = int(ringkas["Unconfirmed bottles"].sum())
            st.caption(f"Confirmed: {t:,} bottles ({tf:,} free) across "
                       f"{len(ringkas)} stockists. Awaiting payment confirmation: "
                       f"{tb:,} bottles.")
            st.dataframe(ringkas, width="stretch", hide_index=True)

            theme.section("Drill down a stockist", "view orders one by one")
            names = sorted(od["seller_name"].fillna("(no stockist)").unique())
            pick = st.selectbox("Select stockist", names)
            d = od.copy()
            d["seller_name"] = d["seller_name"].fillna("(no stockist)")
            d = d[d["seller_name"] == pick].copy()
            d["duit"] = d["duit_disahkan"].map({True: "confirmed", False: "unconfirmed"})
            det_cols = [c for c in ["order_id", "order_date", "status", "payment_method",
                                    "shipping_provider", "tracking", "botol_paid",
                                    "botol_free", "botol_total", "duit"]
                        if c in d.columns]
            st.dataframe(d[det_cols].sort_values(["duit", "order_date"]),
                         width="stretch", hide_index=True, column_config=colcfg(*det_cols))

    # ===== Audit =====
    with tab_audit:
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Tally (exact match)", int(tally.sum()),
                  f"RM {m.loc[tally, 'cod_amount'].sum():,.0f}")
        c2.metric(L["money"], f"RM {total_cod:,.0f}")
        c3.metric("Net remit", f"RM {total_cod - total_fee:,.0f}")
        c4.metric("Tier 1 (issues)", int(len(integ)))
        c5.metric("Tier 2 (aged)", int(len(aged)))

        with st.expander(f"COD bills loaded ({info['n_bills']})"):
            st.dataframe(info["bills"], width="stretch", hide_index=True)

        col_a, col_b = st.columns(2)
        with col_a:
            theme.section("Category summary")
            cc = m["kategori"].value_counts().rename_axis("kategori").reset_index(
                name="count")
            st.dataframe(theme.style_kategori(cc), width="stretch", hide_index=True,
                         column_config={"kategori": st.column_config.TextColumn("Status"),
                                        "count": st.column_config.NumberColumn("Count")})
        with col_b:
            if info["other_courier"]:
                theme.section("Out of Phase 1 scope", "other couriers")
                oc = pd.DataFrame([
                    {"courier": k, "orders": int(v["order"]),
                     "value": round(v["nilai"], 2)}
                    for k, v in info["other_courier"].items()
                ])
                st.dataframe(oc, width="stretch", hide_index=True, column_config={
                    "courier": st.column_config.TextColumn("Courier"),
                    "orders": st.column_config.NumberColumn("Orders"),
                    "value": st.column_config.NumberColumn("Value", format="RM %.2f"),
                })

        theme.section("Tier 1 · integrity exceptions", "need investigation")
        if len(integ):
            st.dataframe(theme.style_kategori(integ[show_cols]), width="stretch",
                         hide_index=True, column_config=colcfg(*show_cols))
        else:
            st.success("No integrity exceptions. Clean books for the data loaded.")

        theme.section("Tier 2 · aged unmatched")
        st.caption(f"Orders Completed over {pending_days} days but not found in any "
                   "bill. While data is incomplete this is usually an artifact of "
                   "missing bills. It should shrink as more COD bills are added.")
        if len(aged):
            st.dataframe(theme.style_kategori(aged[show_cols]), width="stretch",
                         hide_index=True, column_config=colcfg(*show_cols))

        theme.section("Breakdown by stockist")
        seller = m["seller_name"].fillna("(no order)")
        ct = pd.crosstab(seller, m["kategori"])
        ct.columns = [theme.kat_label(c) for c in ct.columns]
        st.dataframe(ct, width="stretch")

        exc = m[m["kategori"].isin(INTEGRITY_EXC + AGED)][show_cols]
        st.download_button("Download exceptions.csv", exc.to_csv(index=False),
                           "exceptions.csv", "text/csv")

    # ===== SKU / Bottles (editable, Finance maintains) =====
    with tab_sku:
        theme.section("SKU to bottle mapping", "Finance can edit or add SKUs here")
        st.caption("paid = paid bottles, free = free bottles (e.g. +1 / +2 KORBAN). "
                   "Total bottles = paid + free.")
        conn = db.get_conn()
        db.init_db(conn)
        sku_df = pd.read_sql("SELECT sku, product_name, paid, free FROM sku_bottles "
                             "ORDER BY sku", conn)
        conn.close()
        edited = st.data_editor(
            sku_df, num_rows="dynamic", width="stretch", key="sku_editor",
            column_config={
                "sku": st.column_config.TextColumn("SKU", required=True),
                "product_name": st.column_config.TextColumn("Product name"),
                "paid": st.column_config.NumberColumn("Paid bottles", min_value=0, step=1),
                "free": st.column_config.NumberColumn("Free bottles", min_value=0, step=1),
            },
        )
        if st.button("Save SKU mapping", type="primary"):
            db.save_sku_map(edited)
            st.success("SKU mapping saved. Numbers updated in the overview.")
            st.rerun()
        if info["unmapped_skus"]:
            st.warning("SKUs found in orders but NOT mapped (counted as 0 bottles): "
                       + ", ".join(info["unmapped_skus"]) + ". Add them in the table above.")
        else:
            st.success("All SKUs in orders are mapped.")


# ============ Commission (stockist commission from Fighter Wallet; record-only for now) ============
def render_commission():
    conn = db.get_conn()
    db.init_db(conn)
    n = conn.execute(text("SELECT COUNT(*) FROM wallet_txns")).scalar()
    if not n:
        conn.close()
        st.info("No commission data yet. Use **⬆ Upload** (top of the nav) to add a "
                "Fighter Wallet export.")
        return
    w = pd.read_sql(text("SELECT seller_name, seller_role, txn_type, source, status, amount "
                         "FROM wallet_txns"), conn)
    conn.close()

    appr = w[w["status"] == "Approved"]
    earned = appr[appr["txn_type"] == "IN"].groupby("seller_name")["amount"].sum()
    paid = (appr[(appr["txn_type"] == "OUT") & (appr["source"] == "Withdraw")]
            .groupby("seller_name")["amount"].sum())
    role = w.groupby("seller_name")["seller_role"].agg(
        lambda s: s.dropna().iloc[0] if s.dropna().size else "")

    g = pd.DataFrame({"earned": earned, "paid": paid}).fillna(0.0)
    g["balance"] = (g["earned"] - g["paid"]).round(2)
    g["level"] = role
    g = (g.reset_index().sort_values("earned", ascending=False)
         [["seller_name", "level", "earned", "paid", "balance"]])

    theme.hero_band(
        label="Commission earned · uploaded period",
        value=float(g["earned"].sum()),
        sublines=f"{len(g)} stockists · RM {float(g['paid'].sum()):,.2f} paid out (withdrawals)",
        flag_text="Record only · full tally vs payment coming",
        flag_ok=True,
    )
    theme.section("Per stockist", "earned (Sales + Recruitment) vs paid out (withdrawals)")
    st.dataframe(g, width="stretch", hide_index=True, column_config={
        "seller_name": st.column_config.TextColumn("Stockist"),
        "level": st.column_config.TextColumn("Level"),
        "earned": st.column_config.NumberColumn("Earned", format="RM %.2f"),
        "paid": st.column_config.NumberColumn("Paid out", format="RM %.2f"),
        "balance": st.column_config.NumberColumn("Balance", format="RM %.2f"),
    })
    st.caption("Earned & paid are from the uploaded Wallet period only. Balance is "
               "period-scoped (withdrawals may include commission earned before this "
               "period), so it is not the true all-time wallet balance yet. Full tally "
               "against orders arrives once finance confirms the payment source.")


# ============ Subsidiary page (Impact wired; left nav + content) ============
def render_impact():
    nav_open = st.session_state.get("nav_open", True)
    ratio = [1.2, 4.3] if nav_open else [0.42, 5.4]
    nav, body = st.columns(ratio, gap="medium")
    with nav:
        pending_days = render_nav(nav_open)
    with body:
        theme.page_header("Dicci Impact", "Income reconciliation · Phase 1")
        view = st.session_state.get("view", "dashboard")
        if view == "dashboard":
            render_dashboard(pending_days)
        elif view == "commission":
            render_commission()
        elif view in db.COURIERS:
            render_courier_stream(view, pending_days)
        elif view in db.PREPAID:
            render_prepaid_stream(view, pending_days)
        else:
            render_dashboard(pending_days)


# ============ Router ============
if st.session_state.subsidiary is None:
    render_group_landing()
elif st.session_state.subsidiary == "impact":
    render_impact()
else:
    # Defensive: a non-active company was somehow selected.
    if st.button("← All companies"):
        st.session_state.subsidiary = None
        st.rerun()
    name = next((s["name"] for s in SUBSIDIARIES
                 if s["key"] == st.session_state.subsidiary), "This company")
    theme.page_header(name, "coming soon")
    st.info(f"{name} is not wired yet. Phase 1 focuses on Dicci Impact.")
