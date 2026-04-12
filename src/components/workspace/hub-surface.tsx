"use client";

import { useMemo, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HubEdge } from "@/lib/workspace/contracts";

type HubSurfaceProps = {
  id: string;
  edge: HubEdge;
  collapsed: React.ReactNode;
  children: React.ReactNode;
  locked?: boolean;
  pinned?: boolean;
  hidden?: boolean;
  className?: string;
  collapsedClassName?: string;
  expandedClassName?: string;
  onToggleLock?: () => void;
  onTogglePin?: () => void;
};

function edgeClasses(edge: HubEdge) {
  switch (edge) {
    case "left":
      return {
        wrapper: "fixed left-5 top-1/2 -translate-y-1/2",
        expanded: "origin-left",
      };
    case "right":
      return {
        wrapper: "fixed right-5 top-1/2 -translate-y-1/2",
        expanded: "origin-right",
      };
    case "top":
      return {
        wrapper: "fixed top-5 left-1/2 -translate-x-1/2",
        expanded: "origin-top",
      };
    case "bottom":
    default:
      return {
        wrapper: "fixed bottom-6 left-1/2 -translate-x-1/2",
        expanded: "origin-bottom",
      };
  }
}

export function HubSurface({
  id,
  edge,
  collapsed,
  children,
  locked = false,
  pinned = false,
  hidden = false,
  className,
  collapsedClassName,
  expandedClassName,
  onToggleLock,
  onTogglePin,
}: HubSurfaceProps) {
  const [hovered, setHovered] = useState(false);
  const expanded = locked || hovered;
  const classes = useMemo(() => edgeClasses(edge), [edge]);

  if (hidden) return null;

  return (
    <div
      data-hub-surface-id={id}
      className={cn("z-50", classes.wrapper, className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative">
        <div className={cn("transition-all duration-200", expanded ? "pointer-events-none opacity-0 scale-95" : "opacity-100 scale-100", collapsedClassName)}>
          {collapsed}
        </div>

        <div
          className={cn(
            "absolute transition-all duration-200 ease-[var(--ease-standard)]",
            classes.expanded,
            expanded ? "pointer-events-auto opacity-100 scale-100" : "pointer-events-none opacity-0 scale-95",
            expandedClassName,
          )}
        >
          <div className="relative overflow-hidden rounded-[22px] border border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/96 backdrop-blur-xl shadow-[0_18px_44px_-18px_rgba(8,22,40,0.28)]">
            {(onToggleLock || onTogglePin) && (
              <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
                {onTogglePin ? (
                  <button
                    type="button"
                    onClick={onTogglePin}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-secondary)]/80 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
                {onToggleLock ? (
                  <button
                    type="button"
                    onClick={onToggleLock}
                    className={cn(
                      "flex h-7 items-center rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
                      locked
                        ? "bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--accent-cyan)]"
                        : "bg-[var(--bg-secondary)]/80 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    {locked ? "Locked" : "Lock"}
                  </button>
                ) : null}
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
