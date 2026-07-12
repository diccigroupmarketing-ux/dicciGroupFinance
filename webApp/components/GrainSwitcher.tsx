import Link from "next/link";
import type { Grain } from "@/lib/format";

const OPTIONS: { key: Grain; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

// Penukar grain chart (pautan server-side, kekal boleh bookmark/share).
// pending optional, dikekalkan dalam href supaya tukar grain tak reset ambang aging.
export default function GrainSwitcher(
  { grain, basePath, pending }: { grain: Grain; basePath: string; pending?: number },
) {
  const hrefFor = (key: Grain) => {
    const params = new URLSearchParams();
    if (key !== "weekly") params.set("grain", key);
    if (pending != null) params.set("pending", String(pending));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <div className="segRow" role="group" aria-label="Chart period grain">
      {OPTIONS.map((o) => (
        <Link key={o.key}
          href={hrefFor(o.key)}
          className={"segBtn" + (grain === o.key ? " active" : "")}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}
