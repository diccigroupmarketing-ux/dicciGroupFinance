"use client";

// Sempadan error berjenama: satu hiccup Neon tak lagi tunjuk skrin crash kelabu
// Next tanpa jalan keluar. Bagi mesej + butang cuba semula.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="emptyCard">
      <div className="big">Couldn&apos;t load the data</div>
      This is usually a brief database hiccup, not lost data. Try again in a moment.
      <div style={{ marginTop: 18 }}>
        <button className="uploadBtn" onClick={reset} style={{ display: "inline-flex" }}>
          Try again
        </button>
      </div>
    </div>
  );
}
