"use client";

import { useWorkspaceStore } from "@/stores/workspace-store";
import { useState } from "react";
import { Layers, Tag, Clock, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";
import type { ViewMode } from "@/lib/workspace/contracts";

const LENS_OPTIONS: { mode: ViewMode; label: string; icon: typeof Layers; description: string }[] = [
  { mode: "byType", label: "By Type", icon: Layers, description: "Group items by their type" },
  { mode: "byTopic", label: "By Topic", icon: Tag, description: "Group items by topic/workspace" },
  { mode: "timeline", label: "Timeline", icon: Clock, description: "Sort by recency" },
];

/**
 * Canvas lens hub item u2014 same-canvas organizational lens switcher.
 * Sits at the top center. Changes how items are organized on the canvas.
 */
export function LensHub({ className }: { className?: string }) {
  const { viewMode, setViewMode } = useWorkspaceStore();
  const [locked, setLocked] = useState(false);

  const currentLens = LENS_OPTIONS.find((l) => l.mode === viewMode) ?? LENS_OPTIONS[0];

  const collapsed = (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-[14px] border px-3",
        "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "shadow-[0_8px_22px_-16px_rgba(8,22,40,0.14)] text-[var(--text-secondary)]",
        "hover:bg-[var(--bg-hover)] cursor-pointer transition-all duration-200",
        className,
      )}
    >
      <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
      <span className="text-[11px] font-semibold">{currentLens.label}</span>
    </div>
  );

  return (
    <HubSurface
      id="lens-hub"
      edge="top"
      locked={locked}
      onToggleLock={() => setLocked((l) => !l)}
      collapsed={collapsed}
      className="!top-5 !left-1/2 !-translate-x-1/2 !translate-y-0"
      expandedClassName="top-0 left-1/2 -translate-x-1/2"
    >
      <div className="flex flex-col gap-1 p-2 min-w-[200px]">
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[var(--text-tertiary)] px-2 pt-1 pb-0.5 flex items-center gap-1.5">
          <Eye className="h-3 w-3" />
          Canvas Lens
        </span>
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
                  "h-4 w-4 shrink-0",
                  isActive ? "text-[var(--accent-cyan)]" : "text-[var(--text-tertiary)]",
                )}
              />
              <div className="min-w-0 flex-1">
                <span className="text-[12px] font-medium block">{option.label}</span>
                <span className="text-[10px] text-[var(--text-tertiary)] block">{option.description}</span>
              </div>
              {isActive && (
                <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)] shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </HubSurface>
  );
}
