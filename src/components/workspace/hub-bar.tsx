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
  Layers,
  Zap
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
      container: "px-6 pb-6 gap-6 justify-center",
      panel: "rounded-full border border-[rgba(14,142,232,0.3)] bg-[rgba(10,13,20,0.8)] shadow-[0_0_30px_rgba(14,142,232,0.15)] backdrop-blur-3xl px-3 py-2",
      pill: "rounded-[24px]",
      input: "bg-transparent placeholder-white/30 text-white",
      activeBg: "bg-[rgba(14,142,232,0.15)] shadow-[inset_0_0_10px_rgba(14,142,232,0.2)]"
    },
    magnetic: {
      container: "px-4 pb-4 gap-3 justify-center",
      panel: "rounded-[20px] border border-white/10 bg-black/40 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.6)] backdrop-blur-2xl px-2 py-2",
      pill: "rounded-[14px]",
      input: "bg-transparent placeholder-white/40 text-white",
      activeBg: "bg-white/10"
    },
    lenses: {
      container: "px-8 pb-8 gap-4 justify-between",
      panel: "rounded-[16px] border border-white/5 bg-white/[0.03] shadow-[0_10px_40px_rgba(0,0,0,0.8)] backdrop-blur-[40px] px-2 py-2",
      pill: "rounded-[10px]",
      input: "bg-transparent placeholder-white/20 text-white/90",
      activeBg: "bg-white/10"
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
    <div className={cn("absolute bottom-0 inset-x-0 z-40 transition-transform duration-500", panelOpen ? "translate-y-[150%]" : "translate-y-0")}>
      <AnimatePresence>
        {showTimerConfig && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "absolute bottom-full mb-6 rounded-[24px] border border-white/10 p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] backdrop-blur-[40px]",
              shellMode === "constellations" ? "right-1/4 bg-[rgba(10,13,20,0.9)] border-[rgba(14,142,232,0.3)] shadow-[0_0_40px_rgba(14,142,232,0.1)]" : "right-12 bg-black/60"
            )}
          >
            <div className="mb-4 text-xs font-bold uppercase tracking-widest text-white/50 flex items-center gap-2">
              <Zap className="w-4 h-4 text-[var(--accent-cyan)]" /> Focus Timer
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
                    "rounded-[16px] px-4 py-2 text-sm font-semibold transition-all",
                    timerState.sessionMinutes === minutes
                      ? "bg-[var(--accent-cyan)] text-white shadow-[0_0_20px_rgba(14,142,232,0.4)]"
                      : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
                  )}
                >
                  {minutes}m
                </button>
              ))}
            </div>
            {timerState.sessionsCompleted > 0 && (
              <div className="mt-4 text-[11px] font-mono text-white/40">
                Today: {timerState.sessionsCompleted} sessions completed
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn("flex items-end w-full", shellChrome.container)}>
        
        {/* Workstream Switcher Panel */}
        <div className={cn("flex max-w-[50vw] items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", shellChrome.panel)}>
          {hasCommittedWorkstream && (
            <button
              type="button"
              onClick={onExitWorkstream}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 px-4 py-2 text-[13px] font-medium text-white/50 transition-colors hover:text-white hover:bg-white/10",
                shellChrome.pill,
              )}
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Zoom Out</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenHub}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 px-4 py-2 text-[13px] font-bold transition-all",
              shellChrome.pill,
              primaryWorkstreamId === "__hub__"
                ? `text-white ${shellChrome.activeBg}`
                : "text-white/50 hover:bg-white/10 hover:text-white/80",
            )}
          >
            <Layers className="h-4 w-4" />
            <span>Hub</span>
          </button>
          
          <div className="w-px h-6 bg-white/10 mx-2" />

          {activeWorkstreams.slice(0, 8).map((ws) => {
            const color = getWorkstreamColor(ws.color);
            const active = primaryWorkstreamId === ws._id;
            return (
              <button
                key={ws._id}
                type="button"
                onClick={() => onOpenWorkstream(ws._id)}
                title={`${ws.emoji} ${ws.title}`}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 px-3 py-2 text-[13px] font-medium transition-all duration-300",
                  shellChrome.pill,
                  active
                    ? `text-white ${shellChrome.activeBg}`
                    : "text-white/50 hover:bg-white/10 hover:text-white/80",
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: color.value, opacity: active ? 1 : 0.4, boxShadow: active ? `0 0 10px ${color.value}` : 'none' }}
                />
                <span className="max-w-[120px] truncate">
                  {ws.emoji} {ws.title}
                </span>
              </button>
            );
          })}
          
          <button
            type="button"
            onClick={onNewWorkstream}
            className={cn(
              "inline-flex h-9 w-9 ml-1 shrink-0 items-center justify-center text-white/40 transition-colors hover:bg-white/10 hover:text-white",
              shellChrome.pill,
            )}
            title="New workstream"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Global Action / Search Panel */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className={cn(
            "flex h-[52px] w-[min(28rem,30vw)] min-w-[18rem] items-center gap-3 transition-all duration-300",
            shellChrome.panel,
            focused && "ring-2 ring-[var(--accent-cyan)]/40 shadow-[0_0_30px_rgba(14,142,232,0.2)]"
          )}
        >
          <div className="pl-2">
            <Search className={cn("h-4 w-4 transition-colors", focused ? "text-[var(--accent-cyan)]" : "text-white/30")} />
          </div>
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
            placeholder={committedWorkstream ? `Ask inside ${committedWorkstream.title}...` : "Command or Ask AI..."}
            className={cn(
              "min-w-0 flex-1 border-none font-medium focus:outline-none",
              shellChrome.input,
            )}
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center transition-all duration-300",
              shellChrome.pill,
              query.trim()
                ? "bg-[var(--accent-cyan)] text-white shadow-[0_0_15px_rgba(14,142,232,0.4)]"
                : "bg-white/5 text-white/20",
            )}
          >
            <Send className="h-4 w-4 ml-0.5" />
          </button>
        </form>

        {/* Utility / Timer Panel */}
        <div className={cn("flex shrink-0 items-center gap-1", shellChrome.panel)}>
          <button
            type="button"
            onClick={() => setShowTimerConfig((value) => !value)}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 text-[13px] font-bold font-mono transition-colors",
              shellChrome.pill,
              timerState.active
                ? "bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]"
                : "text-white/60 hover:bg-white/10 hover:text-white",
            )}
          >
            <Clock className="h-4 w-4" />
            <span className="tracking-widest">
              {timerState.active ? formatTimerDisplay(timerRemaining) : `${timerState.sessionMinutes}:00`}
            </span>
          </button>

          <div className="w-px h-6 bg-white/10 mx-1" />

          {timerState.active ? (
            <button
              type="button"
              onClick={() => pauseTimer()}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center text-white/60 transition-colors hover:bg-white/10 hover:text-white",
                shellChrome.pill,
              )}
            >
              <Pause className="h-4 w-4 fill-current" />
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
                "inline-flex h-9 w-9 items-center justify-center text-[var(--accent-cyan)] transition-colors hover:bg-[var(--accent-cyan)]/20 hover:text-[var(--accent-cyan)]",
                shellChrome.pill,
              )}
            >
              <Play className="h-4 w-4 fill-current ml-0.5" />
            </button>
          )}

          {timerState.elapsed > 0 && !timerState.active && (
            <button
              type="button"
              onClick={() => resetTimer()}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center text-white/40 transition-colors hover:bg-white/10 hover:text-white/80",
                shellChrome.pill,
              )}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
