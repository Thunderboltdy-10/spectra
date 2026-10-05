"use client";

import { Clock3, AlertTriangle, CheckCircle2, LockKeyhole, RefreshCw, CircleDashed, Unplug } from "@/components/icons/glyph-icons";
import type { CapabilityState } from "../../core/capability-truth";
import { cn } from "@/lib/utils";

export function capabilityStateLabel(state: CapabilityState) {
  switch (state.kind) {
    case "available":
      return "Current";
    case "refreshing":
      return "Refreshing";
    case "stale":
      return "Needs refresh";
    case "partial":
      return "Partial coverage";
    case "not_connected":
      return "Not connected";
    case "permission_denied":
      return "Access denied";
    case "unsupported":
      return "Not supported";
    case "schema_incompatible":
      return "Schema changed";
    case "unavailable":
      return "Temporarily unavailable";
  }
}

export function CapabilityTruthBadge({
  state,
  className,
}: {
  state: CapabilityState;
  className?: string;
}) {
  const good = state.kind === "available";
  const pending = state.kind === "refreshing";
  const warning = state.kind === "stale" || state.kind === "partial";
  const Icon = good
    ? CheckCircle2
    : pending
      ? RefreshCw
      : warning
        ? Clock3
        : state.kind === "permission_denied"
          ? LockKeyhole
          : state.kind === "not_connected"
            ? Unplug
            : AlertTriangle;
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 text-micro font-semibold",
        good && "border-emerald-600/20 bg-emerald-500/8 text-emerald-800",
        pending && "border-sky-600/20 bg-sky-500/8 text-sky-800",
        warning && "border-amber-600/20 bg-amber-500/9 text-amber-800",
        !good && !pending && !warning &&
          "border-rose-600/20 bg-rose-500/8 text-rose-800",
        className,
      )}
    >
      <Icon className={cn("size-3.5", pending && "animate-spin")} />
      {capabilityStateLabel(state)}
    </span>
  );
}

export function CapabilityTruthState({
  state,
  title,
  emptyLabel,
  onRetry,
}: {
  state: CapabilityState;
  title: string;
  emptyLabel?: string;
  onRetry?: () => void;
}) {
  if (state.kind === "available") return null;
  const detail =
    state.kind === "stale"
      ? state.reason ?? "The last successful data is visible while a refresh is due."
      : state.kind === "partial"
        ? state.details
        : state.kind === "not_connected"
          ? "Connect a supported provider before expecting school records here."
          : state.kind === "permission_denied"
            ? "Your current school role cannot read this capability."
            : state.kind === "unsupported"
              ? "The connected provider does not expose this capability."
              : state.kind === "schema_incompatible"
                ? "Provider schema drift was quarantined instead of being shown as empty data."
                : state.kind === "refreshing"
                  ? "Current records remain visible while newer data is synchronized."
                  : state.message;
  return (
    <div
      role={state.kind === "unavailable" ? "alert" : "status"}
      className="flex max-w-2xl items-start gap-3 rounded-card bg-[var(--bg-secondary)] px-5 py-4"
    >
      <CircleDashed className="mt-0.5 size-4 shrink-0 text-[var(--text-tertiary)]" />
      <div className="min-w-0 flex-1">
        <p className="text-caption font-semibold text-[var(--text-primary)]">
          {title}: {capabilityStateLabel(state)}
        </p>
        <p className="mt-0.5 text-micro leading-5 text-[var(--text-secondary)]">
          {detail || emptyLabel || "No records are currently available."}
        </p>
      </div>
      {onRetry &&
      (state.kind === "stale" ||
        state.kind === "unavailable" ||
        state.kind === "schema_incompatible") ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-micro font-semibold hover:bg-[var(--bg-hover)]"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
