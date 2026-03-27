"use client";

import { useState } from "react";
import {
  Eye,
  EyeOff,
  GitBranch,
  Home,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

type WorkspaceToolbarProps = {
  onCenterHub: () => void;
  onNewWorkstream: () => void;
  workstreamCount: number;
};

export function WorkspaceToolbar({
  onCenterHub,
  onNewWorkstream,
  workstreamCount,
}: WorkspaceToolbarProps) {
  const {
    showArchived,
    setShowArchived,
    showConnections,
    setShowConnections,
  } = useWorkspaceStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 h-12",
        "border-b border-[var(--border-default)]",
        "bg-[var(--bg-elevated)]/80 backdrop-blur-md",
        "relative z-10",
      )}
    >
      {/* Left: search */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {searchOpen ? (
          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <Search className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workstreams..."
              autoFocus
              onBlur={() => {
                if (!searchQuery) setSearchOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  setSearchOpen(false);
                }
              }}
              className={cn(
                "flex-1 bg-transparent border-none outline-none",
                "text-sm text-[var(--text-primary)]",
                "placeholder:text-[var(--text-tertiary)]",
              )}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg",
              "text-xs text-[var(--text-secondary)]",
              "hover:bg-[var(--bg-hover)] transition-colors duration-[var(--motion-fast)]",
            )}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
          </button>
        )}
      </div>

      {/* Center: workspace title */}
      <div className="flex items-center gap-2">
        <span className="font-display text-sm font-semibold text-[var(--text-primary)] tracking-tight">
          Workspace
        </span>
        {workstreamCount > 0 && (
          <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
            {workstreamCount}
          </span>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 flex-1 justify-end">
        <ToolbarBtn
          icon={<Home className="w-3.5 h-3.5" />}
          label="Hub"
          onClick={onCenterHub}
        />
        <ToolbarBtn
          icon={
            showConnections ? (
              <GitBranch className="w-3.5 h-3.5" />
            ) : (
              <GitBranch className="w-3.5 h-3.5 opacity-40" />
            )
          }
          label="Lines"
          onClick={() => setShowConnections(!showConnections)}
          active={showConnections}
        />
        <ToolbarBtn
          icon={
            showArchived ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )
          }
          label="Completed"
          onClick={() => setShowArchived(!showArchived)}
          active={showArchived}
        />

        <div className="w-px h-5 bg-[var(--border-default)] mx-1" />

        <button
          type="button"
          onClick={onNewWorkstream}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
            "text-xs font-semibold",
            "bg-[var(--accent-cyan)] text-white",
            "hover:brightness-110 active:brightness-95",
            "transition-all duration-[var(--motion-fast)]",
            "shadow-[0_2px_8px_-2px_rgba(14,142,232,0.3)]",
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New</span>
        </button>
      </div>
    </div>
  );
}

function ToolbarBtn({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex items-center gap-1 px-2 py-1.5 rounded-lg",
        "text-xs transition-colors duration-[var(--motion-fast)]",
        active
          ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/8"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
      )}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
