"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { QuickChat } from "@/components/shared/quick-chat";
import { cn } from "@/lib/utils";

type CommandBarProps = {
  contextLabel: string;
  placeholder: string;
  className?: string;
};

export function CommandBar({ contextLabel, placeholder, className }: CommandBarProps) {
  const [value, setValue] = useState("");

  return (
    <div className={cn("w-full", className)}>
      <QuickChat
        value={value}
        onChange={setValue}
        onSubmit={() => {
          if (!value.trim()) return;
          setValue("");
        }}
        showMic={false}
        placeholder={placeholder}
        className="w-full min-w-0"
        leftContent={(
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[0_8px_24px_-18px_rgba(8,22,40,0.30)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Add context"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        topContent={(
          <div className="text-[11px] font-medium text-[var(--text-tertiary)]">{contextLabel}</div>
        )}
      />
    </div>
  );
}
