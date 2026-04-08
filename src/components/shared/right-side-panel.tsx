"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  contentKey?: string;
};

/**
 * Panel slide-in animation:
 * - The panel slides in from the right edge with a smooth spring easing
 * - Content inside fades in with a slight upward shift after the panel lands
 * - On exit, content fades out first, then the panel slides away
 */
const panelVariants: import("framer-motion").Variants = {
  hidden: {
    width: 0,
    opacity: 0,
  },
  visible: (width: number) => ({
    width,
    opacity: 1,
    transition: {
      width: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
      opacity: { duration: 0.2, delay: 0.05 },
    },
  }),
  exit: {
    width: 0,
    opacity: 0,
    transition: {
      opacity: { duration: 0.15 },
      width: { duration: 0.25, ease: "easeIn", delay: 0.05 },
    },
  },
};

const contentVariants: import("framer-motion").Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.25,
      delay: 0.15,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.15, ease: "easeIn" },
  },
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
  contentKey,
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
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      custom={width}
      className={cn(
        "relative h-full w-full shrink-0 overflow-hidden",
        "bg-[var(--bg-elevated)]/80 border-l border-[var(--border-default)]/40 backdrop-blur-[40px]",
        "shadow-[-12px_0_32px_-16px_rgba(0,0,0,0.12),-20px_0_44px_-34px_rgba(15,23,42,0.45)]",
        className,
      )}
    >
      {/* Resize handle — invisible 6px drag strip on left edge */}
      <div
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-[var(--accent-cyan)]/10 active:bg-[var(--accent-cyan)]/15 transition-colors"
        onMouseDown={handleMouseDown}
      />

      <div className="flex h-full w-full flex-col">
        {/* Header with fly-in animation */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, delay: 0.12 }}
          className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-default)]/60 px-4 backdrop-blur-md"
        >
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
        </motion.div>

        {/* Content with staggered fade-in and cross-fade on change */}
        <AnimatePresence mode="wait">
          <motion.div
            key={contentKey ?? "static-content"}
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="min-h-0 flex-1 overflow-hidden"
            style={{ minWidth: 0 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
