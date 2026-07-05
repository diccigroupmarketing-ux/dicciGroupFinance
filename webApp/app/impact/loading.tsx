// Skeleton masa server component tarik data recon dari Neon. Tanpa ni, klik nav
// / tukar grain nampak beku beberapa saat sebelum render mendarat.
export default function Loading() {
  return (
    <div className="skelWrap" aria-busy="true" aria-label="Loading data">
      <div className="skel skelHead" />
      <div className="skel skelHero" />
      <div className="kpis">
        <div className="skel skelKpi" />
        <div className="skel skelKpi" />
        <div className="skel skelKpi" />
        <div className="skel skelKpi" />
      </div>
      <div className="grid2">
        <div className="skel skelCard" />
        <div className="skel skelCard" />
      </div>
    </div>
  );
}
