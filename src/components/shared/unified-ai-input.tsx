"use client";

import { Sparkles } from "lucide-react";
import { QuickChat } from "@/components/shared/quick-chat";
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

export function UnifiedAiInput({
  value,
  onChange,
  onSubmit,
  onStop,
  placeholder = "Ask anything. Include your context and goal.",
  disabled = false,
  streaming = false,
  compact = false,
  icon,
  className,
}: UnifiedAiInputProps) {
  return (
    <QuickChat
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      onStop={onStop}
      placeholder={placeholder}
      disabled={disabled}
      isStreaming={streaming}
      showMic={false}
      className={cn(
        "min-w-0",
        compact && "[&_textarea]:text-xs",
        className,
      )}
      leftContent={icon ?? <Sparkles className={cn("shrink-0 text-[var(--text-tertiary)]", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />}
    />
  );
}
