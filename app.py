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

import importlib
import os

import pandas as pd
import streamlit as st
from sqlalchemy import text

import db
import ingest
import reconcile
import reconSql
import theme

st.set_page_config(page_title="Dicci Group Finance", page_icon=theme.page_icon(),
                   layout="wide", initial_sidebar_state="collapsed")
theme.inject_css()


# ============ Self-heal modul (deploy Streamlit Cloud tanpa restart proses) ============
# Streamlit Cloud kadang sync kod baru TANPA restart proses Python: app.py baru
# jalan dengan modul projek lama dalam memori (insiden 2026-07-03, AttributeError
# db.ensure_order_skus, ubat manual = Reboot). Guard ni kesan dua isyarat murah:
#   1. handshake db.MODULE_REV (tangkap proses dari zaman sebelum guard wujud),
#   2. mtime fail modul berubah sejak dimuatkan (tangkap deploy seterusnya).
# Bila basi: reload SEMUA modul projek ikut urutan dependency (db dulu) supaya
# from-import antara modul turut segar, dan kosongkan cache data (hasil cache
# mungkin dari logik lama). Gagal reload = biar app teruskan, paling teruk =
# tingkah laku lama (perlu Reboot manual), bukan lebih buruk.
REQUIRED_DB_REV = 2  # mesti padan db.MODULE_REV

_PROJECT_MODULES = (db, reconcile, ingest, reconSql, theme)


def _self_heal_modules():
    try:
        stale = getattr(db, "MODULE_REV", 0) != REQUIRED_DB_REV
        for mod in _PROJECT_MODULES:
            cur = os.path.getmtime(mod.__file__)
            if getattr(mod, "_loadedMtime", None) not in (None, cur):
                stale = True
        if stale:
            for mod in _PROJECT_MODULES:
                importlib.reload(mod)
        for mod in _PROJECT_MODULES:
            mod._loadedMtime = os.path.getmtime(mod.__file__)
        if stale:
            st.cache_data.clear()
    except Exception:
        pass


_self_heal_modules()


# ============ Boot + lapisan baca bercache (kurangkan round trip app -> Neon) ============
# Streamlit rerun SELURUH skrip pada setiap klik; tanpa cache setiap klik ulang
# puluhan query merentas rangkaian (app di US, Neon di Singapore). Data hanya
# berubah bila ingest/reset/save SKU, dan semua sesi kongsi SATU proses, jadi
# pembatalan cache sebenar = st.cache_data.clear() di titik tulis tu sendiri.
# TTL panjang hanya jaring keselamatan (elak spike query berkala setiap 5 minit).
CACHE_TTL = 3600


@st.cache_resource(show_spinner=False)
def boot_db():
    db.init_db()
    conn = db.get_conn()
    try:
        db.ensure_order_skus(conn)  # backfill sekali untuk DB dari versi lama
    finally:
        conn.close()
    return True


boot_db()


def _with_conn(fn, *args):
    conn = db.get_conn()
    try:
        return fn(conn, *args)
    finally:
        conn.close()


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_counts():
    conn = db.get_conn()
    try:
        return {t: conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                for t in ("orders", "cod_bill_lines", "cod_bills", "wallet_txns")}
    finally:
        conn.close()


# Semua bacaan berat = agregat SQL dalam DB (reconSql), bukan tarik semua row.
# Kekal pantas + muat RAM walau jutaan order; lihat reconSql.py.
@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_summary(kind, key, pending_days):
    return _with_conn(reconSql.stream_summary, kind, key, pending_days)


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_bill_parcels(kind, key, pending_days, bill_id):
    return _with_conn(reconSql.bill_parcels, kind, key, pending_days, bill_id)


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_stockist_bottles():
    return _with_conn(reconSql.stockist_bottles)


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_stockist_names():
    return _with_conn(reconSql.stockist_names)


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_stockist_orders(seller):
    return _with_conn(reconSql.stockist_orders, seller)


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_commission_summary():
    return _with_conn(reconSql.commission_summary)


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_commission_names():
    return _with_conn(reconSql.commission_names)


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_commission_breakdown(seller):
    return _with_conn(reconSql.commission_breakdown, seller)


@st.cache_data(ttl=CACHE_TTL, show_spinner=False)
def load_sku_df():
    conn = db.get_conn()
    try:
        return pd.read_sql("SELECT sku, product_name, paid, free FROM sku_bottles "
                           "ORDER BY sku", conn)
    finally:
        conn.close()


# ============ DB status guard (fail loud, elak tulis ke stor sementara tanpa sedar) ============
def render_db_guard():
    """Papar amaran jelas bila app jatuh ke SQLite (ephemeral di cloud, data hilang
    bila restart). Senyap hanya bila memang Neon Postgres, atau dev lokal biasa."""
    if db.is_postgres():
        return
    try:
        has_secret = bool(st.secrets.get("DATABASE_URL"))
        secret_exc = None
    except Exception as e:
        has_secret, secret_exc = False, e
    if has_secret:
        st.error("**Storage misconfigured**: a DATABASE_URL secret is set but this "
                 "process is still using temporary SQLite (it started before the "
                 "secret was saved). **Reboot the app** from Streamlit Cloud. "
                 "Anything uploaded now will be LOST on restart.")
    elif secret_exc is not None and not isinstance(secret_exc, FileNotFoundError):
        st.error("**Storage misconfigured**: the secrets file could not be parsed "
                 "(invalid TOML?), so the app fell back to temporary SQLite. "
                 f"Fix the Secrets format, then reboot. Detail: {secret_exc}")
    elif st.get_option("server.headless"):
        st.error("**No DATABASE_URL secret**: running on temporary SQLite, data "
                 "will be LOST when the app restarts. Add the secret in Streamlit "
                 "Cloud, App settings, Secrets, then reboot.")


def write_heartbeat():
    """Tulis jejak boot ke app_meta, bukti proses app live sedang MENULIS ke store
    semasa (boleh disahkan dari terminal dengan query Neon). Sekali per sesi."""
    if st.session_state.get("hb_done"):
        return
    try:
        conn = db.get_conn()
        conn.execute(text(
            "INSERT INTO app_meta (key, value) VALUES ('last_app_boot', :v) "
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
            {"v": pd.Timestamp.utcnow().isoformat()})
        conn.commit()
        conn.close()
        st.session_state.hb_done = True
    except Exception:
        pass


render_db_guard()
write_heartbeat()

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
def set_state(**kw):
    """Callback butang navigasi: tukar state SEBELUM rerun semula jadi Streamlit.
    Elak corak 'if st.button: st.rerun()' yang kos DUA rerun penuh setiap klik."""
    for k, v in kw.items():
        st.session_state[k] = v


def render_group_landing():
    theme.page_header("Companies", "Finance reconciliation across Dicci Group")
    theme.section("Select a company", "open a company to upload data and view numbers")
    cols = st.columns(len(SUBSIDIARIES))
    for col, s in zip(cols, SUBSIDIARIES):
        with col, st.container(border=True):
            st.markdown(f"**{s['name']}**")
            st.caption(s["tag"])
            if s["active"]:
                st.button("Open", key=f"open_{s['key']}", type="primary",
                          use_container_width=True,
                          on_click=set_state, kwargs={"subsidiary": s["key"]})
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
            for f in files:
                try:
                    kind, n = ingest.ingest_buffer(f, f.name, conn)
                    if kind:
                        st.success(f"{f.name}: **{kind}** · {n} rows")
                    else:
                        st.warning(f"{f.name}: unrecognized format")
                except Exception as e:
                    conn.rollback()
                    st.error(f"{f.name}: failed · {e}")
            conn.close()
            st.cache_data.clear()
            st.rerun()


def render_settings_popover(label="⚙  Settings"):
    pending_days = db.REMIT_PENDING_DAYS
    with st.popover(label, use_container_width=True):
        st.markdown("**Settings**")
        pending_days = st.slider("Aging: days before 'overdue'", 3, 45,
                                 db.REMIT_PENDING_DAYS, key="aging")
        st.caption("Aging reference date: 18 Jun 2026 (fixed).")
        ns = load_counts()
        st.caption(f"Store: {ns['orders']:,} orders · {ns['cod_bill_lines']:,} bill "
                   f"lines · {ns['cod_bills']} COD bills")
        st.caption("DB: " + ("Neon Postgres (persistent)" if db.is_postgres()
                             else "local SQLite (temporary)"))
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
                    st.cache_data.clear()
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
            st.button("«  Collapse", key="nav_toggle", use_container_width=True,
                      type="tertiary",
                      on_click=set_state, kwargs={"nav_open": False})
            st.markdown('<div class="dicciSideBrand">DICCI · GROUP FINANCE</div>',
                        unsafe_allow_html=True)
            st.markdown('<div class="dicciSideCo">Dicci Impact</div>',
                        unsafe_allow_html=True)
        else:
            st.button("»", key="nav_toggle", use_container_width=True,
                      type="tertiary", help="Expand menu",
                      on_click=set_state, kwargs={"nav_open": True})
        st.write("")

        views = ([("dashboard", "Dashboard")]
                 + [(s["key"], s["name"]) for s in STREAMS if s["active"]]
                 + [("commission", "Commission")])
        for key, label in views:
            selected = st.session_state.get("view", "dashboard") == key
            icon = NAV_ICON.get(key, "•")
            btn_label = f"{icon}  {label}" if nav_open else icon
            st.button(btn_label, key=f"nav_{key}", use_container_width=True,
                      type="primary" if selected else "secondary",
                      help=(None if nav_open else label),
                      on_click=set_state, kwargs={"view": key})

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
        st.button(back_label, key="side_back", use_container_width=True,
                  type="tertiary", help=(None if nav_open else "All companies"),
                  on_click=set_state, kwargs={"subsidiary": None})
    return pending_days


# ============ Dashboard (roll-up across all active streams) ============
def render_dashboard(pending_days):
    active_keys = [s["key"] for s in STREAMS if s["active"] and s["key"] in db.COURIERS]
    if load_counts()["orders"] == 0:
        st.info("No data yet. Use **⬆ Upload** (top right) to add a Fighter export "
                "and courier bills.")
        return

    rows, all_daily, total_integ = [], [], 0
    for k in active_keys:
        s = load_summary("courier", k, pending_days)
        coll, fee, exc = s["lines_cod"], s["lines_fee"], s["integ_n"]
        total_integ += exc
        rows.append({"stream": db.COURIERS[k]["name"], "collected": coll, "fee": fee,
                     "net": round(coll - fee, 2), "parcel": s["lines_n"], "exc": exc})
        if len(s["daily"]):
            all_daily.append(s["daily"][["day", "cod_dikutip", "fee"]])

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

    if all_daily:
        Lall = pd.concat(all_daily, ignore_index=True)
        Lall["dt"] = pd.to_datetime(Lall["day"], errors="coerce")
        Lall = Lall.dropna(subset=["dt"])
        if len(Lall):
            grain = st.segmented_control("Period", GRAINS, default="Daily",
                                         key="dash_grain") or "Daily"
            Lall["pkey"] = period_key(Lall["dt"], grain)
            g = (Lall.groupby("pkey")
                 .apply(lambda x: round(x["cod_dikutip"].sum() - x["fee"].sum(), 2))
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
    if load_counts()["orders"] == 0:
        st.info("No data yet. Open the **Operations panel** above and upload a Fighter "
                "export (and courier bills) first.")
        return
    s = load_summary("courier", courier_key, pending_days)
    render_stream_body(s, pending_days,
                       {"name": cname, "money": "COD collected", "bill": "bill",
                        "hero": "Expected to land in bank",
                        "kind": "courier", "key": courier_key})


def render_prepaid_stream(gateway, pending_days):
    gname = db.PREPAID[gateway]["name"]
    if load_counts()["orders"] == 0:
        st.info("No data yet. Open the **Operations panel** above and upload a Fighter "
                "export (and a CHIP statement) first.")
        return
    s = load_summary("prepaid", gateway, pending_days)
    render_stream_body(s, pending_days,
                       {"name": gname, "money": "Collected (gross)", "bill": "statement",
                        "hero": f"Collected via {gname}",
                        "kind": "prepaid", "key": gateway})


def render_stream_body(s, pending_days, L):
    cname = L["name"]
    integ, aged = s["integ"], s["aged"]
    total_cod, total_fee = s["lines_cod"], s["lines_fee"]
    show_cols = [c for c in SHOW_COLS if c in integ.columns]

    # ----- Overview (the money story) -----
    g = None
    if not s["lines_n"]:
        st.info(f"No {cname} {L['bill']} loaded yet. Upload a {cname} {L['bill']} in the "
                "Operations panel to see cash flow.")
    else:
        pcol1, pcol2 = st.columns([2, 1])
        with pcol1:
            grain = st.segmented_control("Period", GRAINS, default="Daily",
                                         key="grain") or "Daily"

        # Rollup dari agregat HARIAN (reconSql), bukan baris mentah: grain lebih
        # kasar = gabungan hari, jadi angka identik dengan kiraan atas baris penuh.
        d = s["daily"].copy()
        d["dt"] = pd.to_datetime(d["day"], errors="coerce")
        d = d.dropna(subset=["dt"])
        d["pkey"] = period_key(d["dt"], grain)
        g = d.groupby("pkey").agg(
            parcel=("parcel", "sum"),
            botol=("botol", "sum"),
            botol_free=("botol_free", "sum"),
            cod_dikutip=("cod_dikutip", "sum"),
            fee=("fee", "sum"),
            tally=("tally", "sum"),
            exception=("exception", "sum"),
        ).reset_index().sort_values("pkey")
        g["net_remit"] = (g["cod_dikutip"] - g["fee"]).round(2)
        g["cod_dikutip"] = g["cod_dikutip"].round(2)
        g["fee"] = g["fee"].round(2)
        g["tempoh"] = g["pkey"].map(lambda d_: period_label(d_, grain))

        labels = g["tempoh"].tolist()
        if labels:
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

            risk = s["integ_risk"] if s["integ_n"] else None
            theme.alert_band(s["integ_n"], risk=risk)

            theme.kpi_row([
                (L["money"], f"RM {row['cod_dikutip']:,.0f}"),
                ("Fee", f"RM {row['fee']:,.0f}"),
                ("Parcels", f"{int(row['parcel'])}"),
                ("Bottles", f"{int(row['botol'])}"),
            ])

        if g is not None and len(g):
            theme.section("Net remit by period", "all periods, to see the trend")
            st.altair_chart(theme.bar_chart_brand(g, "tempoh", "net_remit"),
                            use_container_width=True)

    # ----- Drill-down tabs -----
    theme.section("Details", "drill down by period, bill, stockist, and audit")
    tab_period, tab_bill, tab_stockist, tab_audit, tab_sku = st.tabs(
        ["By Period", f"By {L['bill'].title()}", "By Stockist", "Audit", "SKU / Bottles"])

    # ===== By Period =====
    with tab_period:
        if g is None or not len(g):
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
                    "fee": st.column_config.NumberColumn(f"{cname} fee", format="RM %.2f"),
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
        bills = s["bills"]
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

            pb = s["per_bill"].set_index("bill_id")
            b_n = int(pb.loc[bid, "parcel"]) if bid in pb.index else 0
            b_cod = float(pb.loc[bid, "cod"]) if bid in pb.index else 0.0
            b_fee = float(pb.loc[bid, "fee"]) if bid in pb.index else 0.0
            b_tally = int(pb.loc[bid, "tally"]) if bid in pb.index else 0
            b_exc_n = int(pb.loc[bid, "exc"]) if bid in pb.index else 0
            b_net = b_cod - b_fee

            d1, d2, d3, d4 = st.columns(4)
            d1.metric(f"Parcels in {L['bill']}", b_n)
            d2.metric(L["money"], f"RM {b_cod:,.2f}")
            d3.metric("Net remit (expected in bank)", f"RM {b_net:,.2f}",
                      f"after fee RM {b_fee:,.2f}")
            d4.metric("Tally / Exceptions", f"{b_tally} / {b_exc_n}")

            if b_exc_n == 0:
                st.success(f"This {L['bill']} is clean: all {b_n} parcels tally. "
                           f"RM {b_net:,.2f} expected in bank.")
            else:
                st.warning(f"This {L['bill']} has {b_exc_n} parcels to investigate "
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
            b = load_bill_parcels(L["kind"], L["key"], pending_days, bid)
            if len(b) < b_n:
                st.caption(f"Showing first {len(b):,} of {b_n:,} parcels.")
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

        sb = load_stockist_bottles()
        if not len(sb):
            st.info("No Completed orders yet. Upload a Fighter export first.")
        else:
            ringkas = sb.rename(columns={
                "stockist": "Stockist", "confirmed_orders": "Confirmed orders",
                "paid_bottles": "Paid bottles", "free_bottles": "Free bottles",
                "total_bottles": "Total bottles",
                "unconfirmed_bottles": "Unconfirmed bottles"})
            num_cols = ["Confirmed orders", "Paid bottles", "Free bottles",
                        "Total bottles", "Unconfirmed bottles"]
            ringkas[num_cols] = ringkas[num_cols].fillna(0).astype(int)
            ringkas = ringkas.sort_values("Total bottles", ascending=False)

            t = int(ringkas["Total bottles"].sum())
            tf = int(ringkas["Free bottles"].sum())
            tb = int(ringkas["Unconfirmed bottles"].sum())
            st.caption(f"Confirmed: {t:,} bottles ({tf:,} free) across "
                       f"{len(ringkas)} stockists. Awaiting payment confirmation: "
                       f"{tb:,} bottles.")
            st.dataframe(ringkas, width="stretch", hide_index=True)

            theme.section("Drill down a stockist", "view orders one by one")
            names = load_stockist_names()
            pick = st.selectbox("Select stockist", names)
            d, d_total = load_stockist_orders(pick)
            if len(d) < d_total:
                st.caption(f"Showing latest {len(d):,} of {d_total:,} orders.")
            det_cols = [c for c in ["order_id", "order_date", "status", "payment_method",
                                    "shipping_provider", "tracking", "botol_paid",
                                    "botol_free", "botol_total", "duit"]
                        if c in d.columns]
            st.dataframe(d[det_cols].sort_values(["duit", "order_date"]),
                         width="stretch", hide_index=True, column_config=colcfg(*det_cols))

    # ===== Audit =====
    with tab_audit:
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Tally (exact match)", s["tally_n"], f"RM {s['tally_cod']:,.0f}")
        c2.metric(L["money"], f"RM {total_cod:,.0f}")
        c3.metric("Net remit", f"RM {total_cod - total_fee:,.0f}")
        c4.metric("Tier 1 (issues)", s["integ_n"])
        c5.metric("Tier 2 (aged)", s["aged_n"])

        with st.expander(f"COD bills loaded ({s['n_bills']})"):
            st.dataframe(s["bills"], width="stretch", hide_index=True)

        col_a, col_b = st.columns(2)
        with col_a:
            theme.section("Category summary")
            cc = (pd.DataFrame([{"kategori": k, "count": int(n)}
                                for k, n in s["kat_n"].items()],
                               columns=["kategori", "count"])
                  .sort_values("count", ascending=False).reset_index(drop=True))
            st.dataframe(theme.style_kategori(cc), width="stretch", hide_index=True,
                         column_config={"kategori": st.column_config.TextColumn("Status"),
                                        "count": st.column_config.NumberColumn("Count")})
        with col_b:
            if s["other_courier"]:
                theme.section("Out of Phase 1 scope", "other couriers")
                oc = pd.DataFrame([
                    {"courier": k, "orders": int(v["order"]),
                     "value": round(v["nilai"], 2)}
                    for k, v in s["other_courier"].items()
                ])
                st.dataframe(oc, width="stretch", hide_index=True, column_config={
                    "courier": st.column_config.TextColumn("Courier"),
                    "orders": st.column_config.NumberColumn("Orders"),
                    "value": st.column_config.NumberColumn("Value", format="RM %.2f"),
                })

        theme.section("Tier 1 · integrity exceptions", "need investigation")
        if len(integ):
            if len(integ) < s["integ_n"]:
                st.caption(f"Showing first {len(integ):,} of {s['integ_n']:,} rows "
                           "(oldest first). Full list via Download below.")
            st.dataframe(theme.style_kategori(integ[show_cols]), width="stretch",
                         hide_index=True, column_config=colcfg(*show_cols))
        else:
            st.success("No integrity exceptions. Clean books for the data loaded.")

        theme.section("Tier 2 · aged unmatched")
        st.caption(f"Orders Completed over {pending_days} days but not found in any "
                   "bill. While data is incomplete this is usually an artifact of "
                   "missing bills. It should shrink as more COD bills are added.")
        if len(aged):
            if len(aged) < s["aged_n"]:
                st.caption(f"Showing first {len(aged):,} of {s['aged_n']:,} rows "
                           "(oldest first).")
            st.dataframe(theme.style_kategori(aged[show_cols]), width="stretch",
                         hide_index=True, column_config=colcfg(*show_cols))

        theme.section("Breakdown by stockist")
        ct = s["stokis_kat"].pivot_table(index="seller", columns="kategori",
                                         values="n", fill_value=0, aggfunc="sum")
        ct.columns = [theme.kat_label(c) for c in ct.columns]
        ct.index.name = "seller_name"
        st.dataframe(ct, width="stretch")

        exc = pd.concat([integ, aged], ignore_index=True)
        exc = exc[show_cols] if len(exc) else exc
        st.download_button("Download exceptions.csv", exc.to_csv(index=False),
                           "exceptions.csv", "text/csv")

    # ===== SKU / Bottles (editable, Finance maintains) =====
    with tab_sku:
        theme.section("SKU to bottle mapping", "Finance can edit or add SKUs here")
        st.caption("paid = paid bottles, free = free bottles (e.g. +1 / +2 KORBAN). "
                   "Total bottles = paid + free.")
        sku_df = load_sku_df()
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
            st.cache_data.clear()
            st.success("SKU mapping saved. Numbers updated in the overview.")
            st.rerun()
        if s["unmapped_skus"]:
            st.warning("SKUs found in orders but NOT mapped (counted as 0 bottles): "
                       + ", ".join(s["unmapped_skus"]) + ". Add them in the table above.")
        else:
            st.success("All SKUs in orders are mapped.")


# ============ Commission (stockist commission from Fighter Wallet; record-only for now) ============
def render_commission():
    if not load_counts()["wallet_txns"]:
        st.info("No commission data yet. Use **⬆ Upload** (top of the nav) to add a "
                "Fighter Wallet export.")
        return
    g = load_commission_summary()

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

    # ---- Drill-down: pecahan per stockist ----
    theme.section("Breakdown by stockist", "pick one to see the transactions behind the totals")
    names = load_commission_names()
    pick = st.selectbox("Stockist", names, key="comm_pick")
    by_src, det, det_total = load_commission_breakdown(pick)

    st.caption("By source (Approved only)")
    st.dataframe(by_src, width="stretch", hide_index=True, column_config={
        "source": st.column_config.TextColumn("Source"),
        "txn_type": st.column_config.TextColumn("Direction"),
        "count": st.column_config.NumberColumn("Count"),
        "total": st.column_config.NumberColumn("Amount", format="RM %.2f"),
    })

    if len(det) < det_total:
        st.caption(f"Showing first {len(det):,} of {det_total:,} transactions.")
    st.caption(f"Every transaction for {pick} ({det_total} rows)")
    st.dataframe(det, width="stretch", hide_index=True, column_config={
        "txn_date": st.column_config.TextColumn("Date"),
        "order_id": st.column_config.TextColumn("Order ID"),
        "source": st.column_config.TextColumn("Source"),
        "txn_type": st.column_config.TextColumn("Direction"),
        "status": st.column_config.TextColumn("Status"),
        "amount": st.column_config.NumberColumn("Amount", format="RM %.2f"),
    })


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
    st.button("← All companies", on_click=set_state, kwargs={"subsidiary": None})
    name = next((s["name"] for s in SUBSIDIARIES
                 if s["key"] == st.session_state.subsidiary), "This company")
    theme.page_header(name, "coming soon")
    st.info(f"{name} is not wired yet. Phase 1 focuses on Dicci Impact.")
