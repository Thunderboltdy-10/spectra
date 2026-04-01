"use client";

/**
 * hub-bar.tsx
 *
 * Persistent bottom bar for the workspace — the user's control center.
 * Contains: workstream pills, focus timer, deadline badge, and the AI command bar.
 * Always visible, never scrolls with the canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  Clock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Workstream } from "@/hooks/use-workspace-data";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";
import { useWorkspaceStore, type PanelType } from "@/stores/workspace-store";

type HubBarProps = {
  workstreams: Workstream[];
  primaryWorkstreamId?: string;
  onOpenWorkstream: (workstreamId: string) => void;
  onExitWorkstream: () => void;
  onOpenHub: () => void;
  onNewWorkstream: () => void;
  onOpenWorkstreamChat: (workstreamId: string, query: string) => void;
  onOpenPanel?: (type: PanelType, id: string) => void;
  panelOpen?: boolean;
};

function formatTimerDisplay(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function HubBar({
  workstreams,
  primaryWorkstreamId,
  onOpenWorkstream,
  onExitWorkstream,
  onOpenHub: _onOpenHub,
  onNewWorkstream,
  onOpenWorkstreamChat,
  panelOpen: _panelOpen = false,
}: HubBarProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);
  const [showTimerConfig, setShowTimerConfig] = useState(false);

  const {
    timerState,
    setTimerMinutes,
    startTimer,
    pauseTimer,
    resetTimer,
  } = useWorkspaceStore();

  const activeWorkstreams = useMemo(
    () => workstreams.filter((ws) => ws.status === "active"),
    [workstreams],
  );

  const committedWorkstream = useMemo(
    () =>
      primaryWorkstreamId && primaryWorkstreamId !== "__hub__"
        ? workstreams.find((ws) => ws._id === primaryWorkstreamId)
        : undefined,
    [primaryWorkstreamId, workstreams],
  );

  // Auto-scope to committed workstream
  useEffect(() => {
    if (primaryWorkstreamId && primaryWorkstreamId !== "__hub__") {
      setSelectedWsId(primaryWorkstreamId);
    }
  }, [primaryWorkstreamId]);

  // Cmd/Ctrl+K to focus
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

  // Click outside to close picker
  useEffect(() => {
    if (!showPicker) return;
    const handler = () => setShowPicker(false);
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showPicker]);

  const inferWorkstream = useCallback(
    (text: string) => {
      if (!text.trim()) return null;
      const lower = text.toLowerCase();
      return (
        activeWorkstreams.find(
          (ws) =>
            ws.title.toLowerCase().includes(lower) ||
            ws.description?.toLowerCase().includes(lower) ||
            ws.subjectCode?.toLowerCase().includes(lower),
        ) ?? null
      );
    },
    [activeWorkstreams],
  );

  const handleSubmit = useCallback(() => {
    const text = query.trim();
    if (!text) return;

    const targetWsId =
      selectedWsId ??
      inferWorkstream(text)?._id ??
      activeWorkstreams[0]?._id;

    if (targetWsId) {
      onOpenWorkstreamChat(targetWsId, text);
    } else {
      router.push(`/?prompt=${encodeURIComponent(text)}`);
    }
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }, [activeWorkstreams, inferWorkstream, onOpenWorkstreamChat, query, router, selectedWsId]);

  const timerRemaining = timerState.sessionMinutes * 60 - timerState.elapsed;

  return (
    <div className="relative z-30 shrink-0 border-t border-[var(--border-default)] bg-[var(--bg-primary)]/95 backdrop-blur-xl">
      {/* Timer config popover */}
      <AnimatePresence>
        {showTimerConfig && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-8 mb-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-medium text-[var(--text-secondary)] mb-3">
              Focus Timer
            </div>
            <div className="flex gap-2">
              {[25, 50, 90].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => {
                    setTimerMinutes(mins);
                    setShowTimerConfig(false);
                  }}
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
                    timerState.sessionMinutes === mins
                      ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]"
                      : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {mins}m
                </button>
              ))}
            </div>
            {timerState.sessionsCompleted > 0 && (
              <div className="mt-3 text-[10px] text-[var(--text-tertiary)]">
                Today: {timerState.sessionsCompleted} sessions
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Workstream picker dropdown */}
      <AnimatePresence>
        {showPicker && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[320px] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-2 pb-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Route to workstream
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedWsId(null);
                setShowPicker(false);
              }}
              className={cn(
                "w-full rounded-xl px-3 py-2 text-left text-sm transition-colors",
                !selectedWsId
                  ? "bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              Auto (detect)
            </button>
            {activeWorkstreams.map((ws) => {
              const color = getWorkstreamColor(ws.color);
              return (
                <button
                  key={ws._id}
                  type="button"
                  onClick={() => {
                    setSelectedWsId(ws._id);
                    setShowPicker(false);
                  }}
                  className={cn(
                    "w-full rounded-xl px-3 py-2 text-left text-sm transition-colors flex items-center gap-2",
                    selectedWsId === ws._id
                      ? "bg-[var(--accent-cyan)]/10 text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: color.value }}
                  />
                  <span className="truncate">
                    {ws.emoji} {ws.title}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main bar content */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Left: Breadcrumb or workstream pills */}
        <div className="flex items-center gap-1.5 shrink-0 min-w-0">
          {committedWorkstream ? (
            /* Show breadcrumb when inside a workstream */
            <button
              type="button"
              onClick={onExitWorkstream}
              className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="max-w-[100px] truncate">
                {committedWorkstream.emoji} {committedWorkstream.title}
              </span>
            </button>
          ) : (
            /* Show workstream pills when in overview */
            <div className="flex items-center gap-1">
              {activeWorkstreams.slice(0, 6).map((ws) => {
                const color = getWorkstreamColor(ws.color);
                const isActive = primaryWorkstreamId === ws._id;
                return (
                  <button
                    key={ws._id}
                    type="button"
                    onClick={() => onOpenWorkstream(ws._id)}
                    title={`${ws.emoji} ${ws.title}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200",
                      isActive
                        ? "text-[var(--text-primary)]"
                        : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                    )}
                    style={isActive ? { background: `${color.value}15` } : undefined}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: color.value, opacity: isActive ? 1 : 0.5 }}
                    />
                    <span className="hidden sm:inline max-w-[80px] truncate">
                      {ws.title}
                    </span>
                  </button>
                );
              })}
              {activeWorkstreams.length > 6 && (
                <span className="text-[10px] text-[var(--text-tertiary)] px-1">
                  +{activeWorkstreams.length - 6}
                </span>
              )}
              <button
                type="button"
                onClick={onNewWorkstream}
                title="New workstream"
                className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Center: AI Command Bar */}
        <div className="flex-1 min-w-0 max-w-[560px] mx-auto">
          <div
            className={cn(
              "relative flex items-center rounded-2xl border transition-all duration-200",
              focused
                ? "border-[var(--accent-cyan)]/40 bg-[var(--bg-elevated)] shadow-[0_4px_24px_-4px_rgba(14,142,232,0.15)]"
                : "border-[var(--border-default)] bg-[var(--bg-secondary)]/80 hover:bg-[var(--bg-secondary)]",
            )}
          >
            <div className="flex items-center pl-3">
              <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            </div>

            {/* Workstream scope badge */}
            {selectedWsId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowPicker(true);
                }}
                className="ml-2 inline-flex items-center gap-1 rounded-lg bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background:
                      getWorkstreamColor(
                        activeWorkstreams.find((ws) => ws._id === selectedWsId)?.color,
                      ).value,
                  }}
                />
                <span className="max-w-[60px] truncate">
                  {activeWorkstreams.find((ws) => ws._id === selectedWsId)?.title ?? "Auto"}
                </span>
                <X
                  className="h-2.5 w-2.5 opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedWsId(null);
                  }}
                />
              </button>
            )}

            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setTimeout(() => setFocused(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
                if (e.key === "Escape") {
                  inputRef.current?.blur();
                }
              }}
              placeholder={
                committedWorkstream
                  ? `Ask about ${committedWorkstream.title}...`
                  : "Ask anything, create anything..."
              }
              className="flex-1 bg-transparent px-2.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none min-w-0"
            />

            {/* Scope selector trigger */}
            {!selectedWsId && !primaryWorkstreamId && (
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="mr-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
              >
                Auto
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
            )}

            {/* Keyboard hint */}
            {!focused && !query && (
              <kbd className="mr-3 hidden sm:inline text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-hover)] px-1.5 py-0.5 rounded">
                ⌘K
              </kbd>
            )}
          </div>
        </div>

        {/* Right: Timer + Deadline badge */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Focus Timer */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowTimerConfig((prev) => !prev)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors",
                timerState.active
                  ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              <span className="tabular-nums">
                {timerState.active
                  ? formatTimerDisplay(timerRemaining)
                  : `${timerState.sessionMinutes}:00`}
              </span>
            </button>

            {timerState.active ? (
              <button
                type="button"
                onClick={() => pauseTimer()}
                className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                title="Pause timer"
              >
                <Pause className="h-3 w-3" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startTimer()}
                className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                title="Start timer"
              >
                <Play className="h-3 w-3" />
              </button>
            )}

            {timerState.elapsed > 0 && !timerState.active && (
              <button
                type="button"
                onClick={() => resetTimer()}
                className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                title="Reset timer"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
