"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { HubSurface } from "@/components/workspace/hub-surface";
import { StudyTimer } from "@/components/study-timer";
import { Clock3 } from "lucide-react";

export function TimerWidget({ className }: { className?: string }) {
  const [locked, setLocked] = useState(false);
  const [timerState, setTimerState] = useState<{display: string, isRunning: boolean, progress: number, phase?: string} | null>(null);

  useEffect(() => {
    const handleTimerState = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setTimerState(customEvent.detail);
      }
    };
    window.addEventListener("ai-school:timer-state", handleTimerState);
    return () => window.removeEventListener("ai-school:timer-state", handleTimerState);
  }, []);

  const collapsed = (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[20px] border px-3 h-10 min-w-10",
        "border-[var(--border-default)]/45 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "transition-all duration-200 ease-[var(--ease-standard)] cursor-pointer hover:bg-[var(--bg-hover)]",
        timerState?.isRunning && "border-[color-mix(in_oklab,var(--accent-cyan)_22%,var(--border-default))]",
      )}
      style={{
        boxShadow: "0 8px 22px -16px rgba(8,22,40,0.14)",
      }}
      onClick={() => setLocked(!locked)}
    >
      <Clock3 className={cn("h-4 w-4 shrink-0 transition-colors", timerState?.isRunning ? (timerState.phase === 'work' ? "text-[var(--accent-cyan)]" : "text-[var(--success)]") : "text-[var(--text-secondary)]")} />
      {timerState && (
        <div className="flex flex-col justify-center mt-0.5 w-[38px] gap-1 shrink-0">
          <span className="font-mono text-[11px] font-semibold tabular-nums text-[var(--text-primary)] leading-none text-center">
            {timerState.display}
          </span>
          <div className="h-[2px] w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                timerState.isRunning ? (timerState.phase === 'work' ? "bg-[var(--accent-cyan)]" : "bg-[var(--success)]") : "bg-[var(--text-tertiary)]"
              )}
              style={{ width: `${timerState.progress * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <HubSurface
      id="workspace-timer"
      edge="bottom"
      collapsed={collapsed}
      locked={locked}
      onToggleLock={() => setLocked((value) => !value)}
      className={cn("left-auto right-6 translate-x-0 z-[100]", className)}
      expandedClassName="right-0 bottom-0"
    >
      <div 
        className="flex flex-col items-end p-2 pointer-events-auto w-[340px]"
      >
        <StudyTimer 
          open={true} 
          onOpen={() => {}} 
          onClose={() => setLocked(false)} 
        />
      </div>
    </HubSurface>
  );
}
