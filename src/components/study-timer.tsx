"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Pause, Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WORK_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const WORK_MS = WORK_SECONDS * 1000;
const BREAK_MS = BREAK_SECONDS * 1000;

type StudyTimerProps = {
  chatId?: string;
  className?: string;
  onClose: () => void;
};

type TimerPhase = "work" | "break";

function phaseDurationMs(phase: TimerPhase) {
  return phase === "work" ? WORK_MS : BREAK_MS;
}

function formatRemaining(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

export function StudyTimer({ chatId, className, onClose }: StudyTimerProps) {
  const [phase, setPhase] = useState<TimerPhase>("work");
  const [remainingMs, setRemainingMs] = useState<number>(WORK_MS);
  const [isRunning, setIsRunning] = useState(false);
  const [phaseEndAt, setPhaseEndAt] = useState<number | null>(null);
  const [completedSessions, setCompletedSessions] = useState(0);
  const transitionLockRef = useRef(false);

  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const display = formatRemaining(remainingSeconds);
  const duration = phaseDurationMs(phase);
  const progress = Math.min(1, Math.max(0, 1 - (remainingMs / duration)));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - progress);

  const phaseLabel = useMemo(
    () => (phase === "work" ? "Focus session" : "Break session"),
    [phase],
  );

  function playTransitionTone() {
    try {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(780, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(540, context.currentTime + 0.22);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.04, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.25);
      void context.close().catch(() => {});
    } catch {
      // Audio is optional; silently skip if unavailable.
    }
  }

  const logCompletedSession = useCallback(async (params: { startedAt: number; endedAt: number; totalSeconds: number }) => {
    try {
      const response = await fetch("/api/gamification/timer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chatId,
          sessionType: "pomodoro",
          startedAt: params.startedAt,
          endedAt: params.endedAt,
          totalSeconds: params.totalSeconds,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    } catch {
      // Avoid interrupting timer flow for transient network issues.
    }
  }, [chatId]);

  const advancePhase = useCallback(async () => {
    if (transitionLockRef.current) return;
    transitionLockRef.current = true;

    const now = Date.now();
    const endedPhase = phase;

    playTransitionTone();

    if (endedPhase === "work") {
      const totalSeconds = WORK_SECONDS;
      await logCompletedSession({
        startedAt: now - WORK_MS,
        endedAt: now,
        totalSeconds,
      });
      setCompletedSessions((prev) => prev + 1);
      toast.success("Focus block complete. Starting a short break.");
      setPhase("break");
      setRemainingMs(BREAK_MS);
      setIsRunning(true);
      setPhaseEndAt(now + BREAK_MS);
      transitionLockRef.current = false;
      return;
    }

    toast.message("Break complete. Starting the next focus block.");
    setPhase("work");
    setRemainingMs(WORK_MS);
    setIsRunning(true);
    setPhaseEndAt(now + WORK_MS);
    transitionLockRef.current = false;
  }, [logCompletedSession, phase]);

  function handleStartPause() {
    if (isRunning) {
      const now = Date.now();
      const nextRemaining = Math.max(0, (phaseEndAt ?? now) - now);
      setRemainingMs(nextRemaining);
      setIsRunning(false);
      setPhaseEndAt(null);
      return;
    }

    const now = Date.now();
    setIsRunning(true);
    setPhaseEndAt(now + remainingMs);
  }

  function handleReset() {
    const resetDuration = phaseDurationMs(phase);
    setIsRunning(false);
    setRemainingMs(resetDuration);
    setPhaseEndAt(null);
  }

  useEffect(() => {
    if (!isRunning || !phaseEndAt) return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      const nextRemaining = Math.max(0, phaseEndAt - now);
      setRemainingMs(nextRemaining);
      if (nextRemaining <= 0) {
        window.clearInterval(interval);
        void advancePhase();
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [advancePhase, isRunning, phaseEndAt]);

  return (
    <div
      className={cn(
        "w-[320px] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            <Clock3 className="h-3.5 w-3.5" />
            Study timer
          </p>
          <h3 className="mt-1 text-sm font-semibold">{phaseLabel}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close study timer"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <div className="relative h-28 w-28 shrink-0">
          <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
            <circle
              cx="50"
              cy="50"
              r={radius}
              stroke="var(--border-default)"
              strokeWidth="6"
              fill="transparent"
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              stroke={phase === "work" ? "var(--accent-cyan)" : "var(--success)"}
              strokeWidth="6"
              fill="transparent"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
            />
          </svg>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-semibold">
            {display}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--text-secondary)]">
            {phase === "work" ? "Stay focused until the timer ends." : "Take a short reset before the next round."}
          </p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Completed sessions: <span className="font-semibold text-[var(--text-primary)]">{completedSessions}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={handleStartPause}>
          {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {isRunning ? "Pause" : "Start"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="col-span-2 gap-1.5"
          onClick={handleReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset current phase
        </Button>
      </div>
    </div>
  );
}
