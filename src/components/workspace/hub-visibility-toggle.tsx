"use client";

import { useState } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { Maximize2, Minimize2, PanelLeftClose, LayoutPanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";

export function HubVisibilityToggle() {
  const { hubVisibility, setHubVisibility } = useWorkspaceStore();
  const [locked, setLocked] = useState(false);

  const collapsed = (
    <div className="flex h-10 w-10 items-center justify-center rounded-[20px] border border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/95 backdrop-blur-xl shadow-[0_8px_22px_-16px_rgba(8,22,40,0.14)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors">
      <LayoutPanelLeft className="h-4 w-4" />
    </div>
  );

  return (
    <HubSurface
      id="workspace-hub-visibility"
      edge="right"
      locked={locked}
      onToggleLock={() => setLocked((l) => !l)}
      collapsed={collapsed}
      className="top-[calc(25vh+60px)] translate-y-0 right-6"
    >
      <div className="flex flex-col gap-2 p-2 pt-2 pb-2 pl-3 pr-10">
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[var(--text-tertiary)] pl-1">Sidebars</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setHubVisibility("hidden")}
            className={cn(
              "flex items-center gap-2 px-2.5 h-8 rounded-xl transition-all duration-200",
              hubVisibility === "hidden" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
            title="Hide Hubs"
          >
            <PanelLeftClose className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Hide</span>
          </button>
          <button
            type="button"
            onClick={() => setHubVisibility("collapsed")}
            className={cn(
              "flex items-center gap-2 px-2.5 h-8 rounded-xl transition-all duration-200",
              hubVisibility === "collapsed" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
            title="Collapse Hubs"
          >
            <Minimize2 className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Collapse</span>
          </button>
          <button
            type="button"
            onClick={() => setHubVisibility("expanded")}
            className={cn(
              "flex items-center gap-2 px-2.5 h-8 rounded-xl transition-all duration-200",
              hubVisibility === "expanded" ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
            title="Expand Hubs"
          >
            <Maximize2 className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Expand</span>
          </button>
        </div>
      </div>
    </HubSurface>
  );
}
