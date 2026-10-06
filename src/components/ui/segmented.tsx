"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string; disabled?: boolean };

/**
 * One choice among a few, all visible (LANGUAGE.md, "Actions"): Auto, Manual,
 * Off; Current, Past, All. A radio group: arrow keys move the choice.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "default",
  disabled = false,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** The group's accessible name. */
  label: string;
  size?: "compact" | "default";
  disabled?: boolean;
  className?: string;
}) {
  const refs = React.useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((option) => !option.disabled);
  function move(by: number) {
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[(index + by + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5",
        disabled && "opacity-45",
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) refs.current.set(option.value, node);
              else refs.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") move(1);
              else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(-1);
              else return;
              event.preventDefault();
            }}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-chip font-medium outline-none",
              "transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:cursor-not-allowed",
              size === "compact" ? "h-6 px-2 text-micro" : "h-7 px-2.5 text-caption",
              checked
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] ring-1 ring-[var(--border-default)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
