"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";
import { StudyTimer } from "@/components/study-timer";
import { Clock3, Pause } from "lucide-react";

export function TimerWidget({ className, forceExpanded }: { className?: string; forceExpanded?: boolean }) {
  const [locked, setLocked] = useState(false);
  const [timerState, setTimerState] = useState<{
    display: string;
    isRunning: boolean;
    progress: number;
    phase?: string;
  } | null>(null);

  useEffect(() => {
    const handleTimerState = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setTimerState(customEvent.detail);
      }
    };
    window.addEventListener("ai-school:timer-state", handleTimerState);
    return () =>
      window.removeEventListener("ai-school:timer-state", handleTimerState);
  }, []);

  const handleToggleLock = useCallback(() => {
    setLocked((v) => !v);
  }, []);

  const phaseColor =
    timerState?.phase === "work"
      ? "var(--accent-cyan)"
      : timerState?.phase === "break"
        ? "var(--success)"
        : "var(--text-secondary)";

  const collapsed = (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[16px] border px-3.5 h-11 min-w-[48px]",
        "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "transition-all duration-200 ease-[var(--ease-standard)] cursor-pointer hover:bg-[var(--bg-hover)]",
        timerState?.isRunning &&
          "border-[color-mix(in_oklab,var(--accent-cyan)_22%,var(--border-default))]",
      )}
      style={{
        boxShadow: "0 8px 22px -16px rgba(8,22,40,0.14)",
      }}
    >
      {/* Phase dot */}
      {timerState?.isRunning && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full animate-pulse"
          style={{
            backgroundColor: phaseColor,
            boxShadow: `0 0 8px ${phaseColor}`,
          }}
        />
      )}

      {/* Timer icon or play/pause indicator */}
      {timerState?.isRunning ? (
        <Pause className="h-3.5 w-3.5 shrink-0 text-[var(--text-primary)]" />
      ) : (
        <Clock3 className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
      )}

      {/* Time display + progress bar always visible when timer active */}
      {timerState ? (
        <div className="flex flex-col justify-center gap-[3px] shrink-0 min-w-[48px]">
          <span className="font-mono text-[12px] font-bold tabular-nums text-[var(--text-primary)] leading-none text-center">
            {timerState.display}
          </span>
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${timerState.progress * 100}%`,
                backgroundColor: phaseColor,
              }}
            />
          </div>
        </div>
      ) : (
        <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
          Timer
        </span>
      )}
    </div>
  );

  return (
    <HubSurface
      id="workspace-timer"
      edge="bottom"
      collapsed={collapsed}
      locked={locked}
      forceExpanded={forceExpanded}
      onToggleLock={handleToggleLock}
      className={cn(
        "!left-auto !right-6 !translate-x-0 !bottom-6 z-[100]",
        className,
      )}
      expandedClassName="right-0 bottom-0"
    >
      <div className="pointer-events-auto w-[340px] overflow-hidden [&>*]:border-0 [&>*]:rounded-none">
        <StudyTimer
          open={true}
          onOpen={() => {}}
          onClose={() => setLocked(false)}
        />
      </div>
    </HubSurface>
  );
}
