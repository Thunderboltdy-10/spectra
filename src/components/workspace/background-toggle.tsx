"use client";

import { useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Grid3X3, Circle, Minus, Paintbrush } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";

export function BackgroundToggle() {
  const { backgroundMode, setBackgroundMode } = useWorkspaceStore();
  const [locked, setLocked] = useState(false);

  const collapsed = (
    <div className="flex h-10 w-10 items-center justify-center rounded-[20px] border border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/95 backdrop-blur-xl shadow-[0_8px_22px_-16px_rgba(8,22,40,0.14)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
      <Paintbrush className="h-4 w-4" />
    </div>
  );

  return (
    <HubSurface
      id="workspace-background"
      edge="right"
      locked={locked}
      onToggleLock={() => setLocked((l) => !l)}
      collapsed={collapsed}
      className="top-[25vh] translate-y-0 right-6"
    >
      <div className="flex flex-col gap-2 p-2 pt-2 pb-2 pl-3 pr-10">
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[var(--text-tertiary)] pl-1">Background</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setBackgroundMode("blank")}
            className={cn(
              "flex items-center gap-2 px-2.5 h-8 rounded-xl transition-all duration-200",
              backgroundMode === "blank" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
            title="Blank Background"
          >
            <Minus className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Blank</span>
          </button>
          <button
            type="button"
            onClick={() => setBackgroundMode("dots")}
            className={cn(
              "flex items-center gap-2 px-2.5 h-8 rounded-xl transition-all duration-200",
              backgroundMode === "dots" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
            title="Dots Background"
          >
            <Circle className="h-2 w-2 shrink-0" strokeWidth={4} />
            <span className="text-xs font-medium">Dots</span>
          </button>
          <button
            type="button"
            onClick={() => setBackgroundMode("grid")}
            className={cn(
              "flex items-center gap-2 px-2.5 h-8 rounded-xl transition-all duration-200",
              backgroundMode === "grid" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
            title="Grid Background"
          >
            <Grid3X3 className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Grid</span>
          </button>
        </div>
      </div>
    </HubSurface>
  );
}
