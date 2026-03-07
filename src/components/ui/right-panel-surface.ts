import { cn } from "@/lib/utils";

export const RIGHT_PANEL_SURFACE_CLASS =
  "w-full xl:w-[360px] xl:min-w-[340px] xl:max-w-[420px] overflow-x-hidden border-[color-mix(in_oklab,var(--border-default)_55%,transparent)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,var(--bg-elevated))]";

export function rightPanelSurfaceClassName(className?: string) {
  return cn(RIGHT_PANEL_SURFACE_CLASS, className);
}
