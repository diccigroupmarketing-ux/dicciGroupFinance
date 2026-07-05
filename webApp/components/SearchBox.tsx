"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Kotak carian: hantar ke /impact/search?q=... (server render hasil).
export default function SearchBox({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    router.push(`/impact/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <form className="searchBox" onSubmit={submit} role="search">
      <svg className="searchIc" width="17" height="17" viewBox="0 0 20 20" fill="none"
           stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="9" r="6" /><path d="m14 14 3.5 3.5" />
      </svg>
      <input
        className="searchInput" value={q} autoFocus
        onChange={(e) => setQ(e.target.value)}
        placeholder="Order ID or tracking number…"
        aria-label="Search orders by ID or tracking"
      />
      <button className="uploadBtn" type="submit" style={{ padding: "9px 16px" }}
              disabled={q.trim().length < 2}>Search</button>
    </form>
  );
}
