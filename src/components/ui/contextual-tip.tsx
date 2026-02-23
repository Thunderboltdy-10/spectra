"use client";

import { useEffect, useMemo, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ContextualTipProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  tipId?: string;
  className?: string;
};

const STORAGE_PREFIX = "ai-school-tip-dismissed:";

function normalizeTipId(message: string) {
  return message.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ContextualTip({
  message,
  actionLabel,
  onAction,
  onDismiss,
  tipId,
  className,
}: ContextualTipProps) {
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const resolvedTipId = useMemo(() => tipId ?? normalizeTipId(message), [message, tipId]);
  const storageKey = `${STORAGE_PREFIX}${resolvedTipId}`;

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  function dismissTip() {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Ignore storage failures (private mode, blocked storage, etc.).
    }
    onDismiss?.();
  }

  if (!mounted || dismissed) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-elevated))] px-3 py-2 text-sm text-[var(--text-primary)]",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-cyan)]" />
      <p className="flex-1 text-sm leading-relaxed">{message}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="cursor-pointer whitespace-nowrap rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismissTip}
        aria-label="Dismiss tip"
        className="cursor-pointer rounded-md p-1 text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
