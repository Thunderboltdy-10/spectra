"use client";

import { useEffect, useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  Grid3X3,
  Circle,
  Minus,
  Paintbrush,
  Settings2,
  Layers,
  Tag,
  Clock,
  Eye,
  PanelLeftClose,
  LayoutPanelLeft,
  Maximize2,
  Minimize2,
  Lock,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/workspace/contracts";

const LENS_OPTIONS: { mode: ViewMode; label: string; icon: typeof Layers }[] = [
  { mode: "byType", label: "By Type", icon: Layers },
  { mode: "byTopic", label: "By Topic", icon: Tag },
  { mode: "timeline", label: "Timeline", icon: Clock },
];

/**
 * Unified top-right utility hub group.
 * Contains BOTH canvas lens (byType/byTopic/timeline) AND background/hub controls.
 * Expands leftward from the right edge.
 */
export function UtilityHubGroup() {
  const { backgroundMode, setBackgroundMode, hubVisibility, setHubVisibility, viewMode, setViewMode } =
    useWorkspaceStore();
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);

  const currentLens = LENS_OPTIONS.find((l) => l.mode === viewMode) ?? LENS_OPTIONS[0];
  const CurrentIcon = currentLens.icon;

  const collapsed = (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      className="flex h-11 items-center gap-2.5 rounded-[16px] border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl shadow-[0_8px_22px_-16px_rgba(8,22,40,0.14)] px-3.5 hover:bg-[var(--bg-hover)] cursor-pointer transition-all duration-200"
    >
      <CurrentIcon className="h-4 w-4 shrink-0 text-[var(--accent-cyan)]/70" />
      <span className="text-[11px] font-semibold text-[var(--text-secondary)]">{currentLens.label}</span>
      <div className="h-3.5 w-px bg-[var(--border-default)]/30" />
      <Settings2 className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
    </button>
  );

  useEffect(() => {
    if (!(open || locked)) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-workspace-utility-group]")) return;
      if (!locked) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => document.removeEventListener("mousedown", handlePointerDown, true);
  }, [open, locked]);

  return (
    <div data-workspace-utility-group className="fixed right-5 top-5 z-[65]">
      {collapsed}
      {(open || locked) && (
        <div className="absolute right-0 top-[calc(100%+8px)] min-w-[240px] overflow-hidden rounded-[28px] border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/96 shadow-[0_18px_44px_-18px_rgba(8,22,40,0.28)] backdrop-blur-xl">
          <div className="relative flex flex-col gap-3 px-4 py-3.5">
        <div className="absolute right-2.5 top-2.5 z-[60] flex items-center gap-1 opacity-0 transition-opacity duration-200 hover:opacity-100">
          <button
            type="button"
            onClick={() => setLocked((value) => !value)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
              locked
                ? "text-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]/20"
                : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
            title={locked ? "Unlock" : "Lock open"}
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </button>
        </div>
        {/* Canvas Lens section */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[var(--text-tertiary)] flex items-center gap-1.5">
            <Eye className="h-3 w-3" />
            Canvas View
          </span>
          <div className="flex flex-col gap-0.5">
            {LENS_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = viewMode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => setViewMode(option.mode)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-150 w-full",
                    isActive
                      ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isActive ? "text-[var(--accent-cyan)]" : "text-[var(--text-tertiary)]",
                    )}
                  />
                  <span className="text-[12px] font-medium flex-1">{option.label}</span>
                  {isActive && (
                    <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)] shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-[var(--border-default)]/20" />

        {/* Background section */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[var(--text-tertiary)] flex items-center gap-1.5">
            <Paintbrush className="h-3 w-3" />
            Background
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setBackgroundMode("blank")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-8 rounded-xl transition-all duration-200 text-xs font-medium",
                backgroundMode === "blank"
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <Minus className="h-3.5 w-3.5 shrink-0" />
              Blank
            </button>
            <button
              type="button"
              onClick={() => setBackgroundMode("dots")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-8 rounded-xl transition-all duration-200 text-xs font-medium",
                backgroundMode === "dots"
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <Circle className="h-2 w-2 shrink-0" strokeWidth={4} />
              Dots
            </button>
            <button
              type="button"
              onClick={() => setBackgroundMode("grid")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-8 rounded-xl transition-all duration-200 text-xs font-medium",
                backgroundMode === "grid"
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <Grid3X3 className="h-3.5 w-3.5 shrink-0" />
              Grid
            </button>
          </div>
        </div>

        <div className="h-px bg-[var(--border-default)]/20" />

        {/* Hub visibility section */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[var(--text-tertiary)] flex items-center gap-1.5">
            <LayoutPanelLeft className="h-3 w-3" />
            Sidebars
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setHubVisibility("hidden")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-8 rounded-xl transition-all duration-200 text-xs font-medium",
                hubVisibility === "hidden"
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <PanelLeftClose className="h-3.5 w-3.5 shrink-0" />
              Hide
            </button>
            <button
              type="button"
              onClick={() => setHubVisibility("collapsed")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-8 rounded-xl transition-all duration-200 text-xs font-medium",
                hubVisibility === "collapsed"
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <Minimize2 className="h-3.5 w-3.5 shrink-0" />
              Collapse
            </button>
            <button
              type="button"
              onClick={() => setHubVisibility("expanded")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-8 rounded-xl transition-all duration-200 text-xs font-medium",
                hubVisibility === "expanded"
                  ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <Maximize2 className="h-3.5 w-3.5 shrink-0" />
              Expand
            </button>
          </div>
        </div>
          </div>
        </div>
      )}
    </div>
  );
}
