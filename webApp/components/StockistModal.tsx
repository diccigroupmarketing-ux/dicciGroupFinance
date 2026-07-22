"use client";

// Mini page stokis (drill modal). Fetch on-demand /api/stockist ikut stokis +
// tempoh. Render setia mockup yang diluluskan, guna token/kelas brand. Read-only.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { StockistDetail } from "@/lib/recon";
import { fmtDate, fmtInt, fmtRM } from "@/lib/format";
import ExportCsv from "@/components/ExportCsv";
import CourierBreakdown, { canBreakdown } from "@/components/CourierBreakdown";
import TableFilter from "@/components/TableFilter";

const ORDER_COLS = [
  { key: "order_id", header: "Order" }, { key: "order_date", header: "Date" },
  { key: "status", header: "Status" }, { key: "shipping_provider", header: "Courier" },
  { key: "expected", header: "Expected" }, { key: "net_remit", header: "Net remit" },
  { key: "botol_total", header: "Bottles" }, { key: "duit", header: "Money" },
];

const WIDE = { from: "0001-01-01", to: "9999-12-31" };
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rmv = (n: number) => fmtRM(n).replace("RM ", "");
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

type Preset = "all" | "month" | "lastMonth" | "d90" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "month", label: "This month" }, { key: "lastMonth", label: "Last month" },
  { key: "d90", label: "Last 90 days" }, { key: "all", label: "All time" },
];

function presetRange(p: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  if (p === "all") return { ...WIDE };
  if (p === "d90") {
    const s = new Date(now); s.setDate(s.getDate() - 89);
    return { from: fmt(s), to: fmt(now) };
  }
  const off = p === "lastMonth" ? -1 : 0;
  const first = new Date(now.getFullYear(), now.getMonth() + off, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + off + 1, 0);
  return { from: fmt(first), to: fmt(last) };
}

const Warn = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 7v4m0 3h.01M10 2.5 18 16H2z" /></svg>
);

// Baldi jujur (paparan): label + nada, diturunkan dari payment_method + feed.
// CHIP (prepaid) diberi famili indigo supaya jelas beza dari COD (hijau/amber).
const BUCKET_META: Record<string, { label: string; chip: string }> = {
  confirmed_cod: { label: "Confirmed COD", chip: "chipPos" },
  confirmed_prepaid: { label: "Confirmed prepaid (CHIP)", chip: "chipInfo" },
  awaiting_cod: { label: "Awaiting COD remittance", chip: "chipCau" },
  awaiting_prepaid: { label: "Awaiting CHIP statement", chip: "chipInfo" },
  no_feed: { label: "No feed · cannot verify", chip: "chipDan" },
};
const CONFIRMED_BUCKETS = new Set(["confirmed_cod", "confirmed_prepaid"]);

// Tag saluran bayaran per baris baldi (sentiasa on, behavior prod).
const PAY_TAG: Record<string, { text: string; cls: string }> = {
  confirmed_cod: { text: "COD", cls: "paytagCod" },
  awaiting_cod: { text: "COD", cls: "paytagCod" },
  confirmed_prepaid: { text: "CHIP", cls: "paytagChip" },
  awaiting_prepaid: { text: "CHIP", cls: "paytagChip" },
  no_feed: { text: "Bank Transfer", cls: "paytagBank" },
};

export default function StockistModal({ stockist }: { stockist: string }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [preset, setPreset] = useState<Preset>("all");
  const [cf, setCf] = useState(""); const [ct, setCt] = useState("");
  const [data, setData] = useState<StockistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Accordion baldi COD: buka satu pada satu masa (default tutup).
  const [openBucket, setOpenBucket] = useState<string | null>(null);
  // Tapisan teks senarai order (order id / tracking), atas hasil penapis tarikh.
  const [orderQ, setOrderQ] = useState("");

  useEffect(() => setMounted(true), []);

  const range = useMemo(() => (
    preset === "custom" ? { from: cf || WIDE.from, to: ct || WIDE.to } : presetRange(preset)
  ), [preset, cf, ct]);

  // Tapis LIVE senarai order yang dah dimuat (order id + tracking), berlapis atas
  // hasil penapis tarikh, corak sama macam StockistTable. TIADA fetch baru.
  const orderRows = useMemo(() => {
    const rows = data?.orders.rows ?? [];
    const needle = orderQ.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((o) =>
      o.order_id.toLowerCase().includes(needle) ||
      (o.tracking ?? "").toLowerCase().includes(needle));
  }, [data, orderQ]);

  const disp = preset === "custom"
    ? { from: cf, to: ct }
    : preset === "all" ? { from: "", to: "" } : presetRange(preset);

  const onEdit = (side: "from" | "to", v: string) => {
    let nf = cf, nt = ct;
    if (preset !== "custom") {
      const r = preset === "all" ? { from: "", to: fmt(new Date()) } : presetRange(preset);
      nf = r.from; nt = r.to;
    }
    if (side === "from") nf = v; else nt = v;
    setCf(nf); setCt(nt); setPreset("custom");
  };

  const close = useCallback(() => router.push("/impact/stockists"), [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    const q = `s=${encodeURIComponent(stockist)}&from=${range.from}&to=${range.to}`;
    fetch(`/api/stockist?${q}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error || "gagal muat"))))
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { setErr(String(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [stockist, range.from, range.to]);

  if (!mounted) return null;

  const m = data?.money, b = data?.bottles, st = data?.status;
  const cm = data?.commission, gf = data?.gifts;
  const maxProd = data ? Math.max(1, ...data.products.map((p) => p.bottles)) : 1;

  return createPortal(
    <div className="modalBack" onClick={close}>
      <div className="stkSheet" role="dialog" aria-modal="true"
        aria-label={`Stockist ${stockist}`} onClick={(e) => e.stopPropagation()}>

        <div className="stkTop">
          <div>
            <div className="eyebrow">Stockist · mini view</div>
            <h2>{stockist}</h2>
            {m && (
              <div className="stkSub">
                <b>{fmtInt(m.ordersTotal)}</b> orders in period ·{" "}
                <b>{fmtInt(m.ordersWithFeed)}</b> with a money feed
              </div>
            )}
          </div>
          <button className="stkX" aria-label="Close" onClick={close}>×</button>
        </div>

        <div className="stkPeriod">
          <span className="stkPLab">Period</span>
          <div className="segRow" role="tablist" aria-label="Period preset">
            {PRESETS.map((p) => (
              <button key={p.key} className={"segBtn" + (preset === p.key ? " active" : "")}
                aria-selected={preset === p.key} onClick={() => setPreset(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="stkDates">
            <input type="date" value={disp.from} aria-label="From date"
              onChange={(e) => onEdit("from", e.target.value)} />
            <span>&rarr;</span>
            <input type="date" value={disp.to} aria-label="To date"
              onChange={(e) => onEdit("to", e.target.value)} />
          </div>
        </div>

        <div className="stkBody">
          {loading && <div className="stkEmpty">Loading stockist data…</div>}
          {err && !loading && <div className="modalWarn">Could not load: {err}</div>}

          {!loading && !err && data && m && b && st && cm && gf && (
            <>
              <div className="stkNote">
                All figures reflect{" "}
                <b>{range.from === WIDE.from && range.to === WIDE.to
                  ? "all time"
                  : `${range.from === WIDE.from ? "the beginning" : range.from} → ${range.to === WIDE.to ? "today" : range.to}`}</b>.
              </div>

              {/* MONEY */}
              <section>
                <div className="stkSecTitle">Money accountability
                  <span className="h">is this stockist&apos;s money all in?</span></div>
                <div className="stkKpis">
                  <div className="stkTile">
                    <div className="l">Expected</div>
                    <div className="v"><small>RM</small> {rmv(m.expected)}</div>
                    <div className="s">order value in period</div>
                  </div>
                  <div className="stkTile hero">
                    <div className="l">Confirmed · net remit</div>
                    <div className="v pos"><small>RM</small> {rmv(m.confirmedNet)}</div>
                    <div className="s">collected − fee, matched to feed</div>
                  </div>
                  <div className="stkTile warn">
                    <div className="l">Awaiting confirmation</div>
                    <div className="v cau"><small>RM</small> {rmv(m.awaiting)}</div>
                    <div className="s">{fmtInt(m.ordersTotal - m.ordersWithFeed)} orders, no feed yet</div>
                  </div>
                </div>
                <div className="stkCover">
                  <span>Feed coverage</span>
                  <span className="stkTrack"><i style={{ width: `${pct(m.ordersWithFeed, m.ordersTotal)}%` }} /></span>
                  <span><b style={{ color: "var(--inkStrong)" }}>{fmtInt(m.ordersWithFeed)} of {fmtInt(m.ordersTotal)}</b> orders</span>
                </div>
                {m.buckets.length > 0 && (
                  <div className="stkBuckets">
                    <div className="stkBucketsHead">Honest breakdown (Completed orders)</div>
                    {m.buckets.map((bk) => {
                      const meta = BUCKET_META[bk.bucket] ?? { label: bk.bucket, chip: "chipMut" };
                      const conf = CONFIRMED_BUCKETS.has(bk.bucket);
                      const expandable = canBreakdown(bk);
                      const isOpen = openBucket === bk.bucket;
                      return (
                        <div key={bk.bucket}>
                          <div
                            className={"stkBucketRow" + (expandable ? " expandable" : "") + (isOpen ? " open" : "")}
                            onClick={expandable ? () => setOpenBucket(isOpen ? null : bk.bucket) : undefined}
                            role={expandable ? "button" : undefined}
                            aria-expanded={expandable ? isOpen : undefined}
                            tabIndex={expandable ? 0 : undefined}
                            onKeyDown={expandable ? (e) => {
                              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenBucket(isOpen ? null : bk.bucket); }
                            } : undefined}
                          >
                            <span className="stkBucketLabel">
                              {expandable && (
                                <svg className="stkBucketCaret" width="11" height="11" viewBox="0 0 16 16" fill="none"
                                  stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                                  aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                              )}
                              <span className={"chip " + meta.chip}><span className="cdot" /> {meta.label}</span>
                              {PAY_TAG[bk.bucket] && (
                                <span className={"paytag " + PAY_TAG[bk.bucket].cls}>{PAY_TAG[bk.bucket].text}</span>
                              )}
                            </span>
                            <span className="stkBucketMeta">
                              {fmtInt(bk.orders)} order{bk.orders === 1 ? "" : "s"} · RM {rmv(bk.expected)}
                              {!conf && bk.oldestDays != null && (
                                <span className="stkBucketAge"> · {fmtInt(bk.oldestDays)}d oldest</span>
                              )}
                            </span>
                          </div>
                          {expandable && isOpen && (
                            <CourierBreakdown items={bk.byCourier!} showAging={!conf} />
                          )}
                        </div>
                      );
                    })}
                    <div className="stkNote" style={{ marginTop: 6 }}>
                      Prepaid is paid at checkout , &quot;awaiting CHIP statement&quot; auto-confirms
                      when the CHIP statement is uploaded, not leaked money.
                    </div>
                  </div>
                )}
                {m.collectedOnReturned > 0 && (
                  <div className="stkLeak"><Warn />
                    <div><b>Watch · RM {rmv(m.collectedOnReturned)} collected on {fmtInt(m.returnedWithMoney)} Returned order{m.returnedWithMoney === 1 ? "" : "s"}.</b> Money came in for returned orders , confirm the refund path or possible leak.</div>
                  </div>
                )}
              </section>

              {/* BOTTLES */}
              <section>
                <div className="stkSecTitle">Bottles moved <span className="h">Completed orders in period</span></div>
                {data.unmappedSkus.length > 0 && (
                  <div className="stkLeak" style={{ marginBottom: 10 }}><Warn />
                    <div><b>{fmtInt(data.unmappedSkus.length)} SKU{data.unmappedSkus.length === 1 ? "" : "s"} not mapped to bottles yet</b>{" "}
                      ({data.unmappedSkus.slice(0, 6).join(", ")}
                      {data.unmappedSkus.length > 6 ? ` +${data.unmappedSkus.length - 6} more` : ""}).
                      These count as 0 bottles, so the numbers below undercount.{" "}
                      <a href="/impact/skus" style={{ fontWeight: 700, textDecoration: "underline" }}>Map them on the SKU page</a>.</div>
                  </div>
                )}
                <div className="stkBottle">
                  <div className="stkbT">
                    <div className="l">Total bottles</div>
                    <div className="big">{fmtInt(b.total)}</div>
                    <div className="s">{fmtInt(b.paid)} paid · {fmtInt(b.free)} free</div>
                  </div>
                  <div className="stkSplits">
                    <div className="stkSplit">
                      <div className="stkSplitHead"><span>Paid vs Free</span><b>{fmtInt(b.paid)} / {fmtInt(b.free)}</b></div>
                      <div className="stkStack">
                        <i className="stkSegPaid" style={{ width: `${pct(b.paid, b.total)}%` }} />
                        <i className="stkSegFree" style={{ width: `${pct(b.free, b.total)}%` }} />
                      </div>
                      <div className="stkLeg"><span><i className="swPaid" />Paid (sales) {fmtInt(b.paid)}</span><span><i className="swFree" />Free (giveaway juice) {fmtInt(b.free)}</span></div>
                    </div>
                    <div className="stkSplit">
                      <div className="stkSplitHead"><span>Money confirmed vs unconfirmed</span><b>{fmtInt(b.confirmed)} / {fmtInt(b.unconfirmed)}</b></div>
                      <div className="stkStack">
                        <i className="stkSegConf" style={{ width: `${pct(b.confirmed, b.total)}%` }} />
                        <i className="stkSegUn" style={{ width: `${pct(b.unconfirmed, b.total)}%` }} />
                      </div>
                      <div className="stkLeg"><span><i className="swConf" />Confirmed {fmtInt(b.confirmed)}</span><span><i className="swUn" />Unconfirmed {fmtInt(b.unconfirmed)}</span></div>
                    </div>
                  </div>
                </div>
              </section>

              {/* ORDER HEALTH + COMMISSION */}
              <div className="stkGrid2">
                <div className="stkCard">
                  <div className="stkSecTitle">Order health</div>
                  <div className="stkStats">
                    <div className="stkStat good"><span className="n">{fmtInt(st.completed)}</span><span className="k">Completed</span></div>
                    <div className="stkStat bad"><span className="n">{fmtInt(st.returned)}</span><span className="k">Returned</span><span className="bb">{fmtInt(st.returnedBottles)} bottles</span></div>
                    <div className="stkStat bad"><span className="n">{fmtInt(st.rejected)}</span><span className="k">Rejected</span><span className="bb">{fmtInt(st.rejectedBottles)} bottles</span></div>
                    <div className="stkStat"><span className="n">{fmtInt(st.other)}</span><span className="k">In transit</span></div>
                  </div>
                  <div className="stkReturn">Return + reject rate{" "}
                    <span className="pct">{(st.returnRate * 100).toFixed(1)}%</span>
                    <span>· {fmtInt(st.returned + st.rejected)} of {fmtInt(st.total)}</span></div>
                </div>

                <div className="stkCard">
                  <div className="stkSecTitle">Commission <span className="h">Fighter wallet{cm.level ? ` · ${cm.level}` : ""}</span></div>
                  <div className="stkCrow"><span>Earned (approved)</span><span className="cv">{fmtRM(cm.earned)}</span></div>
                  <div className="stkCrow"><span>Paid out (withdraw)</span><span className="cv">{fmtRM(cm.paid)}</span></div>
                  <div className="stkCrow bal"><span>Balance</span><span className="cv">{fmtRM(cm.balance)}</span></div>
                  {cm.leakAmount > 0 && (
                    <div className="stkCflag"><Warn />
                      <div><b>{fmtRM(cm.leakAmount)}</b> commission on {fmtInt(cm.leakOrders)} order{cm.leakOrders === 1 ? "" : "s"} not confirmed-paid , possible overpay.</div>
                    </div>
                  )}
                </div>
              </div>

              {/* PRODUCTS & GIFTS */}
              <div className="stkCard">
                <div className="stkSecTitle">Products &amp; gifts <span className="h">confirmed orders</span></div>
                {data.products.length === 0
                  ? <div className="stkEmpty">No confirmed bottles in this period.</div>
                  : (
                    <div className="stkBars">
                      {data.products.map((p) => (
                        <div className="stkBar" key={p.sku}>
                          <span className="nm" title={p.product_name ?? p.sku}>{p.sku}</span>
                          <span className="tk"><i style={{ width: `${pct(p.bottles, maxProd)}%` }} /></span>
                          <span className="bn">{fmtInt(p.bottles)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                <div className="giftChips" style={{ marginTop: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 700, marginRight: 2 }}>Free gifts</span>
                  {gf.confirmed.length === 0 && <span style={{ color: "var(--faint)" }}>—</span>}
                  {gf.confirmed.map((g) => (
                    <span className="giftChip" key={g.gift_name}>{g.gift_name} <b>×{fmtInt(g.qty)}</b> · RM {rmv(g.cost)}</span>
                  ))}
                  {gf.atRiskCost > 0 && (
                    <span className="chip chipDan"><span className="cdot" />At-risk · RM {rmv(gf.atRiskCost)}</span>
                  )}
                </div>
              </div>

              {/* ORDERS */}
              <section>
                <div className="stkSecTitle">Orders
                  <span className="h">latest first · showing {fmtInt(Math.min(60, orderRows.length))} of {fmtInt(data.orders.total)}</span>
                  <ExportCsv rows={data.orders.rows} columns={ORDER_COLS} total={data.orders.total}
                    filename={`stockist-${stockist}-orders.csv`} /></div>
                <div className="cardHead" style={{ marginTop: 4, marginBottom: 6 }}>
                  <TableFilter placeholder="Filter orders…" value={orderQ} onChange={setOrderQ} />
                  {orderQ.trim() && (
                    <div className="cardHint">{fmtInt(orderRows.length)} of {fmtInt(data.orders.rows.length)} loaded</div>
                  )}
                </div>
                {orderRows.length === 0 ? (
                  <div className="stkEmpty">No orders match this filter.</div>
                ) : (
                  <div className="tableWrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Order</th><th>Date</th><th>Status</th><th>Courier</th>
                          <th className="num">Expected</th><th className="num">Net remit</th>
                          <th className="num">Bottles</th><th>Money</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderRows.slice(0, 60).map((o) => (
                          <tr key={o.order_id}>
                            <td className="cellMain">{o.order_id}</td>
                            <td>{fmtDate(o.order_date)}</td>
                            <td>{o.status ?? "—"}</td>
                            <td>{o.shipping_provider ?? "—"}</td>
                            <td className="num">{o.expected == null ? "—" : rmv(o.expected)}</td>
                            <td className="num" style={{ color: o.net_remit == null ? "var(--faint)" : "var(--posText)" }}>
                              {o.net_remit == null ? "—" : rmv(o.net_remit)}</td>
                            <td className="num">{fmtInt(o.botol_total)}</td>
                            <td>{o.duit === "confirmed"
                              ? <span className="chip chipPos"><span className="cdot" />Confirmed</span>
                              : <span className="chip chipMut"><span className="cdot" />Unconfirmed</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {orderRows.length > 60 && (
                  <div className="stkNote" style={{ marginTop: 8 }}>Showing first 60 rows of {fmtInt(orderRows.length)} loaded. Export or narrow the period for the rest.</div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
