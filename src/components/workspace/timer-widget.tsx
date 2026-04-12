"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";

const DEFAULT_WORK_MINUTES = 40;
const DEFAULT_BREAK_MINUTES = 5;

type TimerPhase = "work" | "break";

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function TimerWidget({ className }: { className?: string }) {
  const [locked, setLocked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<TimerPhase>("work");
  const [isRunning, setIsRunning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(DEFAULT_WORK_MINUTES * 60);
  const [completedSessions, setCompletedSessions] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalDuration = (phase === "work" ? DEFAULT_WORK_MINUTES : DEFAULT_BREAK_MINUTES) * 60;
  const progress = 1 - remainingSeconds / totalDuration;
  const phaseColor = phase === "work" ? "var(--accent-cyan)" : "var(--accent-mint)";

  useEffect(() => {
    if (!isRunning) return undefined;
    intervalRef.current = setInterval(() => {
      setRemainingSeconds((previous) => {
        if (previous <= 1) {
          setIsRunning(false);
          if (phase === "work") {
            setCompletedSessions((count) => count + 1);
            setPhase("break");
            return DEFAULT_BREAK_MINUTES * 60;
          }
          setPhase("work");
          return DEFAULT_WORK_MINUTES * 60;
        }
        return previous - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, phase]);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    setPhase("work");
    setRemainingSeconds(DEFAULT_WORK_MINUTES * 60);
  }, []);

  const collapsed = (
    <button
      type="button"
      onClick={() => setExpanded((open) => !open)}
      className={cn(
        "flex items-center gap-2 rounded-[16px] border px-3 py-2",
        "border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "transition-all duration-200 ease-[var(--ease-standard)]",
        isRunning && "border-[color-mix(in_oklab,var(--accent-cyan)_22%,var(--border-default))]",
      )}
      style={{
        boxShadow: "0 8px 22px -16px rgba(8,22,40,0.14)",
      }}
    >
      <div className="relative h-5 w-5">
        <svg className="-rotate-90 h-5 w-5" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--bg-tertiary)" strokeWidth="2" />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke={phaseColor}
            strokeWidth="2"
            strokeDasharray={`${progress * 50.27} 50.27`}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
      </div>
      <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">
        {formatTime(remainingSeconds)}
      </span>
      {expanded ? (
        <ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" />
      ) : (
        <ChevronUp className="h-3 w-3 text-[var(--text-tertiary)]" />
      )}
    </button>
  );

  return (
    <HubSurface
      id="workspace-timer"
      edge="bottom"
      collapsed={collapsed}
      locked={locked}
      onToggleLock={() => setLocked((value) => !value)}
      className={cn("left-auto right-6 translate-x-0", className)}
      expandedClassName="right-0 bottom-0"
    >
      <div className="flex flex-col items-end gap-2 p-2">
      {expanded && (
        <div
          className="flex w-[196px] flex-col gap-3 rounded-[20px] border border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/95 p-4 backdrop-blur-xl"
          style={{ boxShadow: "0 14px 36px -22px rgba(8,22,40,0.20)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              {phase === "work" ? "Study Focus" : "Break"}
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)]/50">
              {DEFAULT_WORK_MINUTES}/{DEFAULT_BREAK_MINUTES}m
            </span>
          </div>

          <div className="text-center">
            <span
              className="font-mono text-[28px] font-bold tracking-tight"
              style={{ color: phaseColor }}
            >
              {formatTime(remainingSeconds)}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${progress * 100}%`, backgroundColor: phaseColor }}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--bg-secondary)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsRunning((running) => !running)}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white transition-transform duration-150 hover:scale-[1.02]"
              style={{
                backgroundColor: phaseColor,
                boxShadow: `0 8px 18px -10px color-mix(in oklab, ${phaseColor} 50%, transparent)`,
              }}
            >
              {isRunning ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
          </div>

          {completedSessions > 0 && (
            <div className="text-center text-[10px] text-[var(--text-tertiary)]/60">
              {completedSessions} session{completedSessions === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}
      </div>
    </HubSurface>
  );
}
