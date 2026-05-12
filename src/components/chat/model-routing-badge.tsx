"use client";

import { useMemo } from "react";
import { ChevronRight, LockKeyhole, Route } from "lucide-react";
import { usePanel } from "@/context/panel-context";
import type { RouteTrace } from "@/types";

type ModelRoutingBadgeProps = {
  modelUsed?: string;
  whyThisResponse?: string;
  routeTrace?: RouteTrace;
};

function formatModelName(modelId: string) {
  const raw = modelId.split("/").pop() || modelId;
  const withoutSuffix = raw
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/-\d{4}-\d{2}-\d{2}$/i, "")
    .trim();
  const normalized = withoutSuffix
    .replace(/gpt-4\.1/gi, "GPT-4.1")
    .replace(/gpt-5/gi, "GPT-5")
    .replace(/claude/gi, "Claude")
    .replace(/gemini/gi, "Gemini")
    .replace(/sonar/gi, "Sonar")
    .replace(/deepseek/gi, "DeepSeek");

  return normalized
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d+(\.\d+)?$/.test(word)) return word;
      if (/^(gpt|claude|gemini|r1|o3|o4)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function ModelRoutingBadge({ modelUsed, whyThisResponse, routeTrace }: ModelRoutingBadgeProps) {
  const { activeView, openPanel } = usePanel();

  const activeModelId = modelUsed ?? routeTrace?.selected.modelId;
  const formattedName = useMemo(() => formatModelName(activeModelId ?? ""), [activeModelId]);
  const hasTrace = Boolean(routeTrace);
  const manualLock = routeTrace?.inputs.routerMode === "manual";
  const hintText = manualLock ? "Manual" : whyThisResponse ? "Why" : "Trace";
  const isActive = activeView === "route-trace";

  if (!activeModelId) return null;

  return (
    <div className="inline-flex min-w-0 items-center">
      {hasTrace ? (
        <button
          type="button"
          onClick={() => openPanel("route-trace", { routeTrace })}
          title={whyThisResponse ?? (manualLock ? "Manual model route details" : "Model route details")}
          className={`group inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1.5 text-left shadow-[0_12px_36px_-28px_var(--text-primary)] transition hover:-translate-y-px ${
            isActive
              ? "border-[color-mix(in_oklab,var(--brand-primary)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-secondary))]"
              : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:border-[color-mix(in_oklab,var(--accent-cyan)_34%,var(--border-default))]"
          }`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-primary)] text-[var(--text-secondary)] ring-1 ring-[var(--border-default)]">
            {manualLock ? <LockKeyhole className="h-3.5 w-3.5" /> : <Route className="h-3.5 w-3.5" />}
          </span>
          <span className={`truncate text-[13px] font-semibold transition ${isActive ? "text-[var(--brand-primary)]" : "text-[var(--text-primary)]"}`}>{formattedName}</span>
          <span className={`hidden text-[10px] font-semibold uppercase tracking-[0.14em] transition sm:inline ${isActive ? "text-[var(--brand-primary)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"}`}>
            {hintText}
          </span>
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition group-hover:translate-x-0.5 ${isActive ? "text-[var(--brand-primary)]" : "text-[var(--text-tertiary)]"}`} />
        </button>
      ) : (
        <div className="inline-flex min-w-0 items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1.5">
          <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{formattedName}</span>
          {manualLock ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              <LockKeyhole className="h-3 w-3" />
              Manual
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
