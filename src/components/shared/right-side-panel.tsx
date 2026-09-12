"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  grammarFor,
  transitionFor,
  useSpectraMotion,
} from "@/features/spectra/motion";
import { SurfaceField } from "@/features/spectra/field/surface-field";

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
 * Panel slide-in animation, on the Spectra motion grammar:
 * - The panel itself is a `morph` — one surface becoming another (the
 *   route-crossing Follow AI panel is exactly that).
 * - Content inside is a `reveal` — it enters after the panel lands.
 * - On exit, content fades first, then the panel slides away.
 * Reduced motion keeps the state change legible without travel; "none"
 * resolves every transition to instant.
 */

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
  const motionLevel = useSpectraMotion();

  const panelVariants = useMemo<import("framer-motion").Variants>(() => {
    const morph = transitionFor("morph", motionLevel.level);
    const reveal = transitionFor("reveal", motionLevel.level);
    const delay = motionLevel.disabled ? 0 : 0.05;
    return {
      hidden: { width: 0, opacity: 0 },
      visible: (width: number) => ({
        width,
        opacity: 1,
        transition: {
          width: morph,
          opacity: { ...reveal, delay },
        },
      }),
      exit: {
        width: 0,
        opacity: 0,
        transition: {
          opacity: { ...reveal },
          width: { ...morph, delay },
        },
      },
    };
  }, [motionLevel.level, motionLevel.disabled]);

  const contentVariants = useMemo<import("framer-motion").Variants>(() => {
    const reveal = grammarFor("reveal", motionLevel.level);
    const transition = transitionFor("reveal", motionLevel.level);
    const delay = motionLevel.disabled ? 0 : 0.12;
    return {
      hidden: { opacity: 0, y: reveal.distance },
      visible: {
        opacity: 1,
        y: 0,
        transition: { ...transition, delay },
      },
      exit: {
        opacity: 0,
        y: -reveal.distance,
        transition,
      },
    };
  }, [motionLevel.level, motionLevel.disabled]);

  const headerTransition = useMemo(() => {
    const reveal = transitionFor("reveal", motionLevel.level);
    return { ...reveal, delay: motionLevel.disabled ? 0 : 0.1 };
  }, [motionLevel.level, motionLevel.disabled]);

  const headerDistance = grammarFor("reveal", motionLevel.level).distance * 2;
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
        "relative isolate h-full w-full shrink-0 overflow-hidden",
        "bg-[var(--bg-elevated)]/80 border-l border-[var(--border-default)]/40",
        "shadow-[var(--shadow-lg)]",
        className,
      )}
    >
      {/* the panel is made of the same material as every other surface */}
      <SurfaceField scale="panel" behind />
      {/* Resize handle — invisible 6px drag strip on left edge */}
      <div
        className="absolute inset-y-0 left-0 z-chrome w-1.5 cursor-col-resize hover:bg-[var(--accent-cyan)]/10 active:bg-[var(--accent-cyan)]/15 transition-colors"
        onMouseDown={handleMouseDown}
      />

      <div className="flex h-full w-full flex-col">
        {/* Header with fly-in animation */}
        <motion.div
          initial={{ opacity: 0, x: headerDistance }}
          animate={{ opacity: 1, x: 0 }}
          transition={headerTransition}
          className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-default)]/60 px-4"
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
