"use client";

import type { ReactNode } from "react";
import { ArrowUp, Command, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type CommandBarProps = {
  placeholder: string;
  menu?: ReactNode;
  context?: ReactNode;
  className?: string;
  onSubmit?: (value: string) => void;
};

export function CommandBar({ placeholder, menu, context, className, onSubmit }: CommandBarProps) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={cn("relative flex items-center gap-2", className)}>
      {menuOpen && menu ? (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 min-w-[220px] rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.10)]">
          {menu}
        </div>
      ) : null}
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[0_2px_8px_rgba(27,20,12,0.05)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Open actions"
      >
        <Plus className="h-4 w-4" />
      </button>
      <div className="flex min-h-12 flex-1 items-end gap-2 rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_3px_12px_rgba(27,20,12,0.08)]">
        {context ? <div className="hidden h-9 shrink-0 items-center border-r border-[var(--border-default)] pr-2 md:flex">{context}</div> : null}
        <textarea
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const next = value.trim();
              if (!next) return;
              onSubmit?.(next);
              setValue("");
            }
          }}
          placeholder={placeholder}
          className="max-h-[80px] min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        <span className="hidden h-7 items-center gap-1 rounded-[6px] bg-[var(--bg-secondary)] px-2 text-[11px] text-[var(--text-tertiary)] sm:flex">
          <Command className="h-3 w-3" />
          K
        </span>
        <button
          type="button"
          disabled={!value.trim()}
          onClick={() => {
            const next = value.trim();
            if (!next) return;
            onSubmit?.(next);
            setValue("");
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--text-primary)] text-[var(--bg-primary)] disabled:bg-[var(--bg-secondary)] disabled:text-[var(--text-tertiary)]"
          aria-label="Send command"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
