"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Pause, Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ai-school-study-timer-v2";
const SESSIONS_STORAGE_KEY = "ai-school:timer-sessions";
const MAX_STORED_SESSIONS = 100;
const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;
const MIN_WORK_MINUTES = 5;
const MAX_WORK_MINUTES = 120;
const MIN_BREAK_MINUTES = 1;
const MAX_BREAK_MINUTES = 45;

type StudyTimerProps = {
  chatId?: string;
  className?: string;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
};

type TimerPhase = "work" | "break";

type PersistedTimerState = {
  phase: TimerPhase;
  remainingMs: number;
  isRunning: boolean;
  phaseEndAt: number | null;
  phaseStartedAt: number | null;
  completedSessions: number;
  workMinutes: number;
  breakMinutes: number;
  workColor: string;
  breakColor: string;
};

function clampMinutes(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function phaseDurationMs(phase: TimerPhase, workMinutes: number, breakMinutes: number) {
  return (phase === "work" ? workMinutes : breakMinutes) * 60 * 1000;
}

function formatRemaining(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function nextPhase(phase: TimerPhase): TimerPhase {
  return phase === "work" ? "break" : "work";
}

type CompletedTimerSession = {
  completedAt: string;
  durationMinutes: number;
  durationSeconds?: number;
};

function persistCompletedSession(totalSeconds: number): void {
  try {
    const raw = window.localStorage.getItem(SESSIONS_STORAGE_KEY);
    const existing: CompletedTimerSession[] = raw ? (JSON.parse(raw) as CompletedTimerSession[]) : [];
    const safeSeconds = Math.max(60, Math.round(totalSeconds));
    const entry: CompletedTimerSession = {
      completedAt: new Date().toISOString(),
      durationMinutes: Number((safeSeconds / 60).toFixed(2)),
      durationSeconds: safeSeconds,
    };
    // Append new session and keep only the most recent MAX_STORED_SESSIONS entries.
    const updated = [...existing, entry].slice(-MAX_STORED_SESSIONS);
    window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage can fail in private browsing contexts — silently skip.
  }
}

function readPersistedState(): PersistedTimerState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTimerState>;
    if (!parsed || typeof parsed !== "object") return null;

    const phase: TimerPhase = parsed.phase === "break" ? "break" : "work";
    const workMinutes = clampMinutes(parsed.workMinutes ?? DEFAULT_WORK_MINUTES, MIN_WORK_MINUTES, MAX_WORK_MINUTES);
    const breakMinutes = clampMinutes(parsed.breakMinutes ?? DEFAULT_BREAK_MINUTES, MIN_BREAK_MINUTES, MAX_BREAK_MINUTES);
    let completedSessions = Number.isFinite(parsed.completedSessions)
      ? Math.max(0, Math.floor(parsed.completedSessions as number))
      : 0;

    const now = Date.now();
    const durationFor = (candidatePhase: TimerPhase) => phaseDurationMs(candidatePhase, workMinutes, breakMinutes);

    let restoredPhase: TimerPhase = phase;
    let remainingMs = Number.isFinite(parsed.remainingMs) ? Math.max(0, Number(parsed.remainingMs)) : durationFor(phase);
    let isRunning = Boolean(parsed.isRunning);
    let phaseEndAt = Number.isFinite(parsed.phaseEndAt) ? Number(parsed.phaseEndAt) : null;
    let phaseTransitionedDuringRestore = false;

    if (isRunning && phaseEndAt) {
      let delta = phaseEndAt - now;
      while (delta <= 0) {
        phaseTransitionedDuringRestore = true;
        if (restoredPhase === "work") {
          completedSessions += 1;
        }
        restoredPhase = nextPhase(restoredPhase);
        delta += durationFor(restoredPhase);
      }
      remainingMs = delta;
      phaseEndAt = now + delta;
    } else {
      isRunning = false;
      phaseEndAt = null;
      remainingMs = Math.min(remainingMs, durationFor(restoredPhase));
    }

    const duration = durationFor(restoredPhase);
    const phaseStartedAtFromStorage = Number.isFinite(parsed.phaseStartedAt)
      ? Math.min(now, Math.max(0, Number(parsed.phaseStartedAt)))
      : null;
    const phaseStartedAt = isRunning
      ? (
        phaseStartedAtFromStorage !== null && !phaseTransitionedDuringRestore
          ? phaseStartedAtFromStorage
          : now - Math.max(0, duration - remainingMs)
      )
      : phaseStartedAtFromStorage;

    return {
      phase: restoredPhase,
      remainingMs,
      isRunning,
      phaseEndAt,
      phaseStartedAt,
      completedSessions,
      workMinutes,
      breakMinutes,
      workColor: typeof parsed.workColor === "string" ? parsed.workColor : "#06b6d4", // Default to cyan-500 equivalent
      breakColor: typeof parsed.breakColor === "string" ? parsed.breakColor : "#22c55e", // Default to green-500 equivalent
    };
  } catch {
    return null;
  }
}

function getInitialTimerState(): PersistedTimerState {
  return {
    phase: "work",
    remainingMs: DEFAULT_WORK_MINUTES * 60 * 1000,
    isRunning: false,
    phaseEndAt: null,
    phaseStartedAt: null,
    completedSessions: 0,
    workMinutes: DEFAULT_WORK_MINUTES,
    breakMinutes: DEFAULT_BREAK_MINUTES,
    workColor: "#06b6d4",
    breakColor: "#22c55e",
  };
}


export function StudyTimer({ chatId, className, open, onClose, onOpen }: StudyTimerProps) {
  const initialState = useMemo(getInitialTimerState, []);
  const [phase, setPhase] = useState<TimerPhase>(initialState.phase);
  const [workMinutes, setWorkMinutes] = useState(initialState.workMinutes);
  const [breakMinutes, setBreakMinutes] = useState(initialState.breakMinutes);
  const [workColor, setWorkColor] = useState(initialState.workColor);
  const [breakColor, setBreakColor] = useState(initialState.breakColor);
  const [remainingMs, setRemainingMs] = useState<number>(initialState.remainingMs);
  const [isRunning, setIsRunning] = useState(initialState.isRunning);
  const [phaseEndAt, setPhaseEndAt] = useState<number | null>(initialState.phaseEndAt);
  const [phaseStartedAt, setPhaseStartedAt] = useState<number | null>(initialState.phaseStartedAt);
  const [completedSessions, setCompletedSessions] = useState(initialState.completedSessions);
  const [controlFlash, setControlFlash] = useState<"start" | "pause" | null>(null);
  const hydratedRef = useRef(false);
  const transitionLockRef = useRef(false);

  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const display = formatRemaining(remainingSeconds);
  const duration = phaseDurationMs(phase, workMinutes, breakMinutes);
  const progress = Math.min(1, Math.max(0, 1 - (remainingMs / duration)));

  // Timer state is local only — workspace integration removed

  useEffect(() => {
    const handleStart = () => setIsRunning(true);
    const handlePause = () => setIsRunning(false);
    const handleReset = () => {
      setIsRunning(false);
      setRemainingMs(phaseDurationMs(phase, workMinutes, breakMinutes));
    };
    window.addEventListener("ai-school:timer-start", handleStart);
    window.addEventListener("ai-school:timer-pause", handlePause);
    window.addEventListener("ai-school:timer-reset", handleReset);
    return () => {
      window.removeEventListener("ai-school:timer-start", handleStart);
      window.removeEventListener("ai-school:timer-pause", handlePause);
      window.removeEventListener("ai-school:timer-reset", handleReset);
    };
  }, [phase, workMinutes, breakMinutes]);

  const phaseLabel = useMemo(
    () => (phase === "work" ? "Focus session" : "Break session"),
    [phase],
  );
  const showMiniIndicator = !open && (isRunning || remainingMs < duration);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("ai-school:timer-state", {
        detail: {
          display,
          isRunning,
          progress,
          phase
        },
      }),
    );
  }, [display, isRunning, progress, phase]);

  useEffect(() => {
    const restored = readPersistedState();
    if (restored) {
      setPhase(restored.phase);
      setWorkMinutes(restored.workMinutes);
      setBreakMinutes(restored.breakMinutes);
      setWorkColor(restored.workColor);
      setBreakColor(restored.breakColor);
      setRemainingMs(restored.remainingMs);
      setIsRunning(restored.isRunning);
      setPhaseEndAt(restored.phaseEndAt);
      setPhaseStartedAt(restored.phaseStartedAt);
      setCompletedSessions(restored.completedSessions);
    }
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const payload: PersistedTimerState = {
      phase,
      remainingMs,
      isRunning,
      phaseEndAt,
      phaseStartedAt,
      completedSessions,
      workMinutes,
      breakMinutes,
      workColor,
      breakColor,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can fail in private browsing contexts.
    }
  }, [phase, remainingMs, isRunning, phaseEndAt, phaseStartedAt, completedSessions, workMinutes, breakMinutes, workColor, breakColor]);

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

    try {
      const now = Date.now();
      const endedPhase = phase;
      const fallbackStartedAt = now - phaseDurationMs(endedPhase, workMinutes, breakMinutes);
      const measuredStartedAt = Math.min(
        now,
        Math.max(0, Math.round(phaseStartedAt ?? fallbackStartedAt)),
      );
      const measuredElapsedSeconds = Math.max(60, Math.round((now - measuredStartedAt) / 1000));

      playTransitionTone();

      if (endedPhase === "work") {
        await logCompletedSession({
          startedAt: measuredStartedAt,
          endedAt: now,
          totalSeconds: measuredElapsedSeconds,
        });
        persistCompletedSession(measuredElapsedSeconds);
        setCompletedSessions((prev) => prev + 1);
        toast.success("Focus block complete. Starting a short break.");
        const nextDuration = phaseDurationMs("break", workMinutes, breakMinutes);
        setPhase("break");
        setRemainingMs(nextDuration);
        setIsRunning(true);
        setPhaseStartedAt(now);
        setPhaseEndAt(now + nextDuration);
        return;
      }

      toast.message("Break complete. Starting the next focus block.");
      const nextDuration = phaseDurationMs("work", workMinutes, breakMinutes);
      setPhase("work");
      setRemainingMs(nextDuration);
      setIsRunning(true);
      setPhaseStartedAt(now);
      setPhaseEndAt(now + nextDuration);
    } finally {
      transitionLockRef.current = false;
    }
  }, [breakMinutes, logCompletedSession, phase, phaseStartedAt, workMinutes]);

  function handleStartPause() {
    if (isRunning) {
      const now = Date.now();
      const nextRemaining = Math.max(0, (phaseEndAt ?? now) - now);
      setRemainingMs(nextRemaining);
      setIsRunning(false);
      setPhaseEndAt(null);
      setControlFlash("pause");
      return;
    }

    const now = Date.now();
    setIsRunning(true);
    setPhaseEndAt(now + remainingMs);
    setPhaseStartedAt((prev) => prev ?? now - Math.max(0, duration - remainingMs));
    setControlFlash("start");
  }

  function handleReset() {
    const resetDuration = phaseDurationMs(phase, workMinutes, breakMinutes);
    setIsRunning(false);
    setRemainingMs(resetDuration);
    setPhaseEndAt(null);
    setPhaseStartedAt(null);
  }

  function handleWorkMinutesChange(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const next = clampMinutes(parsed, MIN_WORK_MINUTES, MAX_WORK_MINUTES);
    setWorkMinutes(next);
    if (!isRunning && phase === "work") {
      setRemainingMs(phaseDurationMs("work", next, breakMinutes));
      setPhaseStartedAt(null);
    }
  }

  function handleBreakMinutesChange(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const next = clampMinutes(parsed, MIN_BREAK_MINUTES, MAX_BREAK_MINUTES);
    setBreakMinutes(next);
    if (!isRunning && phase === "break") {
      setRemainingMs(phaseDurationMs("break", workMinutes, next));
      setPhaseStartedAt(null);
    }
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

  useEffect(() => {
    if (!controlFlash) return;
    const timer = window.setTimeout(() => setControlFlash(null), 750);
    return () => window.clearTimeout(timer);
  }, [controlFlash]);

  if (!open && !showMiniIndicator) {
    return null;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--text-primary)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--bg-hover)]",
          className,
        )}
        aria-label="Open study timer"
      >
        <Clock3 className="h-3.5 w-3.5" />
        <span>{phase === "work" ? "Focus" : "Break"}</span>
        <span className="font-semibold">{display}</span>
      </button>
    );
  }

  const phaseColor = phase === "work" ? workColor : breakColor;

  return (
    <div
      className={cn(
        "w-full max-w-[340px] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: phaseColor, boxShadow: isRunning ? `0 0 6px ${phaseColor}` : "none" }}
          />
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">{phaseLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close study timer"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Large time display */}
      <div className="mb-1 text-center">
        <p
          className="font-display text-5xl font-semibold leading-none tracking-tight text-[var(--text-primary)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {display}
        </p>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {completedSessions > 0 ? `${completedSessions} session${completedSessions !== 1 ? "s" : ""} completed` : "Ready to focus"}
        </p>
      </div>

      {/* Linear progress bar with remaining time */}
      {isRunning ? (
        <div className="my-4 flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
            {formatRemaining(Math.floor((duration - remainingMs) / 1000))}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.round(progress * 100)}%`,
                background: `linear-gradient(90deg, ${phaseColor}, color-mix(in oklab, ${phaseColor} 72%, #fff))`,
              }}
            />
          </div>
          <span
            className="shrink-0 text-[11px] font-semibold tabular-nums"
            style={{ color: phaseColor }}
          >
            {display}
          </span>
        </div>
      ) : null}

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={cn("h-10 w-10 rounded-xl transition", controlFlash && "animate-subtle-pulse")}
          onClick={handleStartPause}
          aria-label={isRunning ? "Pause" : "Start"}
        >
          {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-xl text-[var(--text-secondary)]"
          onClick={handleReset}
          aria-label="Reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Duration adjusters */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="rounded-xl bg-[var(--bg-secondary)] px-2.5 py-2">
          <span className="mb-0.5 block text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">Focus</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_WORK_MINUTES}
              max={MAX_WORK_MINUTES}
              value={workMinutes}
              onChange={(event) => handleWorkMinutesChange(event.target.value)}
              className="w-full appearance-none bg-transparent text-sm font-semibold outline-none [appearance:textfield]"
            />
            <input
              type="color"
              value={workColor}
              onChange={(e) => setWorkColor(e.target.value)}
              className="h-5 w-5 shrink-0 cursor-pointer rounded-full border border-[var(--border-default)] p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
              title="Focus color"
            />
          </div>
        </label>
        <label className="rounded-xl bg-[var(--bg-secondary)] px-2.5 py-2">
          <span className="mb-0.5 block text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">Break</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_BREAK_MINUTES}
              max={MAX_BREAK_MINUTES}
              value={breakMinutes}
              onChange={(event) => handleBreakMinutesChange(event.target.value)}
              className="w-full appearance-none bg-transparent text-sm font-semibold outline-none [appearance:textfield]"
            />
            <input
              type="color"
              value={breakColor}
              onChange={(e) => setBreakColor(e.target.value)}
              className="h-5 w-5 shrink-0 cursor-pointer rounded-full border border-[var(--border-default)] p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none"
              title="Break color"
            />
          </div>
        </label>
      </div>
      {isRunning ? (
        <p className="mt-2 text-[10px] text-[var(--text-secondary)]">Duration updates apply after reset or next phase.</p>
      ) : null}
    </div>
  );
}
