"use client";

import { useEffect, useState } from "react";
import { ChevronDown, X, Settings2, FileText, Milestone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ChatModeSelector } from "@/components/chat/chat-mode-selector";
import { RichText } from "@/components/chat/rich-text";
import { usePanel } from "@/context/panel-context";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";
import type { AutoPreference, ModelOption, PersonalResource, UserSpending } from "@/hooks/use-chat-state";
import type { RouterMode, StudyMode, ThinkingLevel, Citation, RouteTrace } from "@/types";
import { FILE_LIMITS } from "@/lib/file-limits";

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

function formatMs(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.round(value))} ms`;
}

function formatScore(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function sanitizeModelId(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeModelLabel(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function spendingTierLabel(tier?: UserSpending["tier"]) {
  if (tier === "free_only") return "Budget only";
  if (tier === "cheap_only") return "Cheap only";
  return "Normal";
}

function resourceStatusLabel(status: PersonalResource["status"]) {
  if (status === "uploaded") return "Indexing";
  if (status === "processed") return "Ready";
  return "Failed";
}

type SettingsViewProps = {
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

function SettingsView({
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
}: SettingsViewProps) {
  const [showManual, setShowManual] = useState(false);
  const spentCents = userSpending?.totalCostCents ?? 0;
  const ratio = Math.min(Math.max(spentCents / MONTHLY_HARD_LIMIT_CENTS, 0), 1);
  const spendingTier = spendingTierLabel(userSpending?.tier);
  const selectedModel = models.find((model) => model.modelId === manualModel);

  return (
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

      <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
        <div>
          <p className="text-sm">Use personal resources</p>
          <p className="text-xs text-[var(--text-secondary)]">Include your uploaded files during retrieval</p>
        </div>
        <Switch checked={usePersonalResources} onCheckedChange={onTogglePersonalResources} />
      </div>

      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <h3 className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">My files</h3>
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          Saved in personal library: {personalResources.length}/{FILE_LIMITS.maxPersonalLibraryFiles}
        </p>
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
                  <p className="text-[10px] text-[var(--text-secondary)]">{resourceStatusLabel(resource.status)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-[var(--danger)]"
                  onClick={() => onDeleteResource(resource._id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
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
            style={{ width: `${Math.max(0, ratio * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          €{(spentCents / 100).toFixed(2)} / €{(MONTHLY_HARD_LIMIT_CENTS / 100).toFixed(2)} monthly soft cap
        </p>
      </section>
    </div>
  );
}

function CandidateBar({ score }: { score?: number }) {
  const width = typeof score === "number" && Number.isFinite(score) ? Math.max(4, Math.round(score * 100)) : 4;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
      <div className="h-full rounded-full bg-[var(--gradient-brand)]" style={{ width: `${width}%` }} />
    </div>
  );
}

function RouteTraceView({ trace }: { trace?: RouteTrace }) {
  if (!trace) {
    return <p className="text-sm text-[var(--text-secondary)]">No route trace available.</p>;
  }

  return (
    <div className="space-y-5">
      <section>
        <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Inputs</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { label: "Mode", value: trace.inputs.mode },
            { label: "Tier", value: trace.inputs.spendingTier },
            { label: "Thinking", value: trace.inputs.thinkingLevel },
            { label: "Complex", value: trace.inputs.complexPrompt ? "Yes" : "No" },
            { label: "Prompt Category", value: trace.inputs.promptCategory },
            { label: "Question Type", value: trace.inputs.questionType ?? "—" },
            { label: "Multipart", value: trace.inputs.isMultipart ? "Yes" : "No" },
            { label: "Enhanced", value: trace.inputs.promptEnhanced ? "Yes" : "No" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">{item.label}</p>
              <p className="text-sm text-[var(--text-primary)]">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Candidates</h4>
        <div className="space-y-2">
          {trace.candidates.map((candidate, index) => (
            <div
              key={`${candidate.modelId}-${index}`}
              className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5"
            >
              <p className="font-mono text-xs text-[var(--text-primary)]">{sanitizeModelId(candidate.modelId)}</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">Score: {formatScore(candidate.score)}</p>
              <CandidateBar score={candidate.score} />
              {candidate.reason && <p className="mt-1 text-xs text-[var(--text-secondary)]">{candidate.reason}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <h4 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Selected</h4>
        <p className="font-mono text-xs text-[var(--text-primary)]">{sanitizeModelId(trace.selected.modelId)}</p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{trace.selected.reason}</p>
      </section>

      {trace.fallbacks.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Fallbacks</h4>
          <ol className="space-y-2">
            {trace.fallbacks.map((fallback, index) => (
              <li
                key={`${fallback.fromModel}-${fallback.toModel}-${index}`}
                className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2.5"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-[var(--text-primary)]">
                  <Milestone className="h-3.5 w-3.5" />
                  <span className="font-medium">Attempt {fallback.attemptIndex + 1}</span>
                </div>
                <p className="font-mono text-[11px] text-[var(--text-secondary)]">
                  {sanitizeModelId(fallback.fromModel)} → {sanitizeModelId(fallback.toModel)}
                </p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{fallback.error}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function hrefForCitation(citation: Citation) {
  if (citation.url) return citation.url;
  if (citation.resourceId) return `/api/resources/${citation.resourceId}/download`;
  return undefined;
}

function SourcesView({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">No sources available for this response.</p>;
  }

  return (
    <div className="space-y-3">
      {citations.map((citation, index) => {
        const href = hrefForCitation(citation);
        const isSearch = citation.sourceType === "search";

        return (
          <article
            key={`${citation.filename}-${index}`}
            className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"
          >
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              {isSearch ? <Milestone className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
              <span className="uppercase tracking-[0.08em]">[{index + 1}] {citation.sourceType}</span>
            </div>

            <p className="font-medium text-[var(--text-primary)]">{citation.filename}</p>
            {citation.page ? <p className="mt-1 text-xs text-[var(--text-secondary)]">Page {citation.page}</p> : null}

            {citation.snippet ? (
              <RichText content={citation.snippet} className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]" />
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">No preview snippet available.</p>
            )}

            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex cursor-pointer rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
              >
                {citation.url ? "Open source URL" : "Download source"}
              </a>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

type UnifiedPanelProps = {
  settingsProps?: SettingsViewProps;
};

export function UnifiedPanel({ settingsProps }: UnifiedPanelProps) {
  const { activeView, panelData, closePanel } = usePanel();
  const compact = useCompactSheet(860);
  const docked = useRightPanelDock({ id: "unified-panel", open: !!activeView, compact, maxWidthPx: 576 });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (activeView) setCollapsed(compact);
  }, [activeView, compact]);

  useEffect(() => {
    if (!compact) setCollapsed(false);
  }, [compact]);

  if (!activeView) return null;

  const titles: Record<string, { subtitle: string; title: string }> = {
    settings: { subtitle: "Configuration", title: "Chat Settings" },
    "route-trace": { subtitle: "Route Trace", title: "Model Decision Timeline" },
    sources: { subtitle: "Sources", title: "Citation Details" },
  };

  const current = titles[activeView] ?? { subtitle: "Panel", title: "Details" };

  return (
    <div
      className={`fixed z-50 ${docked ? "inset-y-0 right-0 pointer-events-none" : "inset-0"}`}
      style={docked ? { width: "var(--right-panel-space, 576px)" } : undefined}
    >
      {!docked ? (
        <button
          type="button"
          className="absolute inset-0 cursor-pointer bg-transparent"
          onClick={closePanel}
          aria-label="Close panel"
        />
      ) : null}

      <aside
        className={`right-panel-shell pointer-events-auto absolute flex flex-col border-[var(--border-default)] bg-[var(--bg-sidebar)] p-4 shadow-[var(--shadow-soft)] ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          compact
            ? "bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border"
            : "inset-y-0 right-0 w-[92vw] max-w-xl border-l"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">{current.subtitle}</p>
            <h3 className="font-display text-2xl text-[var(--text-primary)]">{current.title}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {compact ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => setCollapsed((prev) => !prev)}
                aria-label={collapsed ? "Expand details" : "Collapse details"}
              >
                <ChevronDown className={`h-4 w-4 transition ${collapsed ? "-rotate-90" : "rotate-0"}`} />
              </Button>
            ) : null}
            {activeView === "route-trace" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  closePanel();
                  if (settingsProps) {
                    window.dispatchEvent(new CustomEvent("ai-school:toggle-settings"));
                  }
                }}
                aria-label="Open settings"
                title="Open settings"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            )}
            <Button type="button" variant="ghost" size="icon" onClick={closePanel} aria-label="Close panel">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!collapsed ? (
          <div className="right-panel-content min-h-0 flex-1 overflow-y-auto pr-1">
            {activeView === "settings" && settingsProps && <SettingsView {...settingsProps} />}
            {activeView === "route-trace" && <RouteTraceView trace={panelData.routeTrace} />}
            {activeView === "sources" && <SourcesView citations={panelData.sources ?? []} />}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
