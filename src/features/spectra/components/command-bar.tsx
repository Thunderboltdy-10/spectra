"use client";

import { Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { QuickChat } from "@/components/shared/quick-chat";
import { cn } from "@/lib/utils";

type CommandBarProps = {
  contextLabel: string;
  placeholder: string;
  detail?: string;
  className?: string;
  onSubmit?: (value: string) => void;
};

export function CommandBar({ contextLabel, placeholder, detail, className, onSubmit }: CommandBarProps) {
  const [value, setValue] = useState("");

  return (
    <div className={cn("w-full", className)}>
      <QuickChat
        value={value}
        onChange={setValue}
        onSubmit={() => {
          const next = value.trim();
          if (!next) return;
          onSubmit?.(next);
          setValue("");
        }}
        showMic={false}
        placeholder={placeholder}
        className="w-full min-w-0"
        leftContent={(
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-[16px] border border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-elevated))] text-[var(--accent-cyan)] shadow-[0_12px_28px_-22px_rgba(8,22,40,0.45)] transition-[background,transform] hover:-translate-y-0.5 hover:bg-[color-mix(in_oklab,var(--accent-cyan)_16%,var(--bg-elevated))]"
            aria-label="Add context"
          >
            <Plus className="h-[18px] w-[18px]" />
          </button>
        )}
        topContent={(
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--accent-cyan)_11%,var(--bg-secondary))] px-2 text-[10.5px] font-semibold text-[var(--accent-cyan)]">
                <Sparkles className="h-3 w-3" />
                {contextLabel}
              </span>
              {detail ? <span className="truncate text-[11px] font-medium text-[var(--text-tertiary)]">{detail}</span> : null}
            </div>
          </div>
        )}
      />
    </div>
  );
}
