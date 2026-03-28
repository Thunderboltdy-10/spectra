"use client";

/**
 * workspace-command-bar.tsx
 *
 * Center-stage command bar for the workspace canvas.
 * Spotlight-style: bottom-center, 480px resting, 560px expanded.
 * Workstream selector dropdown, auto-selects based on routing inference.
 * Cmd/Ctrl+K to focus.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Workstream } from "@/hooks/use-workspace-data";
import type { PanelType } from "@/stores/workspace-store";

type WorkspaceCommandBarProps = {
  hidden?: boolean;
  workstreams: Workstream[];
  committedWorkstreamId?: string;
  onOpenWorkstreamChat: (workstreamId: string, query: string) => void;
  onOpenPanel?: (type: PanelType, id: string) => void;
};

export function WorkspaceCommandBar({
  hidden = false,
  workstreams,
  committedWorkstreamId,
  onOpenWorkstreamChat,
}: WorkspaceCommandBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedWs, setSelectedWs] = useState<Workstream | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeWorkstreams = workstreams.filter((ws) => ws.status === "active");

  // Auto-select workstream
  useEffect(() => {
    // If committed to a workstream, scope to it
    if (committedWorkstreamId) {
      const ws = activeWorkstreams.find((w) => w._id === committedWorkstreamId);
      if (ws) {
        setSelectedWs(ws);
        return;
      }
    }
    // If only one workstream, auto-select
    if (activeWorkstreams.length === 1 && !selectedWs) {
      setSelectedWs(activeWorkstreams[0] ?? null);
      return;
    }
    // If selected ws was deleted/archived, clear
    if (selectedWs && !activeWorkstreams.some((ws) => ws._id === selectedWs._id)) {
      setSelectedWs(null);
    }
  }, [activeWorkstreams, committedWorkstreamId, selectedWs]);

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
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        if (!query) setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [query]);

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return;
    const trimmed = query.trim();

    if (selectedWs) {
      onOpenWorkstreamChat(selectedWs._id, trimmed);
    } else {
      router.push(`/chat?prompt=${encodeURIComponent(trimmed)}`);
    }
    setQuery("");
    setFocused(false);
  }, [onOpenWorkstreamChat, query, router, selectedWs]);

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

  if (hidden) return null;

  const isScoped = !!committedWorkstreamId && selectedWs;
  const placeholder = isScoped
    ? `Ask ${selectedWs?.title}...`
    : "Ask anything...";

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.2 }}
      className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30"
    >
      {/* Workstream picker dropdown (above bar) */}
      <AnimatePresence>
        {showPicker && !committedWorkstreamId && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 py-1.5 rounded-xl border border-[var(--border-default)] shadow-[0_16px_48px_-12px_rgba(0,0,0,0.4)] overflow-hidden"
            style={{ background: "var(--bg-elevated)" }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">
              Send to
            </div>
            <button
              type="button"
              onClick={() => { setSelectedWs(null); setShowPicker(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                !selectedWs
                  ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/6"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <span className="text-xs">✨</span> General chat
            </button>
            {activeWorkstreams.map((ws) => (
              <button
                key={ws._id}
                type="button"
                onClick={() => { setSelectedWs(ws); setShowPicker(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                  selectedWs?._id === ws._id
                    ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/6"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
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
          "flex items-center gap-3 px-4 py-3 rounded-2xl",
          "bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
          "border border-[var(--border-default)]",
          "shadow-[0_8px_40px_-8px_rgba(0,0,0,0.35)]",
          "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          focused ? "w-[560px]" : "w-[480px]",
        )}
      >
        <Search className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none min-w-0 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
        />

        {/* Workstream selector (when focused, not scoped) */}
        {focused && activeWorkstreams.length > 1 && !committedWorkstreamId && (
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            className={cn(
              "shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors",
              selectedWs
                ? "text-[var(--text-primary)] bg-[var(--bg-hover)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
            )}
          >
            <span className="max-w-[80px] truncate">
              {selectedWs ? `${selectedWs.emoji} ${selectedWs.title}` : "Choose..."}
            </span>
            <ChevronDown className="w-3 h-3 shrink-0" />
          </button>
        )}

        {/* Scoped badge when inside workstream */}
        {isScoped && focused && (
          <span className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/8">
            → {selectedWs?.emoji} {selectedWs?.title}
          </span>
        )}

        {/* Clear button */}
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="shrink-0 p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Send button */}
        {focused && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!query.trim()}
            className={cn(
              "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all",
              query.trim()
                ? "bg-[var(--accent-cyan)] text-white hover:brightness-110"
                : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]",
            )}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        )}

        {/* Keyboard shortcut hint */}
        {!focused && (
          <kbd className="shrink-0 text-[10px] text-[var(--text-tertiary)] px-1.5 py-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-secondary)]">
            ⌘K
          </kbd>
        )}
      </div>
    </motion.div>
  );
}

// Keep backward compat export name
export { WorkspaceCommandBar as QuickChatBar };
