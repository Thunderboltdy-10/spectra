"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ChatModeSelector } from "@/components/chat/chat-mode-selector";
import type { AutoPreference, ModelOption, PersonalResource, UserSpending } from "@/hooks/use-chat-state";
import type { RouterMode, StudyMode, ThinkingLevel } from "@/types";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";

type ChatSettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  models: ModelOption[];
  mode: StudyMode;
  thinkingLevel: ThinkingLevel;
  routerMode: RouterMode;
  manualModel: string;
  usePersonalResources: boolean;
  personalResources: PersonalResource[];
  userSpending: UserSpending | null;
  autoEnhancePrompt: AutoPreference;
  autoThinking: AutoPreference;
  autoSearch: AutoPreference;
  onModeChange: (mode: StudyMode) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
  onRouterChange: (mode: RouterMode) => void;
  onManualModelChange: (modelId: string) => void;
  onTogglePersonalResources: (enabled: boolean) => void;
  onAutoEnhancePromptChange: (value: AutoPreference) => void;
  onAutoThinkingChange: (value: AutoPreference) => void;
  onAutoSearchChange: (value: AutoPreference) => void;
  onDeleteResource: (resourceId: string) => void;
};

const MONTHLY_HARD_LIMIT_CENTS = 900;

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
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
      <p className="mb-2 text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">{label}</p>
      <div className="grid grid-cols-3 gap-1">
        {(["auto", "on", "off"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={`rounded-md px-2 py-1 text-xs transition ${
              value === item
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            {item === "auto" ? "Auto" : item === "on" ? "Yes" : "No"}
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

function spendingTierLabel(tier?: UserSpending["tier"]) {
  if (tier === "free_only") return "Budget only";
  if (tier === "cheap_only") return "Cheap only";
  return "Normal";
}

function sanitizeModelLabel(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function ChatSettingsDrawer({
  open,
  onClose,
  models,
  mode,
  thinkingLevel,
  routerMode,
  manualModel,
  usePersonalResources,
  personalResources,
  userSpending,
  autoEnhancePrompt,
  autoThinking,
  autoSearch,
  onModeChange,
  onThinkingChange,
  onRouterChange,
  onManualModelChange,
  onTogglePersonalResources,
  onAutoEnhancePromptChange,
  onAutoThinkingChange,
  onAutoSearchChange,
  onDeleteResource,
}: ChatSettingsDrawerProps) {
  const compact = useCompactSheet(860);
  const docked = useRightPanelDock({ id: "chat-settings-drawer", open, compact, maxWidthPx: 448 });
  const [collapsed, setCollapsed] = useState(false);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCollapsed(compact);
  }, [open, compact]);

  useEffect(() => {
    if (!compact) {
      setCollapsed(false);
    }
  }, [compact]);

  if (!open) return null;

  const spentCents = userSpending?.totalCostCents ?? 0;
  const ratio = Math.min(spentCents / MONTHLY_HARD_LIMIT_CENTS, 1);
  const spendingTier = spendingTierLabel(userSpending?.tier);
  const selectedModel = models.find((model) => model.modelId === manualModel);

  return (
    <div className="fixed inset-0 z-40">
      {!docked ? (
        <button
          type="button"
          className="absolute inset-0 bg-transparent"
          aria-label="Close settings"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`right-panel-shell absolute border-[var(--border-default)] bg-[var(--bg-sidebar)] p-4 shadow-[var(--shadow-soft)] sm:p-5 ${
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
            <div className="mt-2 grid gap-2">
              <AutoChoice label="Auto-enhance prompt" value={autoEnhancePrompt} onChange={onAutoEnhancePromptChange} />
              <AutoChoice label="Auto-thinking" value={autoThinking} onChange={onAutoThinkingChange} />
              <AutoChoice label="Auto-search" value={autoSearch} onChange={onAutoSearchChange} />
            </div>
            <div className="mt-2 grid gap-2 text-xs text-[var(--text-secondary)]">
              <p>
                Routing:{" "}
                <span className="font-medium text-[var(--text-primary)]">
                  {routerMode === "manual" ? "Manual model lock" : "Adaptive routing"}
                </span>
              </p>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <button
              type="button"
              onClick={() => setShowManual((prev) => !prev)}
              className="flex w-full items-center justify-between"
            >
              <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Manual overrides</h3>
              <ChevronDown className={`h-4 w-4 text-[var(--text-secondary)] transition ${showManual ? "rotate-180" : ""}`} />
            </button>

            {showManual && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Study mode</span>
                  <ChatModeSelector mode={mode} onChange={onModeChange} />
                </div>

                <label className="space-y-1.5">
                  <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Thinking</span>
                  <Select value={thinkingLevel} onValueChange={(value) => onThinkingChange(value as ThinkingLevel)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Routing</span>
                  <Select value={routerMode} onValueChange={(value) => onRouterChange(value as RouterMode)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="openrouter_auto">OpenRouter auto</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                {routerMode === "manual" && (
                  <label className="space-y-1.5">
                    <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Model</span>
                    <Select value={manualModel} onValueChange={onManualModelChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose model" />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((model) => (
                          <SelectItem key={model.modelId} value={model.modelId}>
                            {sanitizeModelLabel(model.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
              </div>
            )}
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
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
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
                      <p className="text-[10px] text-[var(--text-secondary)]">{resource.status}</p>
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
              <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Usage indicator</h3>
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{spendingTier}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
              <div
                className="h-full rounded-full bg-[var(--gradient-brand)]"
                style={{ width: `${Math.max(2, ratio * 100)}%` }}
              />
            </div>
          </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
