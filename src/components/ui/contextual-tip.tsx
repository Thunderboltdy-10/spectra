"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ContextualTipProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  tipId?: string;
  className?: string;
};

const STORAGE_PREFIX = "ai-school-tip-dismissed-session:";

function normalizeTipId(message: string) {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const resolvedTipId = useMemo(
    () => tipId ?? normalizeTipId(message),
    [message, tipId],
  );
  const storageKey = `${STORAGE_PREFIX}${resolvedTipId}`;

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(window.sessionStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  function dismissTip() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(storageKey, "1");
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
        "flex w-full items-center gap-1.5 rounded-t-lg rounded-b-none border border-b-0 border-[color-mix(in_oklab,var(--accent-cyan)_28%,var(--border-default))] bg-[linear-gradient(to_right,color-mix(in_oklab,var(--accent-cyan)_8%,transparent),color-mix(in_oklab,var(--accent-cyan)_3%,var(--bg-elevated)))] px-2.5 py-1.5 text-[var(--text-primary)]",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex-1 overflow-hidden">
        <p
          key={message}
          className="animate-in fade-in slide-in-from-bottom-1 duration-300 truncate text-micro leading-relaxed text-[var(--text-secondary)]"
        >
          {message}
        </p>
      </div>
      {actionLabel && onAction ? (
        <button
          key={actionLabel}
          type="button"
          onClick={onAction}
          className="animate-in fade-in slide-in-from-bottom-1 duration-300 cursor-pointer whitespace-nowrap rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismissTip}
        aria-label="Dismiss tip"
        className="cursor-pointer rounded-md p-1 text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
