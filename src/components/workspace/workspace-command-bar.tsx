"use client";

/**
 * workspace-command-bar.tsx
 *
 * Center-stage command bar for the workspace canvas.
 * Spotlight-style: bottom-center, 480px resting, 560px expanded.
 * Workstream selector dropdown, auto-selects based on routing inference.
 * Cmd/Ctrl+K to focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Workstream } from "@/hooks/use-workspace-data";
import type { PanelType } from "@/stores/workspace-store";
import type { WorkspaceShellMode } from "@/lib/workspace/shell-mode";

type WorkspaceCommandBarProps = {
  hidden?: boolean;
  workstreams: Workstream[];
  primaryWorkstreamId?: string;
  onOpenWorkstreamChat: (workstreamId: string, query: string) => void;
  onOpenPanel?: (type: PanelType, id: string) => void;
  shellMode?: WorkspaceShellMode;
};

export function WorkspaceCommandBar({
  hidden = false,
  workstreams,
  primaryWorkstreamId,
  onOpenWorkstreamChat,
  shellMode = "magnetic",
}: WorkspaceCommandBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectorRef = useRef<HTMLButtonElement>(null);

  const activeWorkstreams = useMemo(
    () => workstreams.filter((ws) => ws.status === "active"),
    [workstreams],
  );
  const selectedWs = useMemo(
    () => activeWorkstreams.find((ws) => ws._id === selectedWsId) ?? null,
    [activeWorkstreams, selectedWsId],
  );

  // Auto-select workstream
  useEffect(() => {
    if (primaryWorkstreamId) {
      if (selectedWsId !== primaryWorkstreamId) {
        setSelectedWsId(primaryWorkstreamId);
      }
      return;
    }

    if (selectedWsId && !activeWorkstreams.some((ws) => ws._id === selectedWsId)) {
      setSelectedWsId(null);
      return;
    }

    if (!focused && selectedWsId) {
      setSelectedWsId(null);
      return;
    }
  }, [activeWorkstreams, focused, primaryWorkstreamId, selectedWsId]);

  // Cmd/Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Close picker on outside click
  useEffect(() => {
    if (!focused && !showPicker) return;
    const handler = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setFocused(false);
      }
    };
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [focused, showPicker]);

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return;
    const trimmed = query.trim();
    const inferredWorkstream = !selectedWs
      ? activeWorkstreams.find((ws) => {
          const haystack = `${ws.title} ${ws.description ?? ""} ${ws.subjectCode ?? ""}`.toLowerCase();
          return haystack.includes(trimmed.toLowerCase());
        }) ?? null
      : selectedWs;

    if (inferredWorkstream) {
      onOpenWorkstreamChat(inferredWorkstream._id, trimmed);
    } else {
      router.push(`/chat?prompt=${encodeURIComponent(trimmed)}`);
    }
    setQuery("");
    setFocused(false);
  }, [activeWorkstreams, onOpenWorkstreamChat, query, router, selectedWs]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setQuery("");
      setFocused(false);
      setShowPicker(false);
      inputRef.current?.blur();
    }
  };

  const isScoped = !!primaryWorkstreamId && selectedWs;
  const placeholder = isScoped
    ? `Ask ${selectedWs?.title}...`
    : "Ask anything...";

  const shellStyles = {
    constellations: {
      container: focused ? "w-[590px]" : "w-[510px]",
      bar: "border border-[rgba(14,142,232,0.4)] bg-[rgba(10,13,20,0.85)] shadow-[0_24px_60px_-26px_rgba(14,142,232,0.4)]",
      orb: "before:absolute before:-inset-x-12 before:-bottom-6 before:h-14 before:rounded-full before:bg-[radial-gradient(circle_at_center,rgba(14,142,232,0.16),transparent_70%)] before:blur-2xl before:content-['']",
      dock: "bottom-9",
    },
    magnetic: {
      container: focused ? "w-[560px]" : "w-[480px]",
      bar: "border border-white/10 bg-black/40 shadow-[0_20px_52px_-18px_rgba(0,0,0,0.8)] backdrop-blur-3xl",
      orb: "",
      dock: "bottom-8",
    },
    lenses: {
      container: focused ? "w-[580px]" : "w-[510px]",
      bar: "border border-[rgba(255,255,255,0.14)] bg-[rgba(19,17,26,0.72)] shadow-[0_28px_68px_-28px_rgba(15,23,42,0.75)] backdrop-blur-[40px]",
      orb: "before:absolute before:-inset-x-10 before:-bottom-8 before:h-16 before:rounded-full before:bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.12),transparent_72%)] before:blur-3xl before:content-['']",
      dock: "bottom-11",
    },
  }[shellMode];

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          ref={containerRef}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80, scale: 0.95 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className={cn("absolute left-1/2 -translate-x-1/2 z-50", shellStyles.dock, shellStyles.orb)}
        >
          {/* Workstream picker dropdown (above bar) */}
          <AnimatePresence>
            {showPicker && !primaryWorkstreamId && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  "absolute bottom-full mb-3 w-64 overflow-hidden rounded-[20px] border border-white/10 py-2 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.6)] backdrop-blur-[40px]",
                  shellMode === "magnetic" ? "left-1/2 -translate-x-1/2 bg-black/60" : "right-3 bg-black/80",
                )}
              >
                <div className="px-4 py-2 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">
                  Send to
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedWsId(null); setShowPicker(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all text-left",
                    !selectedWsId
                      ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10"
                      : "text-white/60 hover:text-white hover:bg-white/10",
                  )}
                >
                  <span className="text-sm">✨</span> Auto (detect)
                </button>
                {activeWorkstreams.map((ws) => (
                  <button
                    key={ws._id}
                    type="button"
                    onClick={() => { setSelectedWsId(ws._id); setShowPicker(false); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all text-left",
                      selectedWsId === ws._id
                        ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10"
                        : "text-white/60 hover:text-white hover:bg-white/10",
                    )}
                  >
                    <span className="text-sm leading-none">{ws.emoji || "📚"}</span>
                    <span className="truncate">{ws.title}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main bar */}
          <div
            className={cn(
              "relative flex items-center gap-3 px-4 py-3",
              "transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]",
              shellStyles.bar,
              shellStyles.container,
              shellMode === "constellations" ? "rounded-[30px]" : "rounded-full",
            )}
          >
            <Search className="w-4 h-4 text-white/40 shrink-0" />

            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1 bg-transparent border-none outline-none min-w-0 text-[15px] font-medium text-white placeholder:text-white/30"
            />

            {/* Workstream selector (when focused, not scoped) */}
            {focused && activeWorkstreams.length > 0 && !primaryWorkstreamId && (
              <button
                ref={selectorRef}
                type="button"
                onClick={() => setShowPicker((v) => !v)}
                className={cn(
                  "shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs transition-colors",
                  selectedWs
                    ? "text-white bg-white/10"
                    : "text-white/40 hover:text-white/80 hover:bg-white/10",
                )}
              >
                <span className="max-w-[100px] truncate font-semibold">
                  {selectedWs ? `${selectedWs.emoji} ${selectedWs.title}` : "Auto"}
                </span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}

            {/* Scoped badge when inside workstream */}
            {isScoped && focused && (
              <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10">
                → {selectedWs?.emoji} {selectedWs?.title}
              </span>
            )}

            {/* Clear button */}
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="shrink-0 p-1 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Send button */}
            {focused && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!query.trim()}
                className={cn(
                  "shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg",
                  query.trim()
                    ? "bg-[var(--accent-cyan)] text-white hover:brightness-110 hover:scale-105 shadow-[0_0_20px_rgba(14,142,232,0.5)]"
                    : "bg-white/10 text-white/30",
                )}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 ml-0.5">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}

            {/* Keyboard shortcut hint */}
            {!focused && (
              <kbd className="shrink-0 text-[10px] font-bold text-white/30 px-2 py-1 rounded-[6px] border border-white/10 bg-white/5">
                ⌘K
              </kbd>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { WorkspaceCommandBar as QuickChatBar };
