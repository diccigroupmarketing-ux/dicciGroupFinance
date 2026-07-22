"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton, useUser } from "@clerk/nextjs";
import UploadModal from "./UploadModal";

const ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="9" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="14" width="6" height="3" rx="1.2" />
    </svg>
  ),
  jnt: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M2.5 5.5h9v9h-9z" /><path d="M11.5 8h3l3 3v3.5h-6z" />
      <circle cx="6" cy="15.5" r="1.6" /><circle cx="14.5" cy="15.5" r="1.6" />
    </svg>
  ),
  dhl: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 6.5 10 3l7 3.5v7L10 17l-7-3.5z" /><path d="M3 6.5 10 10l7-3.5M10 10v7" />
    </svg>
  ),
  ninja: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="10" cy="10" r="7" /><path d="M6.5 12.5 10 6l3.5 6.5" />
    </svg>
  ),
  chip: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="2.5" y="5" width="15" height="10.5" rx="2" /><path d="M2.5 8.5h15" />
    </svg>
  ),
  bank: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 16.5h14M4.5 8.5v5M8.2 8.5v5M11.8 8.5v5M15.5 8.5v5M2.5 8.5 10 3.5l7.5 5z" />
    </svg>
  ),
  commission: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="10" cy="6.5" r="3" /><path d="M3.5 16.5c.8-3 3.4-4.5 6.5-4.5s5.7 1.5 6.5 4.5" />
    </svg>
  ),
  stockists: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M8 3h4v3l1.5 2v8a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 16V8L8 6z" />
      <path d="M6.5 11h7" />
    </svg>
  ),
  sku: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="m3 10 7-7 7 3v4l-7 7z" transform="rotate(90 10 10)" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </svg>
  ),
  activity: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M2.5 10.5h3l2-5 3 11 2.5-6h4.5" />
    </svg>
  ),
  uploads: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3h5L14 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 15.5z" />
      <path d="M10.5 3v3.5H14M7 12.5h4M7 9.8h4" />
    </svg>
  ),
  export: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M10 3v8m0 0 3-3m-3 3-3-3M4 14.5v2A1.5 1.5 0 0 0 5.5 18h9a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  ),
  gift: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 8h12v9H4z" /><path d="M2.5 8h15v3h-15z" /><path d="M10 8v9" />
      <path d="M10 8C10 6 8.8 4.5 7.5 4.5S6 5.5 7 6.5s3 1.5 3 1.5m0 0C10 6 11.2 4.5 12.5 4.5S14 5.5 13 6.5s-3 1.5-3 1.5" />
    </svg>
  ),
  settings: (
    <svg className="navIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M15.4 4.6 14 6M6 14l-1.4 1.4" />
    </svg>
  ),
};

// Pola URL stream courier sedia ada: /impact/streams/<key>. CHIP ikut pola sama.
type NavLink = {
  key: string; name: string; icon: string;
  href?: string; disabled?: boolean; badge?: string;
};
type NavGroupDef = { id: string; label: string; items: NavLink[]; pinned?: boolean };

const GROUPS: NavGroupDef[] = [
  {
    id: "moneyIn", label: "Money in",
    items: [
      { key: "dashboard", name: "Dashboard", icon: "dashboard", href: "/impact" },
      { key: "jnt", name: "J&T COD", icon: "jnt", href: "/impact/streams/jnt" },
      { key: "dhl", name: "DHL", icon: "dhl", href: "/impact/streams/dhl" },
      { key: "ninja", name: "Ninja Van", icon: "ninja", href: "/impact/streams/ninja" },
      { key: "chip", name: "CHIP", icon: "chip", href: "/impact/streams/chip" },
    ],
  },
  {
    id: "moneyOut", label: "Money out",
    items: [
      { key: "moneyOutSoon", name: "Coming soon", icon: "bank", disabled: true, badge: "Soon" },
    ],
  },
  {
    id: "operations", label: "Operations",
    items: [
      { key: "stockists", name: "Stockists", icon: "stockists", href: "/impact/stockists" },
      { key: "skus", name: "SKUs", icon: "sku", href: "/impact/skus" },
      { key: "gifts", name: "Gifts", icon: "gift", href: "/impact/gifts" },
      { key: "commission", name: "Commission", icon: "commission", href: "/impact/commission" },
    ],
  },
  {
    id: "tools", label: "Tools",
    items: [
      { key: "uploads", name: "Uploads", icon: "uploads", href: "/impact/uploads" },
      { key: "activity", name: "Activity", icon: "activity", href: "/impact/activity" },
      { key: "export", name: "Export", icon: "export", href: "/impact/export" },
    ],
  },
  {
    id: "settings", label: "Settings", pinned: true,
    items: [
      { key: "settingsSoon", name: "Coming soon", icon: "settings", disabled: true, badge: "Soon" },
    ],
  },
];

// Anak syarikat lain masih "coming soon"; Impact = app sebenar ni.
const COMPANIES = [
  { key: "group", name: "Dicci Group", dot: "DG", href: "/group" },
  { key: "impact", name: "Dicci Impact", dot: "DI", href: "/impact" },
  { key: "flux", name: "Dicci Flux", dot: "DF", href: "/flux" },
  { key: "hub", name: "Dicci Hub", dot: "DH", href: "/hub" },
  { key: "empyre", name: "Dicci Empyre", dot: "DE", href: "/empyre" },
];

const GROUP_LS = (id: string) => `dicci.nav.${id}`;

export default function Sidebar() {
  const path = usePathname();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initial = (email[0] ?? "D").toUpperCase();
  const cls = (active: boolean) => "navItem" + (active ? " active" : "");

  // Collapse jadi icon rail. Keadaan sebenar dipegang class `sideRailed` pada
  // <html> (diset pra-paint oleh script kecil dalam layout supaya tiada flash).
  // State di sini cuma cermin dia untuk aria + tooltip.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(document.documentElement.classList.contains("sideRailed"));
  }, []);
  const toggleRail = () => {
    setCollapsed((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("sideRailed", next);
      try { localStorage.setItem("dicci.sideRailed", next ? "1" : "0"); } catch {}
      return next;
    });
  };
  const tip = (label: string) => (collapsed ? label : undefined);

  // Buka/tutup tiap kumpulan, diingat dalam localStorage (default: semua buka).
  const [open, setOpen] = useState<Record<string, boolean>>(
    () => Object.fromEntries(GROUPS.map((g) => [g.id, true])),
  );
  useEffect(() => {
    setOpen((prev) => {
      const next = { ...prev };
      for (const g of GROUPS) {
        try {
          const v = localStorage.getItem(GROUP_LS(g.id));
          if (v === "0") next[g.id] = false;
          else if (v === "1") next[g.id] = true;
        } catch {}
      }
      return next;
    });
  }, []);
  const toggleGroup = (id: string) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(GROUP_LS(id), next[id] ? "1" : "0"); } catch {}
      return next;
    });
  };

  // Company switcher dropdown.
  const [switchOpen, setSwitchOpen] = useState(false);
  const switchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!switchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (switchRef.current && !switchRef.current.contains(e.target as Node)) {
        setSwitchOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSwitchOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [switchOpen]);

  const isActive = (link: NavLink) => !!link.href && path === link.href;

  const renderItem = (link: NavLink) => {
    if (link.disabled) {
      return (
        <span key={link.key} className="navItem disabled" title={tip(link.name)}>
          {ICONS[link.icon]} <span className="navText">{link.name}</span>
          {link.badge && <span className="navBadge">{link.badge}</span>}
        </span>
      );
    }
    return (
      <Link key={link.key} href={link.href!} className={cls(isActive(link))} title={tip(link.name)}>
        {ICONS[link.icon]} <span className="navText">{link.name}</span>
      </Link>
    );
  };

  const renderGroup = (g: NavGroupDef) => {
    const isOpen = open[g.id];
    return (
      <nav
        key={g.id}
        className={"navGroup" + (isOpen ? " open" : "") + (g.pinned ? " navGroupPinned" : "")}
        aria-label={g.label}
      >
        <button
          className="navGroupHead"
          onClick={() => toggleGroup(g.id)}
          aria-expanded={isOpen}
          title={tip(g.label)}
        >
          <span className="navGroupLabel">{g.label}</span>
          <svg className="navChevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 8.5 10 12l4-3.5" />
          </svg>
        </button>
        <div className="navGroupBody">
          {g.items.map(renderItem)}
        </div>
      </nav>
    );
  };

  return (
    <aside className="side">
      <div className="sideTop">
        <div className="brand">
          <div className="brandName">DICCI</div>
          <div className="brandSub">Group Finance</div>
        </div>
        <button
          className="railToggle"
          onClick={toggleRail}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M12 5.5 7.5 10l4.5 4.5" />
          </svg>
        </button>
      </div>

      <div className="companySwitch" ref={switchRef}>
        <button
          className="company companyBtn"
          onClick={() => setSwitchOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={switchOpen}
          title={tip("Switch company")}
        >
          <div className="companyDot">DI</div>
          <div className="companyMeta">
            <div className="companyName">Dicci Impact</div>
            <div className="companyRole">Phase 1 · Active</div>
          </div>
          <svg className="companyCaret" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 8.5 10 12l4-3.5" />
          </svg>
        </button>
        {switchOpen && (
          <div className="companyMenu" role="menu">
            {COMPANIES.map((c) => {
              const active = c.key === "impact";
              return (
                <Link
                  key={c.key}
                  href={c.href}
                  role="menuitem"
                  className={"companyMenuItem" + (active ? " active" : "")}
                  onClick={() => setSwitchOpen(false)}
                >
                  <span className="companyMenuDot">{c.dot}</span>
                  <span className="companyMenuName">{c.name}</span>
                  {active && <span className="companyMenuTag">Current</span>}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="navScroll">
        {GROUPS.filter((g) => !g.pinned).map(renderGroup)}
      </div>

      {GROUPS.filter((g) => g.pinned).map(renderGroup)}

      <div className="sideFoot">
        <UploadModal />
        <div className="userChip">
          <div className="userAva">{initial}</div>
          <div className="userMail" title={email}>{email || "Signed in"}</div>
          <SignOutButton>
            <button className="signOutBtn" title="Sign out" aria-label="Sign out">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" width="15" height="15">
                <path d="M12.5 6.5v-2A1.5 1.5 0 0 0 11 3H5.5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17H11a1.5 1.5 0 0 0 1.5-1.5v-2M8 10h9m0 0-2.5-2.5M17 10l-2.5 2.5" />
              </svg>
            </button>
          </SignOutButton>
        </div>
      </div>
    </aside>
  );
}
