import Sidebar from "@/components/Sidebar";

export default function ImpactLayout({ children }: { children: React.ReactNode }) {
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
        <Sidebar />
        <main className="main">
          <div className="pageWrap">{children}</div>
        </main>
      </div>
    </>
  );
}
