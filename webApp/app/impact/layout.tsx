import Sidebar from "@/components/Sidebar";

export default function ImpactLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <div className="pageWrap">{children}</div>
      </main>
    </div>
  );
}
