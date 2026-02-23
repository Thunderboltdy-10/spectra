"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  GraduationCap,
  CircleHelp,
  Layers,
  Search,
  Sparkles,
  Eye,
  Headphones,
  BookOpen,
  Zap,
  Target,
  MessageSquare,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// StepContainer
// ---------------------------------------------------------------------------

type StepContainerProps = {
  children: React.ReactNode;
  className?: string;
};

export function StepContainer({ children, className }: StepContainerProps) {
  return (
    <div
      className={cn(
        "animate-[onboarding-step-in_320ms_cubic-bezier(0.22,1,0.36,1)_both]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RadioCard & RadioCardGroup
// ---------------------------------------------------------------------------

export type RadioOption = {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
};

type RadioCardGroupProps = {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  columns?: 2 | 3 | 4;
};

export function RadioCardGroup({
  options,
  value,
  onChange,
  columns = 2,
}: RadioCardGroupProps) {
  const colClass =
    columns === 4
      ? "grid-cols-2 sm:grid-cols-4"
      : columns === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2";

  return (
    <div className={cn("grid gap-3", colClass)}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "group cursor-pointer rounded-xl border px-4 py-4 text-left transition-all duration-200",
              "hover:shadow-[var(--shadow-card)]",
              selected
                ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-elevated))] shadow-[0_0_0_2px_color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
                : "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] hover:border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))]",
            )}
          >
            <div className="flex items-start gap-3">
              {option.icon && (
                <span
                  className={cn(
                    "mt-0.5 flex-shrink-0 transition-colors duration-200",
                    selected
                      ? "text-[var(--accent-cyan)]"
                      : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]",
                  )}
                >
                  {option.icon}
                </span>
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-semibold leading-snug transition-colors duration-200",
                    selected
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-primary)]",
                  )}
                >
                  {option.label}
                </p>
                {option.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {option.description}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  "ml-auto mt-0.5 flex-shrink-0 h-4 w-4 rounded-full border-2 transition-all duration-200",
                  selected
                    ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan)]"
                    : "border-[var(--border-default)]",
                )}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChipInput
// ---------------------------------------------------------------------------

type ChipInputProps = {
  chips: string[];
  onChange: (chips: string[]) => void;
  placeholder?: string;
  maxChips?: number;
};

export function ChipInput({
  chips,
  onChange,
  placeholder = "Type and press Enter...",
  maxChips = 20,
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addChip(raw: string) {
    const value = raw.trim();
    if (!value || chips.includes(value) || chips.length >= maxChips) return;
    onChange([...chips, value]);
    setInputValue("");
  }

  function removeChip(index: number) {
    const next = chips.filter((_, i) => i !== index);
    onChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addChip(inputValue);
    } else if (event.key === "Backspace" && !inputValue && chips.length > 0) {
      removeChip(chips.length - 1);
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex min-h-[3rem] cursor-text flex-wrap gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5 transition-colors duration-150 focus-within:border-[var(--accent-cyan)] focus-within:shadow-[0_0_0_2px_color-mix(in_oklab,var(--accent-cyan)_25%,transparent)]"
    >
      {chips.map((chip, index) => (
        <span
          key={`${chip}-${index}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_15%,var(--bg-secondary))] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-cyan)] ring-1 ring-[color-mix(in_oklab,var(--accent-cyan)_30%,transparent)]"
        >
          {chip}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              removeChip(index);
            }}
            className="cursor-pointer rounded-full opacity-70 transition-opacity hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) addChip(inputValue);
        }}
        placeholder={chips.length === 0 ? placeholder : "Add more..."}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModeShowcase
// ---------------------------------------------------------------------------

type ModeCard = {
  icon: React.ReactNode;
  label: string;
  description: string;
  color: string;
  delay: number;
};

const SHOWCASE_MODES: ModeCard[] = [
  {
    icon: <GraduationCap className="h-6 w-6" />,
    label: "Tutor",
    description: "Get personalized explanations via Socratic discovery",
    color: "#3b82f6",
    delay: 0,
  },
  {
    icon: <CircleHelp className="h-6 w-6" />,
    label: "Quiz",
    description: "Test your knowledge with active recall checkpoints",
    color: "#10b981",
    delay: 60,
  },
  {
    icon: <Layers className="h-6 w-6" />,
    label: "Flashcards",
    description: "Memorize with spaced repetition and dual-coding",
    color: "#06b6d4",
    delay: 120,
  },
  {
    icon: <Search className="h-6 w-6" />,
    label: "Research",
    description: "Deep dive with evidence synthesis and source evaluation",
    color: "#6366f1",
    delay: 180,
  },
  {
    icon: <Sparkles className="h-6 w-6" />,
    label: "Auto Mode",
    description: "Let AI pick the best mode for every message you send",
    color: "#ec4899",
    delay: 240,
  },
];

export function ModeShowcase() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SHOWCASE_MODES.map((mode, index) => (
          <div
            key={mode.label}
            style={
              {
                animationDelay: `${mode.delay}ms`,
                "--mode-color": mode.color,
              } as React.CSSProperties
            }
            className={cn(
              "card-entrance rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4",
              "hover:shadow-[var(--shadow-hover)] hover:-translate-y-0.5 transition-all duration-200",
              index === 4 && "sm:col-span-2 lg:col-span-1",
            )}
          >
            <div
              className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: `color-mix(in oklab, ${mode.color} 18%, var(--bg-secondary))` }}
            >
              <span style={{ color: mode.color }}>{mode.icon}</span>
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{mode.label}</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {mode.description}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Quick Command Palette
        </p>
        <p className="mt-1 text-sm text-[var(--text-primary)]">
          Open global search and actions anytime with{" "}
          <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-xs">
            Cmd + K
          </kbd>{" "}
          or{" "}
          <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-xs">
            Ctrl + K
          </kbd>
          .
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Predefined option sets
// ---------------------------------------------------------------------------

export const LEARNING_STYLE_OPTIONS: RadioOption[] = [
  {
    value: "visual",
    label: "Visual",
    description: "Learn through diagrams, charts, and visual representations",
    icon: <Eye className="h-4 w-4" />,
  },
  {
    value: "auditory",
    label: "Auditory",
    description: "Learn through discussion, explanation, and verbal reasoning",
    icon: <Headphones className="h-4 w-4" />,
  },
  {
    value: "reading",
    label: "Reading / Writing",
    description: "Learn through reading and taking structured notes",
    icon: <BookOpen className="h-4 w-4" />,
  },
  {
    value: "kinesthetic",
    label: "Kinesthetic",
    description: "Learn by doing — examples, practice problems, and projects",
    icon: <Zap className="h-4 w-4" />,
  },
];

export const DIFFICULTY_OPTIONS: RadioOption[] = [
  {
    value: "easy",
    label: "Easy",
    description: "Keep it simple and approachable",
    icon: <span className="text-base">🌱</span>,
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced challenge, suitable for most topics",
    icon: <span className="text-base">🔥</span>,
  },
  {
    value: "hard",
    label: "Hard",
    description: "Push deeper with rigorous explanations",
    icon: <span className="text-base">⚡</span>,
  },
  {
    value: "challenge",
    label: "Challenge Me",
    description: "Maximum depth — assume I want to be stretched",
    icon: <Target className="h-4 w-4" />,
  },
];

export const COMMUNICATION_STYLE_OPTIONS: RadioOption[] = [
  {
    value: "brief",
    label: "Brief",
    description: "Short, punchy answers — get to the point",
    icon: <span className="text-base">⚡</span>,
  },
  {
    value: "detailed",
    label: "Detailed",
    description: "Full explanations with context and examples",
    icon: <BookOpen className="h-4 w-4" />,
  },
  {
    value: "step_by_step",
    label: "Step-by-step",
    description: "Walk me through each stage methodically",
    icon: <span className="text-base">📋</span>,
  },
  {
    value: "conversational",
    label: "Conversational",
    description: "Casual tone, like chatting with a tutor",
    icon: <MessageSquare className="h-4 w-4" />,
  },
];
