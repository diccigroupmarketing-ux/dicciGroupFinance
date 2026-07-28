"use client";

// Sel "Resolve" untuk jadual sedia ada (Integrity exceptions, Not collected,
// Ghost money). Satu kes = 3 klik: klik Resolve, sebab dah pra-pilih ikut
// kategori, klik Send for approval.
//
// Baris yang SUDAH ada kes hidup TIDAK hilang: ia papar lencana keadaan, dan
// pencadang sendiri boleh tarik balik selagi belum diputuskan.
import { useState } from "react";
import { useRouter } from "next/navigation";
import ResolveModal from "@/components/ResolveModal";
import ResolutionChip from "@/components/ResolutionChip";
import {
  apiErrorEnglish, whyEnglish,
  type DecideReply, type ReasonOptionUI, type ResolveLimits, type ResolveTarget,
} from "@/components/resolveTypes";

export default function ResolveButton({
  target, reasons, limits, compact,
}: {
  target: ResolveTarget;
  reasons: ReasonOptionUI[];
  limits: ResolveLimits;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const badge = target.badge;
  const mine = !!badge
    && (badge.by ?? "").trim().toLowerCase() === limits.actor.trim().toLowerCase();
  const canWithdraw = !!badge && badge.state === "proposed" && mine;

  const withdraw = async () => {
    if (!badge) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/resolutions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutionIds: [badge.resolutionId] }),
      });
      const j: DecideReply = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(apiErrorEnglish(res.status, j.error, "withdraw", limits));
      else if (j.failed?.length) setMsg(whyEnglish(j.failed[0].why));
      else router.refresh();
    } catch {
      setMsg("Network problem. Nothing was changed.");
    }
    setBusy(false);
  };

  if (badge) {
    return (
      <div className="resolveCell">
        <ResolutionChip badge={badge} />
        {canWithdraw && (
          <button className="cardLink" onClick={withdraw} disabled={busy}
            title="Take back the case you proposed">
            {busy ? "…" : "Withdraw"}
          </button>
        )}
        {msg && <div className="resolveCellMsg">{msg}</div>}
      </div>
    );
  }

  return (
    <div className="resolveCell">
      <button className={"resolveBtn" + (compact ? " compact" : "")}
        onClick={() => setOpen(true)}
        title="Record why this row can be closed. It never moves money.">
        Resolve
      </button>
      {open && (
        <ResolveModal targets={[target]} reasons={reasons} limits={limits}
          onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
