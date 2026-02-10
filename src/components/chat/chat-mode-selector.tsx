"use client";

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
} from "lucide-react";
import { ALL_MODES, getModeConfig } from "@/lib/modes";
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
};

type ChatModeSelectorProps = {
  mode: StudyMode;
  onChange: (mode: StudyMode) => void;
  compact?: boolean;
};

export function ChatModeSelector({ mode, onChange, compact = false }: ChatModeSelectorProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {ALL_MODES.map((m) => {
        const active = mode === m.key;
        const Icon = ICON_MAP[m.icon];
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            title={m.description}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-medium transition ${
              active
                ? "border-transparent text-white"
                : "border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
            style={active ? { backgroundColor: m.color } : undefined}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {!compact && <span>{m.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ModeBadge({ mode }: { mode: StudyMode }) {
  const config = getModeConfig(mode);
  const Icon = ICON_MAP[config.icon];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-medium text-white"
      style={{ backgroundColor: config.color }}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {config.label}
    </span>
  );
}
