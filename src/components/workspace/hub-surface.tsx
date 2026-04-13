"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Lock, Unlock } from "lucide-react";
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
  forceExpanded?: boolean;
  /** When true, outside-click closes this surface even when locked (for drawers/menus) */
  dismissOnOutsideClick?: boolean;
  className?: string;
  collapsedClassName?: string;
  expandedClassName?: string;
  onToggleLock?: () => void;
  onTogglePin?: () => void;
};

/** Debounce delay before expanding on hover (ms) — less aggressive */
const HOVER_ENTER_DELAY = 260;
/** Debounce delay before collapsing after mouse leaves (ms) */
const HOVER_LEAVE_DELAY = 340;

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
  forceExpanded = false,
  dismissOnOutsideClick = false,
  className,
  collapsedClassName,
  expandedClassName,
  onToggleLock,
  onTogglePin,
}: HubSurfaceProps) {
  const [hovered, setHovered] = useState(false);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = forceExpanded || locked || hovered;

  /**
   * Outside-click semantics:
   * - Locked/open surfaces stay fixed — do NOT close on outside press.
   * - Only surfaces with `dismissOnOutsideClick` close on outside press.
   * This prevents accidental closure of locked hub items while allowing
   * menus/drawers to dismiss naturally.
   */
  useEffect(() => {
    if (!expanded) return;
    // Only dismiss on outside click for surfaces that explicitly opt in
    if (!dismissOnOutsideClick) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const surface = document.querySelector(`[data-hub-surface-id="${id}"]`);
      if (surface && !surface.contains(target)) {
        if (locked && onToggleLock) {
          onToggleLock();
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => document.removeEventListener("mousedown", handleClickOutside, true);
  }, [expanded, locked, onToggleLock, id, dismissOnOutsideClick]);

  const classes = useMemo(() => edgeClasses(edge), [edge]);

  const handleMouseEnter = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (!hovered && !locked) {
      enterTimerRef.current = setTimeout(() => {
        setHovered(true);
      }, HOVER_ENTER_DELAY);
    } else {
      setHovered(true);
    }
  }, [hovered, locked]);

  const handleMouseLeave = useCallback(() => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    leaveTimerRef.current = setTimeout(() => {
      setHovered(false);
    }, HOVER_LEAVE_DELAY);
  }, []);

  if (hidden) return null;

  return (
    <div
      data-hub-surface-id={id}
      className={cn("z-50", classes.wrapper, className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="relative">
        {/* Collapsed state */}
        <div
          className={cn(
            "transition-all duration-250 ease-[var(--ease-standard)]",
            expanded
              ? "pointer-events-none opacity-0 scale-95"
              : "opacity-100 scale-100",
            collapsedClassName,
          )}
        >
          {collapsed}
        </div>

        {/* Expanded state */}
        <div
          className={cn(
            "absolute transition-all duration-250 ease-[var(--ease-standard)]",
            classes.expanded,
            expanded
              ? "pointer-events-auto opacity-100 scale-100"
              : "pointer-events-none opacity-0 scale-[0.97]",
            expandedClassName,
          )}
        >
          <div className="group/hub relative overflow-hidden rounded-[28px] border border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/96 backdrop-blur-xl shadow-[0_18px_44px_-18px_rgba(8,22,40,0.28)]">
            {/* Single lock control — only shows on hover, no close/pin clutter */}
            {(onToggleLock || onTogglePin) && (
              <div className="absolute right-2.5 top-2.5 z-[60] flex items-center gap-1 opacity-0 group-hover/hub:opacity-100 transition-opacity duration-200">
                {onTogglePin && (
                  <button
                    type="button"
                    onClick={onTogglePin}
                    className={cn(
                      "flex h-7 min-w-[36px] items-center justify-center rounded-lg transition-colors px-2 text-[10px] font-semibold",
                      pinned
                        ? "text-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]/20"
                        : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                    )}
                    title={pinned ? "Unpin" : "Pin"}
                  >
                    {pinned ? "Pin" : "Hub"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onToggleLock}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                    locked
                      ? "text-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]/20 !opacity-100"
                      : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  )}
                  title={locked ? "Unlock" : "Lock open"}
                >
                  {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
