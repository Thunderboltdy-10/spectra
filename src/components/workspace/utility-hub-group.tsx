"use client";

import { useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  Grid3X3,
  Circle,
  Minus,
  Paintbrush,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  LayoutPanelLeft,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";

/**
 * Unified top-right utility hub group.
 * Sits high on the right edge and expands leftward.
 * Contains background mode + hub visibility controls in one coherent surface.
 */
export function UtilityHubGroup() {
  const { backgroundMode, setBackgroundMode, hubVisibility, setHubVisibility } =
    useWorkspaceStore();
  const [locked, setLocked] = useState(false);

  const collapsed = (
    <div className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl shadow-[0_8px_22px_-16px_rgba(8,22,40,0.14)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
      <Settings2 className="h-4.5 w-4.5" />
    </div>
  );

  return (
    <HubSurface
      id="workspace-utility-group"
      edge="right"
      locked={locked}
      onToggleLock={() => setLocked((l) => !l)}
      collapsed={collapsed}
      className="!top-5 !-translate-y-0 right-5"
      expandedClassName="right-0 top-0"
    >
      <div className="flex flex-col gap-3 px-4 py-3.5 min-w-[220px]">
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
    </HubSurface>
  );
}
