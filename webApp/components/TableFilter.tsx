"use client";

// Kotak tapis kecil untuk jadual di halaman (client). Logik tapis duduk di
// pemanggil, ni cuma input + ikon, guna gaya kelas searchBox sedia ada.
export default function TableFilter({
  placeholder, value, onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="searchBox">
      <svg className="searchIc" width="15" height="15" viewBox="0 0 20 20" fill="none"
           stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="9" r="6" /><path d="m14 14 3.5 3.5" />
      </svg>
      <input
        className="searchInput" type="search" value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
        style={{ maxWidth: 240, padding: "7px 10px", fontSize: 13 }}
      />
    </div>
  );
}
