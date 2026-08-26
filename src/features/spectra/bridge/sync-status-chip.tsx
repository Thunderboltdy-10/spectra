"use client";

import { cn } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/ui/badge";
import type { SyncPresentation } from "./status";

function toneFor(presentation: SyncPresentation): StatusTone {
  if (presentation.tone === "positive") return "healthy";
  if (presentation.tone === "warning") return "attention";
  if (presentation.tone === "danger") return "failure";
  return "neutral";
}

/**
 * The in-place sync chip (CANON R16). Quiet healthy states render nothing;
 * conflict, offline, error, and in-flight work sit on the thing itself.
 */
export function SyncStatusChip({
  presentation,
  className,
  always = false,
}: {
  presentation: SyncPresentation;
  className?: string;
  always?: boolean;
}) {
  if (!always && presentation.ready) return null;
  return (
    <StatusBadge tone={toneFor(presentation)} className={cn("max-w-[11rem]", className)}>
      {presentation.label}
    </StatusBadge>
  );
}
