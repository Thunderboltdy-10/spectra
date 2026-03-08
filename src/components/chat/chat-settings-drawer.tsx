"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AutoPreference, ModelOption, PersonalResource, UserSpending } from "@/hooks/use-chat-state";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";

type ChatSettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  models: ModelOption[];
  usePersonalResources: boolean;
  personalResources: PersonalResource[];
  userSpending: UserSpending | null;
  autoEnhancePrompt: AutoPreference;
  autoThinking: AutoPreference;
  autoSearch: AutoPreference;
  autoCompaction: AutoPreference;
  onTogglePersonalResources: (enabled: boolean) => void;
  onAutoEnhancePromptChange: (value: AutoPreference) => void;
  onAutoThinkingChange: (value: AutoPreference) => void;
  onAutoSearchChange: (value: AutoPreference) => void;
  onAutoCompactionChange: (value: AutoPreference) => void;
  onDeleteResource: (resourceId: string) => void;
};

function AutoChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AutoPreference;
  onChange: (value: AutoPreference) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[color-mix(in_oklab,var(--bg-secondary)_88%,transparent)] px-2.5 py-2">
      <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">{label}</p>
      <div className="grid min-w-[170px] grid-cols-3 gap-1">
        {(["auto", "on", "off"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={`rounded-md px-2 py-1 text-xs transition ${
              value === item
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[var(--shadow-card)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            {item === "auto" ? "Auto" : item === "on" ? "On" : "Off"}
          </button>
        ))}
      </div>
    </div>
  );
}

function row(label: string, description: string, checked: boolean, onChange: (value: boolean) => void) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-xs text-[var(--text-secondary)]">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function sanitizeModelLabel(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function resourceStatusMeta(status: PersonalResource["status"], updatedAt?: number, attempts?: number) {
  if (status === "uploaded") {
    return {
      label: "Queued for processing...",
      Icon: Loader2,
      iconClassName: "animate-spin text-[var(--text-secondary)]",
    };
  }
  if (status === "processing") {
    const stale = typeof updatedAt === "number" && Date.now() - updatedAt > 45_000;
    const retryCount = Math.max(1, attempts ?? 1);
    return {
      label: stale
        ? retryCount >= 3
          ? "Processing stalled - remove and retry"
          : `Still processing... (attempt ${retryCount})`
        : `Processing... (attempt ${retryCount})`,
      Icon: Loader2,
      iconClassName: "animate-spin text-[var(--text-secondary)]",
    };
  }
  if (status === "processed") {
    return {
      label: "Ready",
      Icon: CheckCircle2,
      iconClassName: "text-[var(--success)]",
    };
  }
  return {
    label: "Failed - remove and retry",
    Icon: AlertCircle,
    iconClassName: "text-[var(--danger)]",
  };
}

export function ChatSettingsDrawer({
  open,
  onClose,
  models,
  usePersonalResources,
  personalResources,
  userSpending,
  autoEnhancePrompt,
  autoThinking,
  autoSearch,
  autoCompaction,
  onTogglePersonalResources,
  onAutoEnhancePromptChange,
  onAutoThinkingChange,
  onAutoSearchChange,
  onAutoCompactionChange,
  onDeleteResource,
}: ChatSettingsDrawerProps) {
  const compact = useCompactSheet(1024);
  const { docked, panelWidth } = useRightPanelDock({
    id: "chat-settings-drawer",
    open,
    compact,
    maxWidthPx: 448,
  });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCollapsed(false);
  }, [open]);

  if (!open) return null;

  const ratio =
    userSpending && typeof userSpending.budgetUsagePercent === "number" && userSpending.budgetUsagePercent >= 0
      ? Math.min(1, Math.max(0, userSpending.budgetUsagePercent / 100))
      : null;
  const usageLabel =
    typeof ratio !== "number"
      ? "No activity yet"
      : ratio >= 0.8
      ? "High activity"
      : ratio >= 0.4
        ? "Steady activity"
        : ratio > 0
          ? "Getting started"
          : "No activity yet";
  const selectedModel = models.find((model) => model.modelId === "openrouter/auto")
    ?? models[0];

  return (
    <div
      className={`fixed z-40 ${docked ? "inset-y-0 right-0 pointer-events-none" : "inset-0"}`}
      style={docked ? { width: `${panelWidth}px` } : undefined}
    >
      {!docked ? (
        <button
          type="button"
          className={`absolute inset-0 transition bg-transparent`}
          aria-label="Close settings"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`right-panel-shell ${rightPanelSurfaceClassName()} pointer-events-auto absolute p-4 shadow-[var(--shadow-soft)] sm:p-5 ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          compact
            ? "bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border"
            : "inset-y-0 right-0 w-full max-w-md border-l"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl">Chat settings</h2>
          <div className="flex items-center gap-1.5">
            {compact ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setCollapsed((prev) => !prev)}
                aria-label={collapsed ? "Expand settings" : "Collapse settings"}
              >
                <ChevronDown className={`h-4 w-4 transition ${collapsed ? "-rotate-90" : "rotate-0"}`} />
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!collapsed ? (
          <div className={`right-panel-content ${compact ? "max-h-[calc(78vh-4rem)]" : "max-h-[calc(100vh-6rem)]"} space-y-4 overflow-y-auto pr-1`}>
          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Automation profile</h3>
            <div className="mt-2 grid gap-1.5">
              <AutoChoice label="Auto-enhance prompt" value={autoEnhancePrompt} onChange={onAutoEnhancePromptChange} />
              <AutoChoice label="Auto-thinking" value={autoThinking} onChange={onAutoThinkingChange} />
              <AutoChoice label="Auto-search" value={autoSearch} onChange={onAutoSearchChange} />
              <AutoChoice label="Auto-compaction" value={autoCompaction} onChange={onAutoCompactionChange} />
            </div>
            <div className="mt-3 grid gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2 text-xs text-[var(--text-secondary)]">
              <p>
                Routing: <span className="font-medium text-[var(--text-primary)]">Adaptive routing</span>
              </p>
            </div>
          </section>

          {selectedModel && (
            <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
              <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Selected model</h3>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{sanitizeModelLabel(selectedModel.name)}</p>
              <p className="text-xs text-[var(--text-secondary)]">{selectedModel.provider}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                {(selectedModel.tags ?? [])
                  .filter((tag) => !/\bfree\b/i.test(tag))
                  .slice(0, 6)
                  .map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                  >
                    {tag}
                  </span>
                ))}
                </div>
              </section>
          )}

          {row("Use personal resources", "Include your uploaded files during retrieval", usePersonalResources, onTogglePersonalResources)}

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">My files</h3>
            <div className="mt-3 max-h-[min(56vh,34rem)] space-y-2 overflow-y-auto pr-1">
              {personalResources.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)]">No personal files yet.</p>
              ) : (
                personalResources.map((resource) => (
                  <div
                    key={resource._id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-[var(--text-primary)]">{resource.filename}</p>
                      <p className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                        {(() => {
                          const status = resourceStatusMeta(resource.status, resource.updatedAt, resource.processingAttempts);
                          return (
                            <>
                              <status.Icon className={`h-3 w-3 ${status.iconClassName}`} />
                              {status.label}
                            </>
                          );
                        })()}
                      </p>
                      {resource.error ? (
                        <p className="mt-1 truncate text-[10px] text-[var(--danger)]" title={resource.error}>
                          {resource.error}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-[var(--danger)]"
                        onClick={() => onDeleteResource(resource._id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Monthly activity</h3>
                <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{usageLabel}</span>
              </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
              <div
                className="h-full rounded-full bg-[var(--gradient-brand)]"
                style={{
                  width: `${typeof ratio === "number" ? Math.max(ratio > 0 ? 2 : 0, ratio * 100) : 0}%`,
                }}
              />
            </div>
          </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
