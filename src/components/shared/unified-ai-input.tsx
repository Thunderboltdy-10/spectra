"use client";

import { useRef, useCallback } from "react";
import { Send, Square, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type UnifiedAiInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
  streaming?: boolean;
  compact?: boolean;
  icon?: React.ReactNode;
  className?: string;
};

/**
 * Shared AI input component with consistent styling across workspace.
 * Matches the command bar aesthetic: rounded-2xl, backdrop-blur, warm border.
 */
export function UnifiedAiInput({
  value,
  onChange,
  onSubmit,
  onStop,
  placeholder = "Ask AI...",
  disabled = false,
  streaming = false,
  compact = false,
  icon,
  className,
}: UnifiedAiInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (streaming && onStop) {
          onStop();
        } else if (value.trim() && !disabled) {
          onSubmit();
        }
      }
    },
    [disabled, onStop, onSubmit, streaming, value],
  );

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        compact ? "px-2.5 py-2" : "px-3.5 py-2.5",
        "rounded-2xl",
        "bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
        "border border-[var(--border-default)]",
        "shadow-[0_4px_20px_-6px_rgba(0,0,0,0.2)]",
        "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "focus-within:border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))]",
        "focus-within:shadow-[0_4px_24px_-6px_rgba(14,142,232,0.15)]",
        className,
      )}
    >
      {icon ?? (
        <Sparkles className={cn("shrink-0 text-[var(--text-tertiary)]", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      )}

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled && !streaming}
        className={cn(
          "flex-1 bg-transparent border-none outline-none min-w-0",
          compact ? "text-xs" : "text-sm",
          "text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]",
        )}
      />

      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          className={cn(
            "shrink-0 flex items-center justify-center rounded-lg transition-colors",
            compact ? "w-6 h-6" : "w-7 h-7",
            "bg-[var(--accent-coral)]/15 text-[var(--accent-coral)] hover:bg-[var(--accent-coral)]/25",
          )}
        >
          <Square className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim() || disabled}
          className={cn(
            "shrink-0 flex items-center justify-center rounded-lg transition-all",
            compact ? "w-6 h-6" : "w-7 h-7",
            value.trim() && !disabled
              ? "bg-[var(--accent-cyan)] text-white hover:brightness-110"
              : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]",
          )}
        >
          <Send className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
        </button>
      )}
    </div>
  );
}
