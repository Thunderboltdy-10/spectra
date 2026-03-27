"use client";

/**
 * chat-side-panel.tsx
 *
 * This is the floating "Quick Chat" bar visible on the canvas when
 * no workstream is focused. It infers the closest workstream from
 * the current canvas selection / center-of-viewport, shows a
 * workstream picker when ambiguous, and opens the full focus panel
 * or navigates to /chat when submitted.
 *
 * When a workstream is focused (WorkstreamFocusPanel is open), this
 * component is NOT rendered — chat lives inside the focus panel.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Workstream } from "@/hooks/use-workspace-data";

type QuickChatBarProps = {
  hidden?: boolean;
  workstreams: Workstream[];
  onOpenWorkstreamChat: (workstreamId: string, query: string) => void;
};

export function QuickChatBar({
  hidden = false,
  workstreams,
  onOpenWorkstreamChat,
}: QuickChatBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedWs, setSelectedWs] = useState<Workstream | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeWorkstreams = workstreams.filter((ws) => ws.status === "active");

  // Auto-select: if only one workstream, use it. If multiple, leave unselected (show picker).
  useEffect(() => {
    if (activeWorkstreams.length === 1 && !selectedWs) {
      setSelectedWs(activeWorkstreams[0] ?? null);
      return;
    }
    if (selectedWs && !activeWorkstreams.some((ws) => ws._id === selectedWs._id)) {
      setSelectedWs(null);
    }
  }, [activeWorkstreams, selectedWs]);

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return;
    const trimmed = query.trim();

    if (selectedWs) {
      onOpenWorkstreamChat(selectedWs._id, trimmed);
    } else {
      // No workstream — general one-off chat
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

  if (hidden) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute bottom-5 right-5 z-20",
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2.5 rounded-2xl",
          "bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
          "border border-[var(--border-default)]",
          "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4)]",
          "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          focused ? "w-[380px]" : "w-[220px]",
        )}
      >
        <MessageSquare className="w-4 h-4 text-[var(--accent-cyan)] shrink-0" />

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Quick chat..."
          className="flex-1 bg-transparent border-none outline-none min-w-0 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
        />

        {/* Workstream selector (shown when focused and multiple options exist) */}
        {focused && activeWorkstreams.length > 1 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors",
                selectedWs
                  ? "text-[var(--text-primary)] bg-[var(--bg-hover)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <span className="max-w-[80px] truncate">
                {selectedWs ? selectedWs.emoji + " " + selectedWs.title : "Choose..."}
              </span>
              <ChevronDown className="w-3 h-3 shrink-0" />
            </button>

            {showPicker && (
              <div
                className="absolute bottom-full right-0 mb-1 w-52 py-1 rounded-xl border border-[var(--border-default)] shadow-[var(--shadow-elevated)] overflow-hidden z-10"
                style={{ background: "var(--bg-elevated)" }}
              >
                <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">
                  Choose workstream
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedWs(null); setShowPicker(false); }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left",
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
                      "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left",
                      selectedWs?._id === ws._id
                        ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/6"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                    )}
                  >
                    <span className="text-sm leading-none">{ws.emoji || "📚"}</span>
                    <span className="truncate">{ws.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
              "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all",
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
      </div>

      {/* Workstream badge */}
      {focused && selectedWs && (
        <div className="flex justify-end mt-1.5">
          <div className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
            <span>Sending to</span>
            <span className="text-[var(--accent-cyan)] font-medium">
              {selectedWs.emoji} {selectedWs.title}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Keep backward compat export name — the page references ChatSidePanel
export { QuickChatBar as ChatSidePanel };
