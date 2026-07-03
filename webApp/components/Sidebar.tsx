"use client";

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
};

const STREAMS = [
  { key: "jnt", name: "J&T COD" },
  { key: "dhl", name: "DHL" },
  { key: "ninja", name: "Ninja Van" },
];

export default function Sidebar() {
  const path = usePathname();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initial = (email[0] ?? "D").toUpperCase();
  const cls = (active: boolean) => "navItem" + (active ? " active" : "");

  return (
    <aside className="side">
      <div className="brand">
        <div className="brandName">DICCI</div>
        <div className="brandSub">Group Finance</div>
      </div>

      <div className="company">
        <div className="companyDot">DI</div>
        <div>
          <div className="companyName">Dicci Impact</div>
          <div className="companyRole">Phase 1 · Active</div>
        </div>
      </div>

      <nav className="navGroup" aria-label="Overview">
        <div className="navLabel">Overview</div>
        <Link href="/impact" className={cls(path === "/impact")}>
          {ICONS.dashboard} Dashboard
        </Link>
      </nav>

      <nav className="navGroup" aria-label="Income streams">
        <div className="navLabel">Income streams</div>
        {STREAMS.map((s) => (
          <Link key={s.key} href={`/impact/streams/${s.key}`}
            className={cls(path === `/impact/streams/${s.key}`)}>
            {ICONS[s.key]} {s.name}
          </Link>
        ))}
        <span className="navItem disabled">{ICONS.chip} CHIP <span className="navBadge">Soon</span></span>
        <span className="navItem disabled">{ICONS.bank} Bank Transfer <span className="navBadge">Soon</span></span>
      </nav>

      <nav className="navGroup" aria-label="People">
        <div className="navLabel">People</div>
        <Link href="/impact/commission" className={cls(path === "/impact/commission")}>
          {ICONS.commission} Commission
        </Link>
        <Link href="/impact/stockists" className={cls(path === "/impact/stockists")}>
          {ICONS.stockists} Stockists
        </Link>
      </nav>

      <nav className="navGroup" aria-label="Setup">
        <div className="navLabel">Setup</div>
        <Link href="/impact/skus" className={cls(path === "/impact/skus")}>
          {ICONS.sku} SKU / Bottles
        </Link>
      </nav>

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
