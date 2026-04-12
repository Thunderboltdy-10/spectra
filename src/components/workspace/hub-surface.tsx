"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Pin, PinOff, Lock, Unlock } from "lucide-react";
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

/** Debounce delay before expanding on hover (ms) u2014 prevents jitter */
const HOVER_ENTER_DELAY = 180;
/** Debounce delay before collapsing after mouse leaves (ms) */
const HOVER_LEAVE_DELAY = 280;

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
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expanded = locked || hovered;

  // Close on click outside if locked but user wants to close
  useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const surface = document.querySelector(`[data-hub-surface-id="${id}"]`);
      if (surface && !surface.contains(target)) {
        if (locked && onToggleLock) {
          onToggleLock(); // Unlock it to close
        }
      }
    }
    // Bind to the capture phase so it triggers before other things consume the event
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => document.removeEventListener("mousedown", handleClickOutside, true);
  }, [expanded, locked, onToggleLock, id]);

  const classes = useMemo(() => edgeClasses(edge), [edge]);

  const handleMouseEnter = useCallback(() => {
    // Cancel any pending leave
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    // Debounce enter
    if (!hovered && !locked) {
      enterTimerRef.current = setTimeout(() => {
        setHovered(true);
      }, HOVER_ENTER_DELAY);
    } else {
      setHovered(true);
    }
  }, [hovered, locked]);

  const handleMouseLeave = useCallback(() => {
    // Cancel any pending enter
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    // Debounce leave
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
          <div className="relative overflow-hidden rounded-[32px] border border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/96 backdrop-blur-xl shadow-[0_18px_44px_-18px_rgba(8,22,40,0.28)]">
            {/* Lock/Pin controls */}
            {(onToggleLock || onTogglePin) && (
              <div className="absolute right-2 top-2 z-[60] flex items-center gap-1">
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
                      "flex h-7 w-7 items-center justify-center rounded-lg transition-colors shadow-sm border border-[var(--border-default)]/20",
                      locked
                        ? "bg-[var(--bg-elevated)] text-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]/20"
                        : "bg-[var(--bg-elevated)]/80 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                    )}
                    title={locked ? "Unlock" : "Lock"}
                  >
                    {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
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
