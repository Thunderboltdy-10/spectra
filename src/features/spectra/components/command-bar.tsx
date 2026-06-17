"use client";

import { ArrowUp, Paperclip, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type CommandBarProps = {
  contextLabel: string;
  placeholder: string;
  className?: string;
};

export function CommandBar({ contextLabel, placeholder, className }: CommandBarProps) {
  const [value, setValue] = useState("");

  return (
    <form
      className={cn(
        "flex min-h-[58px] items-center gap-3 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 shadow-[var(--shadow-card)]",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        setValue("");
      }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-secondary))] text-[var(--accent-cyan)]">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-[var(--text-tertiary)]">{contextLabel}</div>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="mt-0.5 w-full bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </div>
      <button
        type="button"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        aria-label="Attach"
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <button
        type="submit"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--accent-cyan)] text-white transition-[filter] hover:brightness-105 disabled:opacity-45"
        disabled={!value.trim()}
        aria-label="Send"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </form>
  );
}

