"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type RightSidePanelProps = {
  width: number;
  title: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

export function RightSidePanel({
  width,
  title,
  icon,
  actions,
  onClose,
  children,
  className,
}: RightSidePanelProps) {
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
