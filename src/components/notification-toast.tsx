"use client";

import { createElement } from "react";
import { Brain, BookOpen, GraduationCap, MessageSquare, Sparkles, X } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";

export type NotificationToastData = {
  title: string;
  body: string;
  type?: string;
  actionUrl?: string;
  mode?: string;
  model?: string;
};

function getModeIcon(mode?: string) {
  switch (mode) {
    case "tutor":
      return createElement(GraduationCap, { size: 14 });
    case "research":
      return createElement(BookOpen, { size: 14 });
    case "flashcard":
      return createElement(Brain, { size: 14 });
    default:
      return createElement(MessageSquare, { size: 14 });
  }
}

export function NotificationToast({
  notification,
  onDismiss,
  onNavigate,
}: {
  notification: NotificationToastData;
  onDismiss: () => void;
  onNavigate?: () => void;
}) {
  const modelShortName = notification.model ? notification.model.split("/").pop() : undefined;
  const modelProvider = notification.model ? notification.model.split("/")[0] : undefined;

  return (
    <div
      className="group relative flex w-[360px] max-w-[90vw] cursor-pointer items-start gap-3 rounded-xl border border-[color-mix(in_oklab,var(--accent-cyan)_25%,var(--border-default))] bg-[var(--bg-elevated)] p-3.5 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] transition-all duration-200 hover:border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))]"
      onClick={() => {
        if (notification.actionUrl) {
          window.location.href = notification.actionUrl;
        }
        onNavigate?.();
        onDismiss();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (notification.actionUrl) {
            window.location.href = notification.actionUrl;
          }
          onNavigate?.();
          onDismiss();
        }
      }}
    >
      {/* Subtle glow on hover */}
      <div className="absolute -inset-px rounded-xl bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] opacity-0 transition-opacity group-hover:opacity-100" />

      {/* Icon */}
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--accent-cyan)_15%,var(--bg-secondary))] text-[var(--accent-cyan)]">
        <Sparkles size={16} />
      </div>

      {/* Content */}
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {notification.mode && (
            <span className="text-[var(--text-tertiary)]">{getModeIcon(notification.mode)}</span>
          )}
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">
            {notification.title}
          </p>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-secondary)]">
          {notification.body}
        </p>
        {modelProvider && modelShortName && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <ProviderLogo
              provider={modelProvider}
              size={12}
            />
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {modelShortName}
            </span>
          </div>
        )}
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="relative shrink-0 rounded-md p-0.5 text-[var(--text-tertiary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
