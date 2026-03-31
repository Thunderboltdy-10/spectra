"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_WIDTH = 320;
const MAX_WIDTH = 680;

type RightSidePanelProps = {
  width: number;
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  panelType?: string;
};

export function RightSidePanel({
  width: defaultWidth,
  title,
  icon,
  actions,
  onClose,
  children,
  className,
  panelType,
}: RightSidePanelProps) {
  const storageKey = panelType ? `workspace:panel-width:${panelType}` : undefined;

  const [width, setWidth] = useState(() => {
    if (storageKey) {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const parsed = Number(stored);
          if (parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) return parsed;
        }
      } catch { /* ignore */ }
    }
    return defaultWidth;
  });

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      // Dragging left edge means smaller clientX = wider panel
      const delta = startX.current - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, String(width));
        } catch { /* ignore */ }
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [storageKey, width]);

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{
        width: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.2 },
      }}
      className={cn(
        "relative h-full shrink-0 overflow-hidden bg-[color-mix(in_oklab,var(--bg-primary)_94%,var(--bg-elevated))] shadow-[-20px_0_44px_-34px_rgba(15,23,42,0.45)]",
        className,
      )}
    >
      {/* Resize handle — invisible 6px drag strip on left edge */}
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-[var(--accent-cyan)]/10 active:bg-[var(--accent-cyan)]/15 transition-colors"
        onMouseDown={handleMouseDown}
      />

      <div className="flex h-full flex-col" style={{ width }}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-default)]/60 px-4 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? <span className="text-[var(--text-tertiary)]">{icon}</span> : null}
            <span className="truncate text-sm font-medium text-[var(--text-primary)]">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {actions}
            <button
              type="button"
              onClick={onClose}
              title="Close panel"
              className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </motion.div>
  );
}
