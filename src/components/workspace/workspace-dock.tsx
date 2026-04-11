"use client";

import { useState, useCallback } from "react";
import { Plus, Home } from "lucide-react";
import { cn } from "@/lib/utils";

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

  return (
    <div
      className={cn("fixed left-5 top-1/2 z-50 -translate-y-1/2", className)}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => { setExpanded(false); setHoveredId(null); }}
    >
      <div
        className={cn(
          "flex flex-col gap-0.5 rounded-[20px] border p-1.5",
          "border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
          "transition-all duration-200 ease-[var(--ease-standard)]",
          expanded ? "min-w-[200px]" : "w-[52px]",
        )}
        style={{
          boxShadow: expanded
            ? "0 18px 40px -24px rgba(8,22,40,0.22)"
            : "0 10px 28px -20px rgba(8,22,40,0.14)",
        }}
      >
        {/* Home / all workspaces button */}
        <button
          type="button"
          onClick={onGoHome}
          className="mb-0.5 flex h-9 items-center gap-2 rounded-2xl px-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          aria-label="All workspaces"
        >
          <Home className="h-4 w-4 shrink-0" />
          <span className={cn(
            "text-[12px] font-medium whitespace-nowrap transition-all duration-200",
            expanded ? "max-w-[120px] opacity-100" : "max-w-0 overflow-hidden opacity-0",
          )}>
            Home
          </span>
        </button>

        <div className="mx-2 h-px bg-[var(--border-default)]/30" />

        {/* Workspace list */}
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => handleSelect(workspace.id)}
            onMouseEnter={() => setHoveredId(workspace.id)}
            onMouseLeave={() => setHoveredId(null)}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-2xl px-2.5 py-1.5 text-left transition-all duration-150",
              workspace.isActive
                ? "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            {/* Active indicator bar */}
            {workspace.isActive && (
              <div className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-x-[2px] -translate-y-1/2 rounded-full bg-[var(--accent-cyan)]" />
            )}

            {/* Emoji with dock-magnification on hover */}
            <span
              className={cn(
                "shrink-0 leading-none transition-transform duration-150",
                hoveredId === workspace.id ? "scale-[1.15] text-lg" : "text-base",
              )}
            >
              {workspace.emoji}
            </span>

            {/* Name (only visible when expanded) */}
            <span className={cn(
              "truncate whitespace-nowrap text-[12px] font-medium transition-all duration-200 ease-[var(--ease-standard)]",
              expanded ? "max-w-[130px] opacity-100" : "max-w-0 overflow-hidden opacity-0",
            )}>
              {workspace.name}
            </span>

            {/* Unread badge */}
            {workspace.unreadCount && workspace.unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--accent-coral)] px-1 text-[9px] font-bold text-white">
                {workspace.unreadCount > 9 ? "9+" : workspace.unreadCount}
              </span>
            ) : null}
          </button>
        ))}

        <div className="mx-2 my-0.5 h-px bg-[var(--border-default)]/30" />

        {/* Create new workspace */}
        <button
          type="button"
          onClick={onCreateNew}
          className="flex items-center gap-2.5 rounded-2xl px-2.5 py-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className={cn(
            "whitespace-nowrap text-[11px] font-medium transition-all duration-200",
            expanded ? "max-w-[140px] opacity-100" : "max-w-0 overflow-hidden opacity-0",
          )}>
            New workspace
          </span>
        </button>
      </div>
    </div>
  );
}
