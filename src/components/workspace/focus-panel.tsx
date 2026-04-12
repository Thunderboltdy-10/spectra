"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, BookOpen, Clock, Send, Sparkles, X } from "lucide-react";
import {
  CANONICAL_WORKSPACE_TYPE_META,
  type CanonicalWorkspaceType,
} from "@/lib/artifact-types";
import type { WorkspaceItemData } from "@/lib/workspace/contracts";
import { cn } from "@/lib/utils";

const MIN_WIDTH = 340;
const MAX_WIDTH = 640;

const panelVariants: import("framer-motion").Variants = {
  hidden: { width: 0, opacity: 0 },
  visible: (width: number) => ({
    width,
    opacity: 1,
    transition: {
      width: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
      opacity: { duration: 0.18, delay: 0.04 },
    },
  }),
  exit: {
    width: 0,
    opacity: 0,
    transition: {
      opacity: { duration: 0.12 },
      width: { duration: 0.22, ease: "easeIn", delay: 0.04 },
    },
  },
};

const contentVariants: import("framer-motion").Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.22,
      delay: 0.12,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: 0.12, ease: "easeIn" },
  },
};

function formatTime(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ThreadContent({ }: { item: WorkspaceItemData }) {
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl bg-[var(--bg-secondary)] px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-[var(--text-primary)]">
              Can you explain centripetal acceleration and how it relates to circular motion?
            </p>
            <span className="mt-1.5 block text-[10px] text-[var(--text-tertiary)]">You · 2m ago</span>
          </div>
          <div className="rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-elevated)] px-3.5 py-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-[var(--accent-cyan)]" />
              <span className="text-[10px] font-medium text-[var(--accent-cyan)]">AI Tutor</span>
            </div>
            <p className="text-[13px] leading-relaxed text-[var(--text-primary)]">
              Centripetal acceleration is the acceleration directed toward the center of a circular path. For an object moving in a circle of radius r with speed v, the centripetal acceleration is a = v²/r.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-primary)]">
              This acceleration doesn&apos;t change the object&apos;s speed — it changes direction. Without centripetal force, the object would continue in a straight line.
            </p>
            <span className="mt-1.5 block text-[10px] text-[var(--text-tertiary)]">AI · 2m ago</span>
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-[var(--border-default)]/30 px-4 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-default)]/50 bg-[var(--bg-secondary)] px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && message.trim()) setMessage("");
            }}
            placeholder="Continue the conversation..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          <button
            type="button"
            disabled={!message.trim()}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-lg transition-all duration-150",
              message.trim() ? "bg-[var(--accent-cyan)] text-white" : "bg-transparent text-[var(--text-tertiary)]",
            )}
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ArtifactContent({ item }: { item: WorkspaceItemData }) {
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-start gap-3">
          {meta?.icon ? (
            <div
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `color-mix(in oklab, ${meta.color} 10%, var(--bg-secondary))` }}
            >
              <meta.icon className="h-4 w-4" style={{ color: meta.color }} />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold leading-tight text-[var(--text-primary)]">{item.title}</h3>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{meta?.label ?? item.itemType}</span>
              {item.updatedAt ? (
                <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]/60">
                  <Clock className="h-2.5 w-2.5" />
                  {formatTime(item.updatedAt)}
                </span>
              ) : null}
              {item.meta ? <span className="text-[10px] font-medium text-[var(--text-secondary)]">{item.meta}</span> : null}
            </div>
          </div>
        </div>

        {item.preview ? <p className="mb-4 text-[13px] leading-relaxed text-[var(--text-secondary)]">{item.preview}</p> : null}

        <div className="rounded-2xl border border-[var(--border-default)]/30 bg-[var(--bg-secondary)]/40 p-4">
          {item.itemType === "note" ? (
            <div className="flex flex-col gap-2">
              <div className="h-3 w-[85%] rounded bg-[var(--text-primary)]/[0.06]" />
              <div className="h-3 w-[72%] rounded bg-[var(--text-primary)]/[0.06]" />
              <div className="h-3 w-[90%] rounded bg-[var(--text-primary)]/[0.06]" />
              <div className="h-3 w-[60%] rounded bg-[var(--text-primary)]/[0.06]" />
              <div className="mt-2 h-3 w-[78%] rounded bg-[var(--text-primary)]/[0.06]" />
              <div className="h-3 w-[66%] rounded bg-[var(--text-primary)]/[0.06]" />
              <p className="mt-3 text-[11px] text-[var(--text-tertiary)]/60">Rich editor content loads here — connected to artifact in later waves</p>
            </div>
          ) : item.itemType === "code" ? (
            <div className="flex flex-col gap-1.5 font-mono text-[11px] text-[var(--text-secondary)]/60">
              <span className="text-[var(--accent-cyan)]/50">def</span>
              <div className="ml-0 h-3 w-[80%] rounded bg-[var(--text-primary)]/[0.05]" />
              <div className="ml-4 h-3 w-[65%] rounded bg-[var(--text-primary)]/[0.05]" />
              <div className="ml-4 h-3 w-[70%] rounded bg-[var(--text-primary)]/[0.05]" />
              <div className="ml-8 h-3 w-[50%] rounded bg-[var(--text-primary)]/[0.05]" />
              <p className="mt-3 font-sans text-[11px] text-[var(--text-tertiary)]/60">Code editor loads here</p>
            </div>
          ) : item.itemType === "flashcard_deck" ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="flex h-28 w-48 items-center justify-center rounded-xl border border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/60">
                <BookOpen className="h-6 w-6 text-[var(--text-tertiary)]/30" />
              </div>
              <p className="text-[11px] text-[var(--text-tertiary)]/60">Flashcard review interface loads here</p>
            </div>
          ) : item.itemType === "quiz" ? (
            <div className="flex flex-col gap-3 py-2">
              <div className="rounded-xl border border-[var(--border-default)]/20 bg-[var(--bg-elevated)]/40 px-3 py-2.5">
                <div className="mb-2 h-3 w-[70%] rounded bg-[var(--text-primary)]/[0.06]" />
                <div className="ml-1 flex flex-col gap-1.5">
                  <div className="h-2.5 w-[55%] rounded bg-[var(--text-primary)]/[0.04]" />
                  <div className="h-2.5 w-[50%] rounded bg-[var(--text-primary)]/[0.04]" />
                  <div className="h-2.5 w-[60%] rounded bg-[var(--text-primary)]/[0.04]" />
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-tertiary)]/60">Quiz interface loads here</p>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--text-tertiary)]">
              Deep edit view for <span className="font-medium text-[var(--text-secondary)]">{meta?.label ?? item.itemType}</span> items loads here.
            </p>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_4%,var(--bg-secondary))] px-3.5 py-3">
          <div className="mb-1.5 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-cyan)]/60" />
            <span className="text-[11px] font-medium text-[var(--accent-cyan)]/80">AI Assist</span>
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
            Ask questions about this {meta?.label?.toLowerCase() ?? "item"}, request edits, or get suggestions.
          </p>
        </div>
      </div>
    </div>
  );
}

export function FocusPanel({ item, onClose, className }: { item: WorkspaceItemData; onClose: () => void; className?: string }) {
  const panelType = item.itemType === "thread" ? "chat" : "artifact";
  const storageKey = `workspace:panel-width:${panelType}`;
  const meta = CANONICAL_WORKSPACE_TYPE_META[item.itemType as CanonicalWorkspaceType];
  const [width, setWidth] = useState(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = Number(stored);
        if (parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) return parsed;
      }
    } catch {}
    return 420;
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
      const delta = startX.current - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { window.localStorage.setItem(storageKey, String(width)); } catch {}
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
      className={cn("relative h-full shrink-0 overflow-hidden border-l border-[var(--border-default)]/30 bg-[var(--bg-elevated)]/85 backdrop-blur-[32px]", className)}
      style={{ boxShadow: "-8px 0 24px -12px rgba(0,0,0,0.08), -16px 0 36px -28px rgba(15,23,42,0.35)" }}
    >
      <div className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-[var(--accent-cyan)]/8 active:bg-[var(--accent-cyan)]/12" onMouseDown={handleMouseDown} />
      <div className="flex h-full w-full flex-col">
        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18, delay: 0.1 }} className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-default)]/40 px-4">
          <div className="flex min-w-0 items-center gap-2">
            {meta?.icon ? <span className="text-[var(--text-tertiary)]"><meta.icon className="h-4 w-4" style={{ color: meta.color }} /></span> : null}
            <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{item.title}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button type="button" title="Expand to full page" className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onClose} title="Close panel" className="rounded-md p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
        <AnimatePresence mode="wait">
          <motion.div key={item.id} variants={contentVariants} initial="hidden" animate="visible" exit="exit" className="min-h-0 flex-1 overflow-hidden">
            {item.itemType === "thread" ? <ThreadContent item={item} /> : <ArtifactContent item={item} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
