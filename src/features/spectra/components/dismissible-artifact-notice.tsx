"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Dismisses presentation only; the caller retains the error and recovery state. */
export function DismissibleArtifactNotice({
  artifactId,
  identity,
  children,
  className,
  role = "status",
}: {
  artifactId: string;
  identity: unknown;
  children: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const [dismissed, setDismissed] = useState<{
    artifactId: string;
    identity: unknown;
  } | null>(null);

  if (dismissed?.artifactId === artifactId && dismissed.identity === identity)
    return null;

  return (
    <div role={role} className={`flex items-start gap-2 ${className ?? ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2">{children}</div>
      <button
        type="button"
        className="grid size-7 shrink-0 place-items-center rounded-chip text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label="Dismiss sync notice"
        title="Dismiss this notice without changing your sync status"
        onClick={() => setDismissed({ artifactId, identity })}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
