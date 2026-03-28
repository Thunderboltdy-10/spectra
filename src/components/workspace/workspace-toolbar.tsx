"use client";

import { useState } from "react";
import {
  Eye,
  EyeOff,
  GitBranch,
  Grid3X3,
  Home,
  LayoutGrid,
  Columns3,
  Network,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

type WorkspaceToolbarProps = {
  onCenterHub: () => void;
  onNewWorkstream: () => void;
  workstreamCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  userName?: string;
};

export function WorkspaceToolbar({
  onCenterHub,
  onNewWorkstream,
  workstreamCount,
  searchQuery,
  onSearchChange,
  userName,
}: WorkspaceToolbarProps) {
  const {
    showArchived,
    setShowArchived,
    showConnections,
    setShowConnections,
    backgroundMode,
    setBackgroundMode,
    committedWorkstreamId,
    viewMode,
    setViewMode,
  } = useWorkspaceStore();
  const [searchOpen, setSearchOpen] = useState(false);

  const isInsideWorkstream = !!committedWorkstreamId;

  const backgroundLabel =
    backgroundMode === "dots"
      ? "Dots"
      : backgroundMode === "grid"
        ? "Grid"
        : "Blank";

  function cycleBackground() {
    setBackgroundMode(
      backgroundMode === "dots"
        ? "grid"
        : backgroundMode === "grid"
          ? "blank"
          : "dots",
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 h-12",
        "shadow-[0_1px_0_var(--border-default)]",
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
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search workstreams..."
              autoFocus
              onBlur={() => {
                if (!searchQuery) setSearchOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onSearchChange("");
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
              "hover:bg-[var(--bg-hover)] transition-colors duration-150",
            )}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
          </button>
        )}
      </div>

      {/* Center: workspace title with user name */}
      <div className="flex items-center gap-2">
        <span className="font-display text-sm font-semibold text-[var(--text-primary)] tracking-tight">
          {userName ? `${userName.split(" ")[0]}'s Workspace` : "Workspace"}
        </span>
        {workstreamCount > 0 && !isInsideWorkstream && (
          <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
            {workstreamCount}
          </span>
        )}
      </div>

      {/* Right: actions + view toggle when inside workstream */}
      <div className="flex items-center gap-1 flex-1 justify-end">
        {/* View toggle — only when inside a committed workstream */}
        {isInsideWorkstream && (
          <>
            <ViewToggleBtn
              icon={<LayoutGrid className="w-3.5 h-3.5" />}
              label="Structured"
              active={viewMode === "structured"}
              onClick={() => setViewMode("structured")}
            />
            <ViewToggleBtn
              icon={<Columns3 className="w-3.5 h-3.5" />}
              label="Columns"
              active={viewMode === "columns"}
              onClick={() => setViewMode("columns")}
            />
            <ViewToggleBtn
              icon={<Network className="w-3.5 h-3.5" />}
              label="Graph"
              active={viewMode === "graph"}
              onClick={() => setViewMode("graph")}
            />
            <div className="w-px h-5 bg-[var(--border-default)] mx-1" />
          </>
        )}

        <ToolbarBtn
          icon={<Home className="w-3.5 h-3.5" />}
          label="Hub"
          onClick={onCenterHub}
        />

        {!isInsideWorkstream && (
          <>
            <ToolbarBtn
              icon={<GitBranch className={cn("w-3.5 h-3.5", !showConnections && "opacity-40")} />}
              label="Lines"
              onClick={() => setShowConnections(!showConnections)}
              active={showConnections}
            />
            <ToolbarBtn
              icon={showArchived ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              label="Completed"
              onClick={() => setShowArchived(!showArchived)}
              active={showArchived}
            />
          </>
        )}

        <ToolbarBtn
          icon={<Grid3X3 className="w-3.5 h-3.5" />}
          label={backgroundLabel}
          onClick={cycleBackground}
          active={backgroundMode !== "blank"}
        />

        {!isInsideWorkstream && (
          <>
            <div className="w-px h-5 bg-[var(--border-default)] mx-1" />
            <button
              type="button"
              onClick={onNewWorkstream}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
                "text-xs font-semibold",
                "bg-[var(--accent-cyan)] text-white",
                "hover:brightness-110 active:brightness-95",
                "transition-all duration-150",
                "shadow-[0_2px_8px_-2px_rgba(14,142,232,0.3)]",
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New</span>
            </button>
          </>
        )}
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
        "text-xs transition-colors duration-150",
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

function ViewToggleBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md",
        "text-[11px] transition-colors duration-150",
        active
          ? "text-[var(--text-primary)] bg-[var(--bg-hover)] font-medium"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]/50",
      )}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
