"use client";

import { useEffect, useRef, useState } from "react";
import {
  GraduationCap,
  ClipboardCheck,
  Timer,
  PenLine,
  CircleHelp,
  Layers,
  Search,
  Lightbulb,
  MessageCircle,
  ImagePlus,
  Sparkles,
  X,
} from "lucide-react";
import { ALL_MODES, COMING_SOON_MODES, getModeConfig, isModeAvailable } from "@/lib/modes";
import type { StudyMode } from "@/types";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  GraduationCap,
  ClipboardCheck,
  Timer,
  PenLine,
  CircleHelp,
  Layers,
  Search,
  Lightbulb,
  MessageCircle,
  ImagePlus,
  Sparkles,
};

type ChatModeSelectorProps = {
  mode: StudyMode;
  onChange: (mode: StudyMode) => void;
  compact?: boolean;
};

export function ChatModeSelector({ mode, onChange, compact = false }: ChatModeSelectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Listen for Cmd/Ctrl+K custom event dispatched from use-chat-state
  useEffect(() => {
    const handler = () => setPickerOpen((prev) => !prev);
    window.addEventListener("ai-school:toggle-mode-picker", handler);
    return () => window.removeEventListener("ai-school:toggle-mode-picker", handler);
  }, []);

  // Close picker when clicking outside
  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  // Close picker on Escape
  useEffect(() => {
    if (!pickerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pickerOpen]);

  function handleSelect(newMode: StudyMode) {
    if (!isModeAvailable(newMode)) return;
    onChange(newMode);
    setPickerOpen(false);
  }

  return (
    <>
      {/* Inline mode pills (existing row) */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {ALL_MODES.map((m) => {
          const active = mode === m.key;
          const Icon = ICON_MAP[m.icon];
          const isAuto = m.key === "auto";
          const available = isModeAvailable(m.key);
          const comingSoon = COMING_SOON_MODES.has(m.key);
          return (
            <button
              key={m.key}
              type="button"
              disabled={!available}
              onClick={() => {
                if (!available) return;
                onChange(m.key);
              }}
              title={m.description}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-medium transition ${
                active && isAuto
                  ? "border-transparent text-white"
                  : active
                    ? "border-transparent text-white"
                    : isAuto
                      ? "border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                      : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              } ${available ? "cursor-pointer" : "cursor-not-allowed opacity-40 pointer-events-none"}`}
              style={
                active && isAuto
                  ? { background: "linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)" }
                  : active
                    ? { backgroundColor: m.color }
                    : undefined
              }
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {!compact && <span>{m.label}</span>}
              {comingSoon ? (
                <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                  Soon
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Keyboard-triggered mode picker overlay (Cmd/Ctrl+K) */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div
            ref={pickerRef}
            className="w-full max-w-md rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-overlay)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Switch mode</p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  Press{" "}
                  <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5 font-mono text-[10px]">
                    Cmd
                  </kbd>
                  {" + "}
                  <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5 font-mono text-[10px]">
                    K
                  </kbd>{" "}
                  to toggle
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--border-default)] p-1 text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_MODES.map((m) => {
                const active = mode === m.key;
                const Icon = ICON_MAP[m.icon];
                const isAuto = m.key === "auto";
                const available = isModeAvailable(m.key);
                const comingSoon = COMING_SOON_MODES.has(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    disabled={!available}
                    onClick={() => handleSelect(m.key)}
                    title={m.description}
                    className={`flex items-center gap-2 rounded-[var(--radius-input)] border px-3 py-2.5 text-left text-sm transition ${
                      active
                        ? "border-transparent text-white"
                        : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    } ${available ? "cursor-pointer" : "cursor-not-allowed opacity-40 pointer-events-none"}`}
                    style={
                      active && isAuto
                        ? { background: "linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)" }
                        : active
                          ? { backgroundColor: m.color }
                          : undefined
                    }
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0" />}
                    <span className="font-medium">{m.label}</span>
                    {comingSoon ? (
                      <span className="ml-auto rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        Coming soon
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ModeBadge({ mode }: { mode: StudyMode }) {
  const config = getModeConfig(mode);
  const Icon = ICON_MAP[config.icon];
  const isGradient = config.color.includes("gradient") || config.color.includes("linear");
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-medium text-white"
      style={isGradient ? { background: config.color } : { backgroundColor: config.color }}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {config.label}
    </span>
  );
}
