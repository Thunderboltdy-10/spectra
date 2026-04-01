"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Clock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Workstream } from "@/hooks/use-workspace-data";
import { getWorkstreamColor } from "@/lib/workspace/zoom-helpers";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkspaceShellMode } from "@/lib/workspace/shell-mode";

type HubBarProps = {
  workstreams: Workstream[];
  primaryWorkstreamId?: string;
  onOpenWorkstream: (workstreamId: string) => void;
  onExitWorkstream: () => void;
  onOpenHub: () => void;
  onNewWorkstream: () => void;
  onOpenWorkstreamChat: (workstreamId: string, query: string) => void;
  shellMode?: WorkspaceShellMode;
  panelOpen?: boolean;
};

function formatTimerDisplay(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function HubBar({
  workstreams,
  primaryWorkstreamId,
  onOpenWorkstream,
  onExitWorkstream,
  onOpenHub,
  onNewWorkstream,
  onOpenWorkstreamChat,
  shellMode = "magnetic",
  panelOpen = false,
}: HubBarProps) {
  const [showTimerConfig, setShowTimerConfig] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const timerRemaining = Math.max(0, timerState.sessionMinutes * 60 - timerState.elapsed);
  const hasCommittedWorkstream = !!committedWorkstream;

  const shellChrome = {
    constellations: {
      dock: "mx-4 mb-3 gap-3",
      segment: "rounded-[999px] border border-[color:color-mix(in_oklab,var(--accent-cyan)_18%,var(--border-default))] bg-[color:rgba(19,17,26,0.72)] shadow-[0_24px_60px_-30px_rgba(14,142,232,0.35)] backdrop-blur-xl",
      pill: "rounded-full",
      input: "bg-transparent",
    },
    magnetic: {
      dock: "mx-3 mb-3 gap-2.5",
      segment: "rounded-[20px] border border-[var(--border-default)] bg-[var(--bg-elevated)]/96 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.55)]",
      pill: "rounded-xl",
      input: "bg-transparent",
    },
    lenses: {
      dock: "mx-6 mb-4 gap-3",
      segment: "rounded-[28px] border border-[color:rgba(255,255,255,0.12)] bg-[color:rgba(19,17,26,0.66)] shadow-[0_28px_80px_-34px_rgba(15,23,42,0.75)] backdrop-blur-2xl",
      pill: "rounded-full",
      input: "bg-transparent",
    },
  }[shellMode];

  const inferWorkstream = useCallback((text: string) => {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return committedWorkstream ?? activeWorkstreams[0] ?? null;
    return activeWorkstreams.find((ws) => {
      const haystack = `${ws.title} ${ws.description ?? ""} ${ws.subjectCode ?? ""}`.toLowerCase();
      return haystack.includes(normalized);
    }) ?? committedWorkstream ?? activeWorkstreams[0] ?? null;
  }, [activeWorkstreams, committedWorkstream]);

  const handleSubmit = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const target = committedWorkstream ?? inferWorkstream(trimmed);
    if (!target) return;
    onOpenWorkstreamChat(target._id, trimmed);
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }, [committedWorkstream, inferWorkstream, onOpenWorkstreamChat, query]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="relative z-30 shrink-0">
      <AnimatePresence>
        {showTimerConfig && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-10 mb-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl"
          >
            <div className="mb-3 text-xs font-medium text-[var(--text-secondary)]">
              Focus Timer
            </div>
            <div className="flex gap-2">
              {[25, 50, 90].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => {
                    setTimerMinutes(minutes);
                    setShowTimerConfig(false);
                  }}
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
                    timerState.sessionMinutes === minutes
                      ? "bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]"
                      : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {minutes}m
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

      <div className={cn("flex items-end justify-center px-3", shellChrome.dock, panelOpen && "opacity-92")}>
        <div className={cn("flex w-fit min-w-0 max-w-[min(42rem,48vw)] items-center gap-2 overflow-x-auto px-2 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", shellChrome.segment)}>
          {hasCommittedWorkstream && (
            <button
              type="button"
              onClick={onExitWorkstream}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                shellChrome.pill,
              )}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenHub}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-[11px] font-semibold transition-colors hover:bg-[var(--bg-hover)]",
              shellChrome.pill,
              primaryWorkstreamId === "__hub__"
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-secondary)]",
            )}
          >
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[var(--accent-cyan)]/80" />
            <span>Hub</span>
          </button>
          {activeWorkstreams.slice(0, 10).map((ws) => {
            const color = getWorkstreamColor(ws.color);
            const active = primaryWorkstreamId === ws._id;
            return (
              <button
                key={ws._id}
                type="button"
                onClick={() => onOpenWorkstream(ws._id)}
                title={`${ws.emoji} ${ws.title}`}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium transition-all duration-150",
                  shellChrome.pill,
                  active
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
                )}
                style={active ? { background: `${color.value}18` } : undefined}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: color.value, opacity: active ? 1 : 0.55 }}
                />
                <span className="max-w-[92px] truncate">
                  {ws.emoji} {ws.title}
                </span>
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className={cn(
            "mx-1 flex h-12 w-[min(28rem,34vw)] min-w-[15rem] items-center gap-2 px-3",
            shellChrome.segment,
            focused && "ring-1 ring-[var(--accent-cyan)]/28",
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              if (!query) setFocused(false);
            }}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                setFocused(false);
                inputRef.current?.blur();
              }
            }}
            placeholder={committedWorkstream ? `Ask ${committedWorkstream.title}...` : "Ask or jump to..."}
            className={cn(
              "min-w-0 flex-1 border-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none",
              shellChrome.input,
            )}
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center transition-colors",
              shellChrome.pill,
              query.trim()
                ? "bg-[var(--accent-cyan)] text-white"
                : "bg-[var(--bg-hover)] text-[var(--text-tertiary)]",
            )}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>

        <div className={cn("flex shrink-0 items-center gap-1.5 px-2 py-2", shellChrome.segment)}>
          <button
            type="button"
            onClick={onNewWorkstream}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
              shellChrome.pill,
            )}
            title="New workstream"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-6 w-px bg-[var(--border-default)]/55" />
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowTimerConfig((value) => !value)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors",
                shellChrome.pill,
                timerState.active
                  ? "bg-[var(--accent-cyan)]/12 text-[var(--accent-cyan)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              <span className="tabular-nums">
                {timerState.active ? formatTimerDisplay(timerRemaining) : `${timerState.sessionMinutes}:00`}
              </span>
            </button>

            {timerState.active ? (
              <button
                type="button"
                onClick={() => pauseTimer()}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
                  shellChrome.pill,
                )}
                title="Pause timer"
              >
                <Pause className="h-3 w-3" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startTimer(
                  timerState.sessionMinutes,
                  committedWorkstream?._id,
                  committedWorkstream?.title,
                )}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
                  shellChrome.pill,
                )}
                title="Start timer"
              >
                <Play className="h-3 w-3" />
              </button>
            )}

            {timerState.elapsed > 0 && !timerState.active && (
              <button
                type="button"
                onClick={() => resetTimer()}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
                  shellChrome.pill,
                )}
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
