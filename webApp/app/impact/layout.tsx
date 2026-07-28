import Sidebar from "@/components/Sidebar";
import { pendingApprovals } from "@/components/resolveServer";

export default async function ImpactLayout({ children }: { children: React.ReactNode }) {
  // Kiraan kes yang menunggu kelulusan, untuk lencana sidebar. Satu SELECT atas
  // jadual kawalan yang kecil, dan ia menelan ralatnya sendiri (resolveServer),
  // jadi lencana tak pernah boleh merosakkan render page.
  const waiting = await pendingApprovals();
  return (
    <>
      {/* Set keadaan rail sebelum paint supaya sidebar tak "flash" buka -> tutup bila reload */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "try{if(localStorage.getItem('dicci.sideRailed')==='1')document.documentElement.classList.add('sideRailed')}catch(e){}",
        }}
      />
      <div className="shell">
        <Sidebar pendingApprovals={waiting.n} />
        <main className="main">
          <div className="pageWrap">{children}</div>
        </main>
      </div>
    </>
  );
}
