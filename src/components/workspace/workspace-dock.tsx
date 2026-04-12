"use client";

import { useState, useCallback } from "react";
import { Plus, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";

export type WorkspaceDockItem = {
  id: string;
  name: string;
  emoji: string;
  isActive: boolean;
  unreadCount?: number;
};

type WorkspaceDockProps = {
  workspaces: WorkspaceDockItem[];
  onSelect: (id: string) => void;
  onCreateNew: () => void;
  onGoHome?: () => void;
  className?: string;
};

export function WorkspaceDock({ workspaces, onSelect, onCreateNew, onGoHome, className }: WorkspaceDockProps) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleSelect = useCallback((id: string) => {
    onSelect(id);
  }, [onSelect]);

  const collapsed = (
    <div className={cn("flex w-[54px] flex-col gap-0.5 rounded-[18px] border p-1.5 border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl shadow-[0_10px_28px_-20px_rgba(8,22,40,0.14)]", className)}>
      <button type="button" onClick={onGoHome} className="mb-0.5 flex h-10 items-center justify-center rounded-[14px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="All workspaces">
        <Home className="h-4.5 w-4.5 shrink-0" />
      </button>
      <div className="mx-2 h-px bg-[var(--border-default)]/30" />
      {workspaces.map((workspace) => (
        <button key={workspace.id} type="button" onClick={() => handleSelect(workspace.id)} className={cn("group relative flex h-10 items-center justify-center rounded-[14px] transition-all duration-150", workspace.isActive ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]")}> 
          {workspace.isActive ? <div className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-x-[2px] -translate-y-1/2 rounded-full bg-[var(--accent-cyan)]" /> : null}
          <span className="text-lg leading-none">{workspace.emoji}</span>
        </button>
      ))}
      <div className="mx-2 my-0.5 h-px bg-[var(--border-default)]/30" />
      <button type="button" onClick={onCreateNew} className="flex h-10 items-center justify-center rounded-[14px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
        <Plus className="h-4.5 w-4.5 shrink-0" />
      </button>
    </div>
  );

  return (
    <HubSurface
      id="workspace-dock"
      edge="left"
      collapsed={collapsed}
      expandedClassName="left-0 top-1/2 -translate-y-1/2"
    >
      <div
        className={cn(
          "flex min-w-[200px] flex-col gap-0.5 rounded-[18px] border p-1.5",
          "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
          "shadow-[0_18px_40px_-24px_rgba(8,22,40,0.22)]",
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => { setExpanded(false); setHoveredId(null); }}
      >
        <button type="button" onClick={onGoHome} className="mb-0.5 flex h-10 items-center gap-2 rounded-[14px] px-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="All workspaces">
          <Home className="h-4 w-4 shrink-0" />
          <span className="text-[12px] font-medium whitespace-nowrap">Home</span>
        </button>
        <div className="mx-2 h-px bg-[var(--border-default)]/30" />
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => handleSelect(workspace.id)}
            onMouseEnter={() => setHoveredId(workspace.id)}
            onMouseLeave={() => setHoveredId(null)}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-[14px] px-2.5 py-1.5 text-left transition-all duration-150",
              workspace.isActive
                ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            {workspace.isActive ? <div className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-x-[2px] -translate-y-1/2 rounded-full bg-[var(--accent-cyan)]" /> : null}
            <span className={cn("shrink-0 leading-none transition-transform duration-150", hoveredId === workspace.id ? "scale-[1.15] text-lg" : "text-base")}>{workspace.emoji}</span>
            <span className={cn("truncate whitespace-nowrap text-[12px] font-medium", expanded ? "opacity-100" : "opacity-100")}>{workspace.name}</span>
            {workspace.unreadCount && workspace.unreadCount > 0 ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent-coral)] px-1 text-[9px] font-bold text-white">{workspace.unreadCount > 9 ? "9+" : workspace.unreadCount}</span> : null}
          </button>
        ))}
        <div className="mx-2 my-0.5 h-px bg-[var(--border-default)]/30" />
        <button type="button" onClick={onCreateNew} className="flex items-center gap-2.5 rounded-[14px] px-2.5 py-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
          <Plus className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap text-[11px] font-medium">New workspace</span>
        </button>
      </div>
    </HubSurface>
  );
}
