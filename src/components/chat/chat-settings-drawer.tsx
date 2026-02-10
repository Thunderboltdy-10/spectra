"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ChatModeSelector } from "@/components/chat/chat-mode-selector";
import type { AutoPreference, ModelOption, UserSpending } from "@/hooks/use-chat-state";
import type { RouterMode, StudyMode, ThinkingLevel } from "@/types";

type ChatSettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  models: ModelOption[];
  mode: StudyMode;
  thinkingLevel: ThinkingLevel;
  routerMode: RouterMode;
  manualModel: string;
  usePersonalResources: boolean;
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

export function ChatSettingsDrawer({
  open,
  onClose,
  models,
  mode,
  thinkingLevel,
  routerMode,
  manualModel,
  usePersonalResources,
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
}: ChatSettingsDrawerProps) {
  const [showManual, setShowManual] = useState(false);

  if (!open) return null;

  const ratio = userSpending
    ? Math.min(userSpending.totalCostCents / Math.max(userSpending.totalCostCents, 1200), 1)
    : 0;
  const selectedModel = models.find((model) => model.modelId === manualModel);

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Close settings"
        onClick={onClose}
      />

      <aside className="chat-settings-panel absolute inset-y-0 right-0 w-full max-w-md border-l border-[var(--border-default)] bg-[var(--bg-primary)] p-4 shadow-[var(--shadow-soft)] sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl">Chat settings</h2>
          <Button type="button" variant="secondary" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
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
                            {model.name}
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
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{selectedModel.name}</p>
              <p className="text-xs text-[var(--text-secondary)]">{selectedModel.provider}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(selectedModel.tags ?? []).slice(0, 6).map((tag) => (
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

          {userSpending && (
            <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
              <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">Usage indicator</h3>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
                <div
                  className="h-full rounded-full bg-[var(--gradient-brand)]"
                  style={{ width: `${Math.max(2, ratio * 100)}%` }}
                />
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
