import { cn } from "@/lib/utils";

export const RIGHT_PANEL_SURFACE_CLASS =
  "border-[color-mix(in_oklab,var(--border-default)_55%,transparent)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,var(--bg-elevated))]";

export function rightPanelSurfaceClassName(className?: string) {
  return cn(RIGHT_PANEL_SURFACE_CLASS, className);
}
