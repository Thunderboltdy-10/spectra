"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";
import { StudyTimer } from "@/components/study-timer";
import { Clock3 } from "lucide-react";

export function TimerWidget({ className }: { className?: string }) {
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
        "flex items-center gap-2 rounded-[16px] border px-3 h-11 min-w-[44px]",
        "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "transition-all duration-200 ease-[var(--ease-standard)] cursor-pointer hover:bg-[var(--bg-hover)]",
        timerState?.isRunning &&
          "border-[color-mix(in_oklab,var(--accent-cyan)_22%,var(--border-default))]",
      )}
      style={{
        boxShadow: "0 8px 22px -16px rgba(8,22,40,0.14)",
      }}
    >
      {/* Phase dot indicator */}
      {timerState?.isRunning && (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: phaseColor,
            boxShadow: `0 0 6px ${phaseColor}`,
          }}
        />
      )}
      <Clock3
        className={cn(
          "h-4.5 w-4.5 shrink-0 transition-colors",
          timerState?.isRunning ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
        )}
      />
      {timerState ? (
        <div className="flex flex-col justify-center w-[42px] gap-[3px] shrink-0">
          <span className="font-mono text-[11px] font-bold tabular-nums text-[var(--text-primary)] leading-none text-center">
            {timerState.display}
          </span>
          <div className="h-[2.5px] w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]">
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
      onToggleLock={handleToggleLock}
      className={cn(
        "!left-auto !right-6 !translate-x-0 !bottom-6 z-[100]",
        className,
      )}
      expandedClassName="right-0 bottom-0"
    >
      <div className="pointer-events-auto w-[340px] p-2">
        <StudyTimer
          open={true}
          onOpen={() => {}}
          onClose={() => setLocked(false)}
        />
      </div>
    </HubSurface>
  );
}
