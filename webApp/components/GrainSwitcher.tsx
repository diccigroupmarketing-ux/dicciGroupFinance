import Link from "next/link";
import type { Grain } from "@/lib/format";

const OPTIONS: { key: Grain; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

// Penukar grain chart (pautan server-side, kekal boleh bookmark/share).
export default function GrainSwitcher({ grain, basePath }: { grain: Grain; basePath: string }) {
  return (
    <div className="segRow" role="group" aria-label="Chart period grain">
      {OPTIONS.map((o) => (
        <Link key={o.key}
          href={o.key === "weekly" ? basePath : `${basePath}?grain=${o.key}`}
          className={"segBtn" + (grain === o.key ? " active" : "")}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}
