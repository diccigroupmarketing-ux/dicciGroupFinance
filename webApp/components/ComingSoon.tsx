import Link from "next/link";

// Skrin jujur untuk anak syarikat yang BELUM disambungkan ke sistem finance.
// Tiada data palsu, tiada animasi tipu, cuma satu ayat jujur + jalan balik.
export default function ComingSoon({ company }: { company: string }) {
  return (
    <div className="comingWrap">
      <div className="comingCard">
        <div className="comingBrand">
          <div className="comingMark">DICCI</div>
          <div className="comingBrandSub">Group Finance</div>
        </div>
        <div className="comingBadge">Not connected yet</div>
        <h1 className="comingName">{company}</h1>
        <p className="comingLine">
          {company} isn&rsquo;t wired into the finance system yet. There is no data to
          show here until it is connected.
        </p>
        <Link href="/impact" className="comingBack">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" width="16" height="16">
            <path d="M12 5.5 7.5 10l4.5 4.5" />
          </svg>
          Back to Dicci Impact
        </Link>
      </div>
    </div>
  );
}
