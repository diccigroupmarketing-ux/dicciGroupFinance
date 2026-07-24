"use client";

// Ikon bantuan "?" kecil yang boleh diguna semula. Letak sebelah label/heading
// yang team finance (bukan orang teknikal) mungkin tak faham. Hover ATAU
// klik/tap buka popover penjelasan pendek; klik luar / Esc tutup.
//
// Popover dirender melalui portal ke <body> dengan position fixed, sebab jadual
// dibungkus .tableWrap{overflow-x:auto} yang akan mengerat popover kalau ia
// absolute dalam sel. Fixed + portal = tak terkerat, dan kedudukan di-clamp
// supaya tak terpotong tepi skrin (anjak mengufuk + flip menegak).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHydrated } from "@/components/useHydrated";

type Anchor = { cx: number; top: number; bottom: number };

export default function InfoTip({
  text, label = "More info", children,
}: {
  text?: string;
  label?: string;
  children?: React.ReactNode;
}) {
  const hydrated = useHydrated();
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false); // sticky (klik/tap)
  const [peek, setPeek] = useState(false); // transient (hover/focus)
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [shift, setShift] = useState(0);
  const [flip, setFlip] = useState(false);

  const visible = open || peek;
  const content = children ?? text;

  const measureAnchor = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    setAnchor({ cx: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  }, []);

  const show = () => { measureAnchor(); setPeek(true); };
  const hide = () => setPeek(false);
  const toggle = () => { measureAnchor(); setOpen((o) => !o); };

  // Tutup bila klik luar atau Esc (untuk keadaan sticky).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Kekalkan kedudukan bila skrol/resize semasa nampak.
  useEffect(() => {
    if (!visible) return;
    const on = () => measureAnchor();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, [visible, measureAnchor]);

  // Clamp mengufuk + flip menegak selepas popover diukur.
  useLayoutEffect(() => {
    if (!visible || !anchor) return;
    const pop = popRef.current;
    if (!pop) return;
    const margin = 8;
    const vw = window.innerWidth;
    const r = pop.getBoundingClientRect();
    // Kedudukan "natural" (shift 0) untuk kira anjakan mutlak, elak gelung.
    const naturalLeft = r.left - shift;
    const naturalRight = r.right - shift;
    let dx = 0;
    if (naturalLeft < margin) dx = margin - naturalLeft;
    else if (naturalRight > vw - margin) dx = vw - margin - naturalRight;
    if (Math.abs(dx - shift) > 0.5) setShift(dx);
    // Flip ke bawah kalau ruang atas tak cukup.
    setFlip(anchor.top - r.height - 10 < margin);
  }, [visible, anchor, shift]);

  if (content == null) return null;

  return (
    <span
      ref={wrapRef}
      className="infoTip"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        ref={btnRef}
        type="button"
        className="infoTipBtn"
        aria-label={label}
        aria-expanded={visible}
        aria-describedby={visible ? id : undefined}
        onClick={toggle}
        onFocus={show}
        onBlur={hide}
      >
        ?
      </button>
      {hydrated && visible && anchor && createPortal(
        <div
          ref={popRef}
          id={id}
          role="tooltip"
          className={"infoTipPop" + (flip ? " below" : "")}
          style={{
            left: anchor.cx + shift,
            top: flip ? anchor.bottom + 8 : anchor.top - 8,
            transform: flip ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            ["--tipShift" as string]: `${shift}px`,
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </span>
  );
}
