"""
theme.py , dicciGroupFinance

Lapisan persembahan berjenama Dicci, dibina supaya BOLEH GUNA SEMULA.
Page recon J&T COD ni nanti jadi satu page dalam dashboard besar, jadi semua
styling (warna, CSS, header, kad, chart) dipusatkan di sini. Page lain cukup
panggil helper yang sama untuk dapat bahasa design yang konsisten.

Baseline brand (terkunci, dari dicci.com.my): teal dalam + emas. Token tambahan
(neutral hangat, status, data-viz, atmosfera) semua diterbitkan dari hue brand
supaya nampak satu famili. Tipografi: Fraunces (display/hero) + Manrope (body/data).
"""

import base64
from functools import lru_cache
from pathlib import Path

import altair as alt
import streamlit as st

# ====================================================================
# Palet brand Dicci (terkunci)
# ====================================================================
TEAL = "#0A3D45"
TEAL_DARK = "#072A30"
TEAL_MID = "#0D4F5A"
GOLD = "#D6B467"
GOLD_LIGHT = "#E8C885"
GOLD_DARK = "#B8944A"

# ---- Neutral ramp hangat (taupe, sekeluarga dengan teal) ----
BG = "#FBFAF7"          # kanvas off-white
BG_SUNKEN = "#F4F1EA"   # well/header jadual
CARD = "#FFFFFF"
SURFACE_ALT = "#FCFBF8"
BORDER = "#E7E1D3"
BORDER_STRONG = "#D8CFBC"
INK_STRONG = "#0E2E33"  # heading
INK = "#1E3B40"         # teks badan
MUTED = "#5C6B6E"       # teks sekunder
FAINT = "#8A9698"

# ---- Status (diharmonikan, bukan stoplight) ----
POSITIVE, POSITIVE_TEXT, POSITIVE_BG = "#1E7A5E", "#155C46", "#E4F0EA"
CAUTION, CAUTION_BG = GOLD_DARK, "#F7EFD9"
DANGER, DANGER_TEXT, DANGER_BG = "#A8312A", "#8A2722", "#F7E7E4"
INFO, INFO_BG = "#2C6E78", "#E6EEEF"

# Alias lama supaya kod sedia ada tak pecah
OK, OK_BG = POSITIVE, POSITIVE_BG
WARN, WARN_BG = CAUTION, CAUTION_BG

# ---- Palet data-viz (emas dahulu = "duit") ----
VIZ = ["#D6B467", "#0A3D45", "#7FA8A0", "#C98A3E", "#4E7C84", "#B8944A"]

ASSETS = Path(__file__).parent / "assets"
LOGO_PATH = ASSETS / "logoDicci.png"
LOGO_URL = "https://dicci.com.my/img/header_img/LogoDicci.png"

FONT_DISPLAY = "'Fraunces', 'Hoefler Text', Georgia, serif"
FONT_BODY = "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

# Warna cip ikut kategori recon (teks, latar)
KAT_COLORS = {
    "tally": (POSITIVE_TEXT, POSITIVE_BG),
    "belum_remit": (MUTED, BG_SUNKEN),
    "hilang_lewat": (GOLD_DARK, CAUTION_BG),
    "returned": (MUTED, BG_SUNKEN),
    "rejected": (MUTED, BG_SUNKEN),
    "pending": (MUTED, BG_SUNKEN),
    "duit_hantu": (DANGER_TEXT, DANGER_BG),
    "amount_mismatch": (DANGER_TEXT, DANGER_BG),
    "duit_masuk_order_returned": (DANGER_TEXT, DANGER_BG),
    "duit_masuk_order_rejected": (DANGER_TEXT, DANGER_BG),
    "in_bil_tapi_intransit": (DANGER_TEXT, DANGER_BG),
    "takde_awb_jnt": (DANGER_TEXT, DANGER_BG),
    "match_luar_skop": (DANGER_TEXT, DANGER_BG),
}


# ====================================================================
# Logo (cache lokal, fallback wordmark)
# ====================================================================
def ensure_logo():
    if LOGO_PATH.exists() and LOGO_PATH.stat().st_size > 0:
        return LOGO_PATH
    try:
        import urllib.request
        ASSETS.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(LOGO_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            LOGO_PATH.write_bytes(r.read())
        return LOGO_PATH if LOGO_PATH.stat().st_size > 0 else None
    except Exception:
        return None


@lru_cache(maxsize=1)
def _logo_data_uri():
    p = ensure_logo()
    if not p:
        return None
    return f"data:image/png;base64,{base64.b64encode(p.read_bytes()).decode()}"


def page_icon():
    p = ensure_logo()
    return str(p) if p else "📊"


# ====================================================================
# CSS global (satu suntikan)
# ====================================================================
def inject_css():
    st.markdown(
        f"""
        <style>
        @import url('https://fonts.bunny.net/css?family=fraunces:400,500,600,700');
        @import url('https://fonts.bunny.net/css?family=manrope:400,500,600,700,800');

        :root {{ --fd: {FONT_DISPLAY}; --fb: {FONT_BODY}; }}

        html, body, [data-testid="stAppViewContainer"], [data-testid="stSidebar"],
        button, input, textarea, select, .stMarkdown, [data-baseweb="select"],
        [data-baseweb="input"], [data-baseweb="tab"], [data-testid="stMarkdownContainer"] {{
            font-family: var(--fb) !important;
        }}
        h1, h2, h3, h4, .dicciPageTitle, .dicciHeroValue, .dicciSection .t,
        .dicciEmblem .word {{ font-family: var(--fd) !important; font-weight: 600;
            color: {INK_STRONG}; letter-spacing: -0.01em; }}
        /* JANGAN timpa font ikon Material (kalau tak ikon jadi teks 'keyboard_arrow…') */
        span[data-testid="stIconMaterial"] {{
            font-family: 'Material Symbols Rounded' !important; }}

        /* Sorok chrome Streamlit (TAPI kekalkan kawalan sidebar) */
        #MainMenu, footer, [data-testid="stToolbar"], [data-testid="stDecoration"],
        [data-testid="stStatusWidget"] {{ display: none !important; }}
        [data-testid="stHeader"] {{ background: transparent !important; }}
        [data-testid="stSidebarCollapseButton"], [data-testid="stSidebarCollapsed"],
        [data-testid="stSidebarCollapseButton"] button {{
            display: flex !important; visibility: visible !important; opacity: 1 !important; }}

        /* Kanvas: glow emas (atas kiri) + teal (bawah kanan) + grain kertas halus */
        [data-testid="stAppViewContainer"] {{
            background-color: {BG};
            background-image:
                radial-gradient(900px 500px at 12% -8%, rgba(214,180,103,0.10), transparent 60%),
                radial-gradient(1000px 600px at 105% 110%, rgba(10,61,69,0.07), transparent 55%);
            background-attachment: fixed;
        }}
        [data-testid="stAppViewContainer"]::before {{
            content:""; position:fixed; inset:0; pointer-events:none; z-index:0; opacity:0.025;
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }}
        .block-container {{ padding-top: 3.2rem; padding-bottom: 3rem; max-width: 1180px;
            position: relative; z-index: 1; }}

        /* Kad KPI default Streamlit (st.metric) */
        [data-testid="stMetric"] {{
            background: {CARD}; border: 1px solid {BORDER}; border-top: 2px solid {GOLD};
            border-radius: 14px; padding: 14px 18px 16px;
            box-shadow: 0 1px 3px rgba(7,42,48,0.07), 0 1px 2px rgba(7,42,48,0.04); }}
        [data-testid="stMetricLabel"] p {{ color: {MUTED}; font-weight: 600; font-size: 0.75rem;
            text-transform: uppercase; letter-spacing: 0.08em; }}
        [data-testid="stMetricValue"] {{ color: {TEAL}; font-weight: 700;
            font-variant-numeric: tabular-nums; }}

        /* Tab: garis aktif emas */
        [data-baseweb="tab-list"] {{ gap: 6px; border-bottom: 1px solid {BORDER}; }}
        [data-baseweb="tab"] {{ font-weight: 600; color: {MUTED}; padding: 6px 4px; }}
        [aria-selected="true"][data-baseweb="tab"] {{ color: {TEAL}; }}
        [data-baseweb="tab-highlight"] {{ background-color: {GOLD} !important; height: 3px !important; }}

        /* Butang */
        .stButton > button[kind="primary"], [data-testid="stBaseButton-primary"] {{
            background: {TEAL}; border: 1px solid {TEAL}; color: #fff; font-weight: 600;
            border-radius: 10px; }}
        .stButton > button[kind="primary"]:hover, [data-testid="stBaseButton-primary"]:hover {{
            background: {TEAL_DARK}; border-color: {TEAL_DARK}; }}
        .stButton > button[kind="secondary"], [data-testid="stBaseButton-secondary"] {{
            border-radius: 10px; border-color: {BORDER}; color: {TEAL}; }}

        :focus-visible {{ outline: none !important;
            box-shadow: 0 0 0 3px rgba(214,180,103,0.35) !important; }}

        /* Dataframe */
        [data-testid="stDataFrame"] {{ border: 1px solid {BORDER}; border-radius: 12px; overflow: hidden; }}

        /* ===== Header berjenama ===== */
        .dicciHeader {{ display:flex; align-items:flex-end; justify-content:space-between;
            flex-wrap:wrap; gap:14px; margin-bottom:6px; }}
        .dicciBrand {{ display:flex; align-items:center; gap:14px; }}
        .dicciBrand img {{ height:44px; width:auto; }}
        .dicciSystem {{ color:{MUTED}; font-size:0.75rem; font-weight:600; text-transform:uppercase;
            letter-spacing:0.14em; }}
        .dicciEmblem {{ display:inline-flex; align-items:center; gap:10px; }}
        .dicciEmblem .diamond {{ color:{GOLD}; font-size:1.5rem; }}
        .dicciEmblem .word {{ color:{TEAL}; font-size:1.7rem; font-weight:700; letter-spacing:0.04em; }}
        .dicciPage {{ text-align:right; }}
        .dicciPageTitle {{ color:{INK_STRONG}; font-size:1.5rem; }}
        .dicciPageSub {{ color:{MUTED}; font-size:0.82rem; }}
        .dicciRule {{ height:1px; border:0; margin:10px 0 22px;
            background:linear-gradient(90deg, {GOLD} 0, {GOLD} 56px, {BORDER} 56px,
            rgba(231,225,211,0) 100%); }}

        /* ===== Jalur hero ===== */
        .dicciHero {{ position:relative; overflow:hidden; border-radius:18px;
            background:radial-gradient(120% 140% at 0% 0%, rgba(214,180,103,0.14), transparent 45%),
                linear-gradient(120deg, {TEAL_DARK} 0%, {TEAL} 55%, {TEAL_MID} 100%);
            border:1px solid rgba(214,180,103,0.18);
            padding:28px 32px; margin:6px 0 18px; display:flex; align-items:center;
            justify-content:space-between; flex-wrap:wrap; gap:18px;
            box-shadow:0 14px 38px rgba(7,42,48,0.18); }}
        .dicciHero::before {{ content:''; position:absolute; inset:0 0 auto 0; height:1px;
            background:linear-gradient(90deg, transparent, rgba(232,200,133,0.6), transparent); }}
        .dicciHeroLabel {{ color:rgba(255,255,255,0.78); font-size:0.72rem; font-weight:700;
            text-transform:uppercase; letter-spacing:0.12em; margin-bottom:10px; }}
        .dicciHeroValue {{ color:{GOLD}; font-size:2.9rem; font-weight:600; line-height:1;
            letter-spacing:-0.02em; }}
        .dicciHeroSub {{ color:rgba(255,255,255,0.7); font-size:0.9rem; margin-top:12px; }}
        .dicciFlag {{ position:relative; z-index:1; display:inline-flex; align-items:center; gap:8px;
            padding:9px 16px; border-radius:999px; font-weight:700; font-size:0.85rem; }}
        .dicciFlag .dot {{ width:9px; height:9px; border-radius:50%; }}
        .flagOk {{ background:rgba(255,255,255,0.12); color:#fff; }}
        .flagOk .dot {{ background:{GOLD}; }}
        .flagWarn {{ background:rgba(168,49,42,0.92); color:#fff; }}
        .flagWarn .dot {{ background:#fff; }}

        /* ===== Band alert bocor / bersih ===== */
        .dicciAlert {{ border-radius:14px; margin:0 0 18px; display:flex; align-items:center;
            justify-content:space-between; flex-wrap:wrap; gap:12px; font-weight:600; }}
        .dicciAlert .lead {{ display:flex; align-items:center; gap:10px; }}
        .dicciAlert .ico {{ font-size:1.05rem; }}
        .dicciAlert .meta {{ font-size:0.82rem; opacity:0.9; }}
        .dicciAlert.leak {{ background:{DANGER_BG}; border:1px solid rgba(168,49,42,0.25);
            color:{DANGER_TEXT}; padding:16px 22px; }}
        .dicciAlert.leak .lead {{ font-size:1.02rem; }}
        .dicciAlert.clean {{ background:{POSITIVE_BG}; border:1px solid rgba(30,122,94,0.22);
            color:{POSITIVE_TEXT}; padding:11px 20px; }}

        /* ===== Baris kad KPI ===== */
        .dicciKpis {{ display:flex; gap:14px; flex-wrap:wrap; margin:0 0 8px; }}
        .dicciKpi {{ flex:1 1 0; min-width:120px; background:{CARD}; border:1px solid {BORDER};
            border-top:2px solid {GOLD}; border-radius:14px; padding:14px 18px;
            box-shadow:0 1px 3px rgba(7,42,48,0.07), 0 1px 2px rgba(7,42,48,0.04); }}
        .dicciKpi .kLabel {{ color:{MUTED}; font-size:0.7rem; font-weight:600; text-transform:uppercase;
            letter-spacing:0.07em; }}
        .dicciKpi .kValue {{ color:{TEAL}; font-size:1.45rem; font-weight:700; margin-top:6px;
            font-variant-numeric:tabular-nums; }}

        /* ===== Tajuk seksyen ===== */
        .dicciSection {{ display:flex; align-items:baseline; gap:10px; margin:26px 0 6px; }}
        .dicciSection .bar {{ width:4px; height:17px; border-radius:2px; background:{GOLD};
            align-self:center; }}
        .dicciSection .t {{ color:{INK_STRONG}; font-size:1.1rem; }}
        .dicciSection .s {{ color:{MUTED}; font-size:0.8rem; }}
        </style>
        """,
        unsafe_allow_html=True,
    )


# ====================================================================
# Komponen berjenama (boleh guna semula merentas page)
# ====================================================================
def page_header(title, subtitle=""):
    uri = _logo_data_uri()
    if uri:
        brand = f'<div class="dicciBrand"><img src="{uri}"/>' \
                f'<div class="dicciSystem">Group Finance</div></div>'
    else:
        brand = '<div class="dicciBrand"><span class="dicciEmblem">' \
                '<span class="diamond">◆</span><span class="word">DICCI</span></span>' \
                '<span class="dicciSystem">Group Finance</span></div>'
    st.markdown(
        f"""
        <div class="dicciHeader">
            {brand}
            <div class="dicciPage">
                <div class="dicciPageTitle">{title}</div>
                <div class="dicciPageSub">{subtitle}</div>
            </div>
        </div>
        <div class="dicciRule"></div>
        """,
        unsafe_allow_html=True,
    )


def hero_band(label, value, sublines="", flag_text=None, flag_ok=True, prefix="RM "):
    val = f"{prefix}{value:,.2f}" if isinstance(value, (int, float)) else f"{prefix}{value}"
    flag = ""
    if flag_text:
        cls = "flagOk" if flag_ok else "flagWarn"
        flag = f'<div class="dicciFlag {cls}"><span class="dot"></span>{flag_text}</div>'
    sub = f'<div class="dicciHeroSub">{sublines}</div>' if sublines else ""
    st.markdown(
        f"""
        <div class="dicciHero">
            <div>
                <div class="dicciHeroLabel">{label}</div>
                <div class="dicciHeroValue">{val}</div>
                {sub}
            </div>
            {flag}
        </div>
        """,
        unsafe_allow_html=True,
    )


def alert_band(n_leak, risk=None, hint="butiran penuh di tab Audit"):
    """Band merah bila ada exception integriti (bocor), jalur hijau nipis bila bersih."""
    if n_leak and n_leak > 0:
        meta = f"RM {risk:,.2f} berisiko · {hint}" if risk else hint
        st.markdown(
            f'<div class="dicciAlert leak"><div class="lead"><span class="ico">⚠</span>'
            f'{int(n_leak)} exception integriti, perlu siasat</div>'
            f'<div class="meta">{meta}</div></div>',
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            '<div class="dicciAlert clean"><div class="lead"><span class="ico">✓</span>'
            'Buku bersih, tiada bocor integriti dikesan</div></div>',
            unsafe_allow_html=True,
        )


def kpi_row(items):
    """items = list of (label, value_str)."""
    cards = "".join(
        f'<div class="dicciKpi"><div class="kLabel">{lbl}</div>'
        f'<div class="kValue">{val}</div></div>'
        for lbl, val in items
    )
    st.markdown(f'<div class="dicciKpis">{cards}</div>', unsafe_allow_html=True)


def section(title, sub=""):
    s = f'<span class="s">{sub}</span>' if sub else ""
    st.markdown(
        f'<div class="dicciSection"><span class="bar"></span>'
        f'<span class="t">{title}</span>{s}</div>',
        unsafe_allow_html=True,
    )


# ====================================================================
# Chart berjenama (Altair, dibundel dengan Streamlit, tiada dep baru)
# ====================================================================
def bar_chart_brand(df, x, y, x_title="", y_title="Net remit (RM)"):
    return (
        alt.Chart(df)
        .mark_bar(color=GOLD, cornerRadiusTopLeft=4, cornerRadiusTopRight=4, size=26)
        .encode(
            x=alt.X(f"{x}:N", sort=None,
                    axis=alt.Axis(title=x_title, labelColor=INK, titleColor=MUTED,
                                  labelAngle=-35, domainColor=BORDER, tickColor=BORDER)),
            y=alt.Y(f"{y}:Q",
                    axis=alt.Axis(title=y_title, labelColor=MUTED, titleColor=MUTED,
                                  gridColor=BORDER, domainColor=BORDER, tickColor=BORDER)),
            tooltip=[alt.Tooltip(f"{x}:N", title="Tempoh"),
                     alt.Tooltip(f"{y}:Q", title="Net remit", format=",.2f")],
        )
        .properties(height=280)
        .configure_view(strokeWidth=0)
        .configure_axis(labelFont="Manrope", titleFont="Manrope")
    )


# ====================================================================
# Styling jadual: cip warna untuk lajur kategori
# ====================================================================
def style_kategori(df):
    if "kategori" not in df.columns:
        return df
    def paint(v):
        fg, bg = KAT_COLORS.get(v, (MUTED, BG_SUNKEN))
        return f"color:{fg}; background-color:{bg}; font-weight:600;"
    return df.style.applymap(paint, subset=["kategori"])
