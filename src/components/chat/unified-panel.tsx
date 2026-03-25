"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Loader2, RotateCcw, X, XCircle, FileText, Milestone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/provider-logo";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";
import type { ActiveCollaborator } from "@/components/chat/collaborators-live";
import { RichText } from "@/components/chat/rich-text";
import { usePanel, type PanelQuizData } from "@/context/panel-context";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";
import type { AutoPreference, ModelOption, PersonalResource, UserSpending } from "@/hooks/use-chat-state";
import type { Citation, RouteTrace, RouterMode } from "@/types";
import { FILE_LIMITS } from "@/lib/file-limits";
import { formatToolchainLabel } from "@/lib/orchestrator/trace-labels";
import { RESOURCE_PROCESSING_STALE_MS } from "../../../shared/resource-processing";
import { CodeCanvas } from "@/components/chat/code-canvas";

function AutoChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AutoPreference;
  onChange: (value: AutoPreference) => void;
}) {
  const options = ["auto", "on", "off"] as const;
  const activeIndex = options.indexOf(value);

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2">
      <p className="mb-2 text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">{label}</p>
      <div className="relative flex w-full rounded-lg bg-[var(--bg-primary)] p-1">
        <div
          className="absolute bottom-1 top-1 rounded-md bg-[var(--bg-elevated)] shadow-sm border border-[var(--border-default)] transition-transform duration-300 ease-out"
          style={{ left: "4px", width: "calc((100% - 8px) / 3)", transform: `translateX(${activeIndex * 100}%)` }}
        />
        {options.map((item) => {
          const isActive = value === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => onChange(item)}
              className={`relative z-10 flex-1 rounded-md py-1 text-[11px] font-semibold tracking-wide uppercase transition-colors duration-200 ${
                isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
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

function providerFromModelId(value: string) {
  const provider = value.split("/")[0] ?? "Unknown";
  if (!provider) return "Unknown";
  return provider
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
    const stale = typeof updatedAt === "number" && Date.now() - updatedAt > RESOURCE_PROCESSING_STALE_MS;
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
    Icon: XCircle,
    iconClassName: "text-[var(--danger)]",
  };
}



export type SettingsViewProps = {
  models: ModelOption[];
  routerMode: RouterMode;
  manualModel: string;
  activeModelUsed?: string;
  showCostDetails?: boolean;
  usePersonalResources: boolean;
  autoSaveConversationFilesToLibrary: boolean;
  personalResources: PersonalResource[];
  userSpending: UserSpending | null;
  recentChatCount?: number;
  liveProgressAutoOpen: boolean;
  autoEnhancePrompt: AutoPreference;
  autoThinking: AutoPreference;
  autoSearch: AutoPreference;
  autoCompaction: AutoPreference;
  onTogglePersonalResources: (enabled: boolean) => void;
  onAutoSaveConversationFilesToLibraryChange: (enabled: boolean) => void;
  onLiveProgressAutoOpenChange: (enabled: boolean) => void;
  onAutoEnhancePromptChange: (value: AutoPreference) => void;
  onAutoThinkingChange: (value: AutoPreference) => void;
  onAutoSearchChange: (value: AutoPreference) => void;
  onAutoCompactionChange: (value: AutoPreference) => void;
  onDeleteResource: (resourceId: string) => void;
  onRetryResource?: (resourceId: string) => void;
  onUploadPersonalFiles: (files: File[]) => void;
};

const PALETTE_OPTIONS = [
  { key: "warm", label: "Warm", lightSwatch: "#ede9e3", darkSwatch: "#1e1b2b" },
  { key: "slate", label: "Slate", lightSwatch: "#e2e8f0", darkSwatch: "#1e293b" },
  { key: "zinc", label: "Zinc", lightSwatch: "#e4e4e7", darkSwatch: "#27272a" },
  { key: "rose", label: "Rose", lightSwatch: "#fff0f3", darkSwatch: "#1d0b15" },
  { key: "custom", label: "Custom", lightSwatch: "var(--custom-theme-light, #e0e7ff)", darkSwatch: "var(--custom-theme-dark, #1e1b4b)" },
] as const;

function ColorPalettePicker() {
  const [selected, setSelected] = useState(() => {
    if (typeof window === "undefined") return "warm";
    return window.localStorage.getItem("ai-school:color-theme") ?? "warm";
  });
  const [customColor, setCustomColor] = useState(() => {
    if (typeof window === "undefined") return "#0e8ee8";
    return (
      window.localStorage.getItem("ai-school:custom-primary-color")
      ?? window.localStorage.getItem("ai-school:custom-color")
      ?? "#0e8ee8"
    );
  });
  const isDark = typeof window !== "undefined" && document.documentElement.classList.contains("dark");

  function applyPalette(key: string, primary?: string) {
    const nextPrimary = primary ?? customColor;
    setSelected(key);
    try {
      window.localStorage.setItem("ai-school:color-theme", key);
      if (primary) {
        window.localStorage.setItem("ai-school:custom-primary-color", nextPrimary);
      }
    } catch { /* ignore */ }

    if (key === "warm") {
      document.documentElement.removeAttribute("data-theme-palette");
      document.documentElement.style.removeProperty("--brand-accent");
      document.documentElement.style.removeProperty("--brand-primary");
      document.documentElement.style.removeProperty("--custom-theme-light");
      document.documentElement.style.removeProperty("--custom-theme-dark");
    } else if (key === "custom") {
      // Auto-derive a complementary accent by shifting hue via color-mix with a contrasting neutral
      const accent = `color-mix(in oklab, ${nextPrimary} 70%, #20b8b2)`;
      document.documentElement.setAttribute("data-theme-palette", "custom");
      document.documentElement.style.setProperty("--brand-primary", nextPrimary);
      document.documentElement.style.setProperty("--brand-accent", accent);
      document.documentElement.style.setProperty("--custom-theme-light", `color-mix(in oklab, ${nextPrimary} 14%, #ffffff)`);
      document.documentElement.style.setProperty("--custom-theme-dark", `color-mix(in oklab, ${nextPrimary} 28%, #000000)`);
    } else {
      document.documentElement.setAttribute("data-theme-palette", key);
      document.documentElement.style.removeProperty("--brand-accent");
      document.documentElement.style.removeProperty("--brand-primary");
      document.documentElement.style.removeProperty("--custom-theme-light");
      document.documentElement.style.removeProperty("--custom-theme-dark");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTE_OPTIONS.map((opt) => {
        const active = selected === opt.key;
        const swatch = isDark ? opt.darkSwatch : opt.lightSwatch;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => applyPalette(opt.key)}
            title={opt.label}
            className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 transition ${
              active
                ? "border-[var(--accent-cyan)] shadow-[0_0_0_1px_var(--accent-cyan)]"
                : "border-transparent hover:border-[var(--border-default)]"
            }`}
          >
            <span
              className="h-8 w-8 rounded-md border border-[var(--border-default)]"
              style={{ background: opt.key === "custom" && active ? customColor : swatch }}
            />
            <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              {opt.label}
            </span>
          </button>
        );
      })}

      {selected === "custom" && (
        <div className="ml-2 flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1.5">
          <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
            Accent color
            <input
              type="color"
              value={customColor}
              onChange={(event) => {
                const next = event.target.value;
                setCustomColor(next);
                applyPalette("custom", next);
              }}
              className="h-8 w-8 cursor-pointer rounded-md border border-[var(--border-default)] p-0"
              title="Pick your accent color"
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function SettingsView({
  models,
  routerMode,
  manualModel,
  activeModelUsed,
  usePersonalResources,
  autoSaveConversationFilesToLibrary,
  personalResources,
  userSpending,
  recentChatCount = 0,
  liveProgressAutoOpen,
  autoEnhancePrompt,
  autoThinking,
  autoSearch,
  onTogglePersonalResources,
  onAutoSaveConversationFilesToLibraryChange,
  onLiveProgressAutoOpenChange,
  onAutoEnhancePromptChange,
  onAutoThinkingChange,
  onAutoSearchChange,
  onDeleteResource,
  onRetryResource,
  onUploadPersonalFiles,
}: SettingsViewProps) {
  const [searxngEnabled, setSearxngEnabled] = useState(true);
  const [documentModeEnabled, setDocumentModeEnabled] = useState(true);
  const [multiAgentVerbose, setMultiAgentVerbose] = useState(false);
  const [showSpecialists, setShowSpecialists] = useState(true);

  useEffect(() => {
    try {
      setSearxngEnabled(window.localStorage.getItem("ai-school:searxng-enabled") !== "0");
      setDocumentModeEnabled(window.localStorage.getItem("ai-school:document-mode-enabled") !== "0");
      setMultiAgentVerbose(window.localStorage.getItem("ai-school:multi-agent-verbose") === "1");
      setShowSpecialists(window.localStorage.getItem("ai-school:show-specialists") !== "0");
    } catch {
      // Keep defaults.
    }
  }, []);

  const persistToggle = (key: string, value: boolean, setter: (value: boolean) => void) => {
    setter(value);
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  };

  const usagePercentCandidates = [
    userSpending?.activityUsagePercent,
    userSpending?.budgetUsagePercent,
    userSpending?.tokenUsagePercent,
  ].filter((value): value is number => typeof value === "number" && value >= 0);
  const usagePercentFromSpending = usagePercentCandidates.length > 0 ? Math.max(...usagePercentCandidates) : null;
  const ratioFromBudget =
    typeof usagePercentFromSpending === "number"
      ? Math.min(1, Math.max(0, usagePercentFromSpending / 100))
      : null;
  const ratioFromActivity = !userSpending && recentChatCount > 0 ? Math.min(1, recentChatCount / 50) : null;
  const ratio = ratioFromBudget ?? ratioFromActivity;
  const percentUsed = typeof ratio === "number" ? Math.max(0, Math.min(100, Math.round(ratio * 1000) / 10)) : null;
  const usageLabel =
    percentUsed === null
      ? "No activity yet"
      : percentUsed >= 80
      ? "High activity"
      : percentUsed >= 40
        ? "Steady activity"
      : percentUsed > 0
          ? "Getting started"
          : "No activity yet";
  const selectedManualModel = models.find((model) => model.modelId === manualModel);
  const routedRecentModel = models.find((model) => model.modelId === activeModelUsed);
  const modelDisplayName =
    routerMode === "manual"
      ? sanitizeModelLabel(selectedManualModel?.name ?? manualModel)
      : "Auto";
  const modelDisplayProvider =
    routerMode === "manual"
      ? selectedManualModel?.provider ?? "Manual selection"
      : routedRecentModel
        ? `Recent final model: ${sanitizeModelLabel(routedRecentModel.name)}`
        : "Live model routing from catalog";
  const modelTags =
    routerMode === "manual"
      ? (selectedManualModel?.tags ?? [])
      : (routedRecentModel?.tags ?? []);

  return (
    <div className="space-y-4">
      <Tabs defaultValue="assistant" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="assistant">Assistant</TabsTrigger>
          <TabsTrigger value="app">App &amp; Account</TabsTrigger>
        </TabsList>

        <TabsContent value="assistant" className="space-y-4">
          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <h3 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Chat options</h3>
            <div className="grid gap-2">
              <AutoChoice label="Enhance prompt" value={autoEnhancePrompt} onChange={onAutoEnhancePromptChange} />
              <AutoChoice label="Thinking" value={autoThinking} onChange={onAutoThinkingChange} />
              <AutoChoice label="Search" value={autoSearch} onChange={onAutoSearchChange} />
            </div>
          </section>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
            <p className="text-[11px] text-[var(--text-secondary)]">Current model path</p>
            <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">{modelDisplayName}</p>
            <p className="text-xs text-[var(--text-secondary)]">{modelDisplayProvider}</p>
            {modelTags.filter((tag) => !/\bfree\b/i.test(tag)).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {modelTags
                  .filter((tag) => !/\bfree\b/i.test(tag))
                  .slice(0, 5)
                  .map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                    >
                      {tag}
                    </span>
                  ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
              <div>
                <p className="text-sm">Use personal resources</p>
                <p className="text-xs text-[var(--text-secondary)]">Include your uploaded files during retrieval</p>
              </div>
              <Switch checked={usePersonalResources} onCheckedChange={onTogglePersonalResources} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
              <div>
                <p className="text-sm">SearXNG web search</p>
                <p className="text-xs text-[var(--text-secondary)]">Prefer open metasearch before model-generated search</p>
              </div>
              <Switch checked={searxngEnabled} onCheckedChange={(value) => persistToggle("ai-school:searxng-enabled", value, setSearxngEnabled)} />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
              <div>
                <p className="text-sm">Auto-open live progress</p>
                <p className="text-xs text-[var(--text-secondary)]">Open orchestration panel while streaming</p>
              </div>
              <Switch checked={liveProgressAutoOpen} onCheckedChange={onLiveProgressAutoOpenChange} />
            </div>
          </div>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-medium text-[var(--text-secondary)]">My files</h3>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  {personalResources.length}/{FILE_LIMITS.maxPersonalLibraryFiles} in library
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]">
                Attach files
                <input
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length > 0) {
                      onUploadPersonalFiles(files);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 mt-2">
              <div>
                <p className="text-sm">Auto-save conversation files</p>
                <p className="text-xs text-[var(--text-secondary)]">Store newly attached files in My Files</p>
              </div>
              <Switch
                checked={autoSaveConversationFilesToLibrary}
                onCheckedChange={onAutoSaveConversationFilesToLibraryChange}
              />
            </div>
            <div className="mt-3 max-h-[min(40vh,26rem)] space-y-2 overflow-y-auto pr-1">
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
                      {(() => {
                        const isStaleProcessing =
                          resource.status === "processing"
                          && typeof resource.updatedAt === "number"
                          && Date.now() - resource.updatedAt > RESOURCE_PROCESSING_STALE_MS;
                        const canRetry =
                          Boolean(onRetryResource)
                          && (resource.status === "failed" || isStaleProcessing);
                        if (!canRetry) return null;
                        return (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-[var(--text-secondary)]"
                            title="Retry processing"
                            onClick={() => onRetryResource?.(resource._id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        );
                      })()}
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
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <h3 className="text-xs font-medium text-[var(--text-secondary)]">Advanced</h3>
            <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
              <div>
                <p className="text-sm">Document generation</p>
                <p className="text-xs text-[var(--text-secondary)]">Inline preview and export for generated documents</p>
              </div>
              <Switch checked={documentModeEnabled} onCheckedChange={(value) => persistToggle("ai-school:document-mode-enabled", value, setDocumentModeEnabled)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
              <div>
                <p className="text-sm">Verbose multi-agent traces</p>
                <p className="text-xs text-[var(--text-secondary)]">Richer collaboration notices during complex runs</p>
              </div>
              <Switch checked={multiAgentVerbose} onCheckedChange={(value) => persistToggle("ai-school:multi-agent-verbose", value, setMultiAgentVerbose)} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
              <div>
                <p className="text-sm">Show specialist models</p>
                <p className="text-xs text-[var(--text-secondary)]">Display specialist model activity in the live panel</p>
              </div>
              <Switch checked={showSpecialists} onCheckedChange={(value) => persistToggle("ai-school:show-specialists", value, setShowSpecialists)} />
            </div>
          </section>
        </TabsContent>



        <TabsContent value="app" className="space-y-4">
          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <h3 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Color theme</h3>
            <p className="mb-3 text-[11px] text-[var(--text-secondary)]">Pick a preset palette or choose a single accent color. Changes apply instantly.</p>
            <ColorPalettePicker />
          </section>

          <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-[var(--text-secondary)]">Monthly activity</h3>
              <span className="text-[10px] text-[var(--text-secondary)]">{usageLabel}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
              <div
                className="h-full rounded-full bg-[var(--gradient-brand)]"
                style={{ width: `${typeof ratio === "number" ? Math.max(ratio > 0 ? 2 : 0, ratio * 100) : 0}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              {percentUsed === null
                ? "No tracked activity yet"
                : `${percentUsed > 0 && percentUsed < 1 ? "<1" : Number.isInteger(percentUsed) ? percentUsed.toFixed(0) : percentUsed.toFixed(1)}% utilization`}
            </p>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CandidateBar({ score }: { score?: number }) {
  const width = typeof score === "number" && Number.isFinite(score) ? Math.max(6, Math.round(score * 100)) : 6;
  return (
    <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
      <div className="h-full rounded-full bg-[var(--accent-cyan)]" style={{ width: `${width}%` }} />
    </div>
  );
}

function RouteTraceView({ trace, showCostDetails = false }: { trace?: RouteTrace; showCostDetails?: boolean }) {
  if (!trace) {
    return <p className="text-sm text-[var(--text-secondary)]">No route trace available.</p>;
  }

  return (
    <div className="w-full space-y-5">
      <section>
        <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Inputs</h4>
        <div className="grid gap-2">
          {[
            { label: "Mode", value: trace.inputs.mode },
            ...(showCostDetails ? [{ label: "Tier", value: trace.inputs.spendingTier }] : []),
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
              className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[10px] font-medium text-[var(--text-secondary)]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ProviderLogo
                      provider={providerFromModelId(candidate.modelId)}
                      modelId={candidate.modelId}
                      size={14}
                      className="h-5 w-5 shrink-0 min-w-[20px]"
                    />
                    <p className="min-w-0 break-all text-xs font-medium text-[var(--text-primary)]">{sanitizeModelId(candidate.modelId)}</p>
                    <span className="ml-auto text-[10px] text-[var(--text-secondary)]">{formatScore(candidate.score)}</span>
                  </div>
                  <div className="mt-1">
                    <CandidateBar score={candidate.score} />
                  </div>
                  {candidate.reason ? (
                    <p className="mt-1 line-clamp-1 text-[11px] text-[var(--text-secondary)]">{candidate.reason}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {trace.usedMemory && trace.usedMemory.length > 0 ? (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Used Memory</h4>
          <div className="space-y-2">
            {trace.usedMemory.map((entry, index) => (
              <div
                key={`${entry.category}:${entry.key}:${index}`}
                className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2"
              >
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                  {entry.category}
                </p>
                <p className="text-xs font-medium text-[var(--text-primary)]">{entry.key}</p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{entry.text}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <h4 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Selected</h4>
        <p className="break-all font-mono text-xs text-[var(--text-primary)]">{sanitizeModelId(trace.selected.modelId)}</p>
        <p className="mt-1 break-words text-xs text-[var(--text-secondary)]">{trace.selected.reason}</p>
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
                <p className="break-all font-mono text-[11px] text-[var(--text-secondary)]">
                  {sanitizeModelId(fallback.fromModel)} → {sanitizeModelId(fallback.toModel)}
                </p>
                <p className="mt-1 break-words text-xs text-[var(--text-secondary)]">{fallback.error}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

type OrchestrationViewProps = {
  sending: boolean;
  collaboratorPhase: "idle" | "running" | "synthesizing";
  activeCollaborators: ActiveCollaborator[];
  streamPhase?: "idle" | "compacting" | "routing" | "searching" | "thinking" | "generating" | "synthesizing";
  livePhasePlan?: RouteTrace["phasePlan"];
  routeTrace?: RouteTrace;
  lastModelUsed?: string;
  searchEnabled?: boolean;
  routerMode?: RouterMode;
};

function orchestrationStage(params: {
  sending: boolean;
  collaboratorPhase: "idle" | "running" | "synthesizing";
  activeCollaborators: ActiveCollaborator[];
  streamPhase?: "idle" | "compacting" | "routing" | "searching" | "thinking" | "generating" | "synthesizing";
  searchEnabled?: boolean;
  hasFinishedWork?: boolean;
}) {
  if (params.streamPhase === "compacting") return "compacting";
  if (params.streamPhase === "routing") return "routing";
  if (params.streamPhase === "searching") return "searching";
  if (params.streamPhase === "thinking") return "thinking";
  if (params.streamPhase === "generating") return "generating";
  if (params.streamPhase === "synthesizing") return "synthesizing";
  if (!params.sending) return params.hasFinishedWork ? "complete" : "idle";
  if (params.collaboratorPhase === "synthesizing") return "generating";
  if (params.activeCollaborators.length > 0 && params.searchEnabled) return "searching";
  if (params.activeCollaborators.length > 0) return "generating";
  return "thinking";
}

function phaseLabelForId(id: string) {
  const labels: Record<string, string> = {
    routing: "Plan route",
    retrieval: "Use your files",
    search: "Check live sources",
    planning: "Split work",
    analysis: "Analyze",
    authoring: "Draft response",
    synthesis: "Merge specialists",
    verification: "Verify claims",
    repair: "Polish format",
    memory: "Update memory",
    title: "Name chat",
  };
  return labels[id] ?? id.replace(/_/g, " ");
}

function phaseStatusTone(status: string) {
  if (status === "completed") return "text-[var(--success)]";
  if (status === "running") return "text-[var(--accent-cyan)]";
  if (status === "failed") return "text-[var(--danger)]";
  return "text-[var(--text-secondary)]";
}

function OrchestrationView({
  sending,
  collaboratorPhase,
  activeCollaborators,
  streamPhase,
  livePhasePlan,
  routeTrace,
  lastModelUsed,
  searchEnabled,
  routerMode,
}: OrchestrationViewProps) {
  const isManual = routerMode === "manual";

  const roleLabel = (value: string) =>
    value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const statusLabel = (value: ActiveCollaborator["status"]) => {
    if (value === "pending") return "queued";
    if (value === "running") return "running";
    if (value === "done") return "done";
    if (value === "failed") return "failed";
    return "skipped";
  };
  const visibleCollaborators = activeCollaborators.filter((agent) => agent.status !== "failed");
  const stage = orchestrationStage({
    sending,
    collaboratorPhase,
    activeCollaborators,
    streamPhase,
    searchEnabled,
    hasFinishedWork: Boolean(routeTrace || livePhasePlan?.length || lastModelUsed),
  });
  const displayedPhasePlan = livePhasePlan && livePhasePlan.length > 0
    ? livePhasePlan
    : routeTrace?.phasePlan;

  // Track which steps have been seen during this session
  const [seenSteps, setSeenSteps] = useState<Set<string>>(new Set(["idle"]));
  useEffect(() => {
    if (stage && stage !== "idle") {
      setSeenSteps((prev) => new Set([...prev, stage]));
    }
    if (stage === "complete") {
      setSeenSteps((prev) => new Set([...prev, "complete"]));
    }
  }, [stage]);

  // Build the ordered list of steps to display: only steps seen or currently active
  const allSteps = ["idle", "compacting", "routing", "searching", "thinking", "generating", "synthesizing", "complete"] as const;
  // When in manual mode, suppress routing step
  const visibleStepSet = new Set(seenSteps);
  if (stage !== "idle") visibleStepSet.add(stage);
  if (sending) visibleStepSet.add("complete"); // always show "complete" while streaming
  const displaySteps = allSteps.filter((s) => {
    if (s === "idle") return false; // always hide "idle" — it's implied
    if (s === "routing" && isManual) return false;
    if (s === "searching" && !searchEnabled && !visibleStepSet.has("searching")) return false;
    if (s === "compacting" && !visibleStepSet.has("compacting")) return false;
    if (s === "synthesizing" && visibleCollaborators.length === 0 && !visibleStepSet.has("synthesizing")) return false;
    return visibleStepSet.has(s) || s === "complete";
  });

  const stageIndex = displaySteps.indexOf(stage as typeof displaySteps[number]);
  const selectedModel = routeTrace?.selected.modelId || lastModelUsed;
  const selectedReason =
    routeTrace?.selected.reason ||
    (isManual
      ? "Model was manually selected — no routing decision made."
      : sending
        ? "Final model reason will appear when this response finishes."
        : "No route trace captured yet for this chat.");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Current phase</p>
          <span className={`rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${sending ? "bg-[color-mix(in_oklab,var(--success)_12%,var(--bg-secondary))] text-[var(--success)]" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
            {sending ? "Live" : "Idle"}
          </span>
        </div>
        <p className="mt-1 text-sm font-medium capitalize text-[var(--text-primary)]">{stage === "idle" ? (sending ? "starting…" : "waiting") : stage}</p>
      </section>

      {displayedPhasePlan && displayedPhasePlan.length > 0 ? (
        <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Executed phases</p>
          <ol className="space-y-2">
            {displayedPhasePlan.map((phase) => (
              <li key={phase.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-[var(--text-primary)]">{phase.label || phaseLabelForId(phase.id)}</p>
                  <span className={`text-[10px] uppercase tracking-[0.08em] ${phaseStatusTone(phase.status)}`}>
                    {phase.status}
                  </span>
                </div>
                {phase.model ? <p className="mt-1 break-all font-mono text-[10px] text-[var(--text-secondary)]">{sanitizeModelId(phase.model)}</p> : null}
                {phase.detail ? <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{phase.detail}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {visibleCollaborators.length > 0 ? (
        <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Specialists</p>
          <ol className="space-y-2">
            {visibleCollaborators.map((agent) => (
              <li key={agent.role} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-[var(--text-primary)]">{roleLabel(agent.role)}</p>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">{statusLabel(agent.status)}</span>
                </div>
                {agent.model ? (
                  <p className="mt-1 break-all font-mono text-[10px] text-[var(--text-secondary)]">{sanitizeModelId(agent.model)}</p>
                ) : null}
                {typeof agent.tokensUsed === "number" ? (
                  <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{agent.tokensUsed} tokens</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {displaySteps.length > 0 && (
        <section className={`rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 transition-all duration-300 ${stage === "complete" && !sending ? "opacity-60" : ""}`}>
          <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Progress</p>
          <ol className="space-y-1.5">
            {displaySteps.map((item, index) => {
              const isComplete = stage === "complete";
              const done = isComplete || (stage !== "idle" && index < stageIndex);
              const active = stage !== "idle" && stage !== "complete" && item === stage;
              const skipped = !done && !active && stage !== "idle" && index < stageIndex;
              return (
                <li key={item} className="flex items-center gap-2">
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent-cyan)]" />
                  ) : skipped ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                  ) : (
                    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      <span className="h-2 w-2 rounded-full bg-[var(--border-default)]" />
                    </span>
                  )}
                  <span className={`text-xs capitalize ${active ? "font-medium text-[var(--text-primary)]" : done ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}`}>
                    {item === "complete"
                      ? (isComplete ? "Done" : "Completing…")
                      : item}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Model decision</p>
        <div className="flex items-start gap-2">
          <Bot className="mt-0.5 h-4 w-4 text-[var(--accent-cyan)]" />
          <div>
            <p className="font-mono text-xs text-[var(--text-primary)]">{selectedModel ? sanitizeModelId(selectedModel) : "Pending"}</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{selectedReason}</p>
          </div>
        </div>
        {routeTrace?.toolchain && routeTrace.toolchain.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {routeTrace.toolchain.slice(0, 8).map((tool) => (
              <span
                key={tool}
                className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
              >
                {formatToolchainLabel(tool)}
              </span>
            ))}
          </div>
        ) : null}
      </section>
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
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Sources</p>
        <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">{citations.length}</span>
      </div>
      {citations.map((citation, index) => {
        const href = hrefForCitation(citation);
        const isSearch = citation.sourceType === "search";
        const label = citation.title || citation.filename;

        return (
          <article
            key={`${citation.filename}-${index}`}
            className="min-h-[9.25rem] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-3"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                {isSearch ? <Milestone className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                <span className="truncate uppercase tracking-[0.08em]">Source {index + 1} · {citation.sourceType}</span>
              </span>
              <div className="flex items-center gap-1.5">
                {citation.page ? (
                  <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] uppercase tracking-[0.06em]">
                    Page {citation.page}
                  </span>
                ) : null}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex cursor-pointer rounded-md border border-[var(--border-default)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                  >
                    {citation.url ? "Open" : "Download"}
                  </a>
                ) : null}
              </div>
            </div>

            <p className="mt-2 break-words text-sm font-semibold text-[var(--text-primary)]">{label}</p>
            {isSearch && citation.domain ? <p className="mt-1 break-all text-xs text-[var(--text-secondary)]">{citation.domain}</p> : null}

            <div className="mt-2 min-h-[4.5rem] rounded-md bg-[var(--bg-secondary)] px-2.5 py-2">
              {citation.snippet ? (
                <RichText content={citation.snippet} className="text-xs leading-relaxed text-[var(--text-secondary)]" />
              ) : (
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">No preview snippet available.</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function QuizPanelView({ quiz }: { quiz?: PanelQuizData }) {
  if (!quiz || quiz.questions.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">No quiz data available.</p>;
  }

  const current = quiz.questions[Math.min(quiz.activeIndex, Math.max(0, quiz.questions.length - 1))];
  const score = quiz.questions.filter(
    (question) => question.correct && quiz.answers[question.id] === question.correct,
  ).length;
  const isLast = quiz.activeIndex >= quiz.questions.length - 1;

  if (!current) {
    return <p className="text-sm text-[var(--text-secondary)]">No quiz data available.</p>;
  }

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Quiz</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Question {quiz.activeIndex + 1} / {quiz.questions.length}
        </p>
      </section>

      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <RichText content={current.prompt} className="mb-3 text-sm font-medium text-[var(--text-primary)]" />
        <div className="space-y-2">
          {current.options.map((option) => {
            const selectedOption = quiz.answers[current.id] === option.letter;
            const isCorrect = quiz.submitted && current.correct === option.letter;
            const isWrongSelected =
              quiz.submitted && selectedOption && current.correct && current.correct !== option.letter;
            return (
              <button
                key={`${current.id}-${option.letter}`}
                type="button"
                disabled={quiz.submitted}
                onClick={() => quiz.onSelectAnswer(current.id, option.letter)}
                className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition disabled:cursor-default ${
                  isCorrect
                    ? "border-[color-mix(in_oklab,var(--success)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_10%,transparent)]"
                    : isWrongSelected
                      ? "border-[color-mix(in_oklab,var(--danger)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]"
                      : selectedOption
                        ? "border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_18%,var(--bg-secondary))] ring-1 ring-[var(--accent-cyan)]/50"
                        : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="font-medium">{option.letter}.</span>
                <RichText content={option.text} className="flex-1 text-sm" />
                {!quiz.submitted && selectedOption ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--accent-cyan)]" />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {quiz.activeIndex > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => quiz.onSetIndex(Math.max(0, quiz.activeIndex - 1))}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {quiz.submitted ? (
            <>
              {!isLast ? (
                <Button
                  type="button"
                  onClick={() => quiz.onSetIndex(Math.min(quiz.questions.length - 1, quiz.activeIndex + 1))}
                  className="gap-1.5"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              type="button"
              onClick={() => {
                if (isLast) {
                  quiz.onSubmit();
                  return;
                }
                quiz.onSetIndex(Math.min(quiz.questions.length - 1, quiz.activeIndex + 1));
              }}
              className="gap-1.5"
            >
              {isLast ? "Check Answers" : "Next"}
              {!isLast ? <ChevronRight className="h-4 w-4" /> : null}
            </Button>
          )}
        </div>
      </div>

      {!quiz.submitted ? (
        <p className="text-xs text-[var(--text-secondary)]">
          Answered {Object.keys(quiz.answers).length}/{quiz.questions.length}
        </p>
      ) : (
        <p className="text-sm font-medium text-[var(--text-primary)]">
          Score: {score}/{quiz.questions.length}
        </p>
      )}

      {quiz.submitted ? (
        <div className="space-y-2">
          {quiz.questions.map((question, index) => {
            const userAnswer = quiz.answers[question.id];
            const isCorrect = question.correct && userAnswer === question.correct;
            return (
              <div
                key={question.id}
                className={`rounded-xl border p-3 ${
                  isCorrect
                    ? "border-[color-mix(in_oklab,var(--success)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_6%,transparent)]"
                    : "border-[color-mix(in_oklab,var(--danger)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--danger)_6%,transparent)]"
                }`}
              >
                <div className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0">
                    {isCorrect ? (
                      <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                    ) : (
                      <XCircle className="h-4 w-4 text-[var(--danger)]" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <RichText content={`**Q${index + 1}.** ${question.prompt}`} className="text-sm font-medium text-[var(--text-primary)]" />
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      Your answer: {userAnswer ?? "none"} {question.correct ? `• Correct: ${question.correct}` : ""}
                    </p>
                    {question.explanation ? (
                      <div className="mt-1.5 rounded-lg bg-[var(--bg-secondary)] p-2 text-xs text-[var(--text-secondary)]">
                        <RichText content={question.explanation} className="text-xs" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type UnifiedPanelProps = {
  settingsProps?: SettingsViewProps;
  orchestrationProps?: OrchestrationViewProps;
  canvasProps?: {
    open: boolean;
    code: string;
    language: string;
    previewDoc: string;
    versions: Array<{
      id: string;
      label: string;
      code: string;
      language: string;
      createdAt: number;
    }>;
    activeVersionId?: string;
    onClose: () => void;
    onCodeChange: (value: string) => void;
    onLanguageChange: (value: string) => void;
    onRun: () => void;
    onSaveVersion: () => void;
    onRestoreVersion: (id: string) => void;
    onAskAiModify: (instruction: string) => void;
  };
};

export function UnifiedPanel({ settingsProps, orchestrationProps, canvasProps }: UnifiedPanelProps) {
  const { activeView, panelData, closePanel, backPanel, canGoBack } = usePanel();
  const compact = useCompactSheet(980);
  const mobileOverlay = useCompactSheet(767);
  const [internalView, setInternalView] = useState<string | null>(activeView);
  const currentView = activeView || internalView;

  const maxWidthPx =
    currentView === "quiz"
      ? 460
      : currentView === "canvas"
        ? 1100
      : currentView === "route-trace"
        ? 500
        : currentView === "settings"
          ? 400
          : 360;

  const { docked, panelWidth } = useRightPanelDock({
    id: "unified-panel",
    open: !!currentView,
    compact,
    maxWidthPx,
    minMainWidthPx: currentView === "settings" ? 620 : currentView === "canvas" ? 520 : 720,
    reserveLeftPx: 160,
  });

  const [collapsed, setCollapsed] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const prevViewRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeView) {
      setInternalView(activeView);
      setCollapsed(false);
      // Trigger slide-in animation when panel opens
      if (!prevViewRef.current) {
        requestAnimationFrame(() => setAnimateIn(true));
      }
    } else if (internalView) {
      // Trigger slide-out: animateIn=false moves aside to translateX(100%) via CSS transition,
      // and the outer wrapper width collapses to 0 simultaneously.
      setAnimateIn(false);
      const timer = setTimeout(() => {
        setInternalView(null);
      }, 400);
      return () => {
        clearTimeout(timer);
      };
    }
    prevViewRef.current = activeView;
  }, [activeView, internalView]);

  if (!internalView) return null;

  const titles: Record<string, { subtitle: string; title: string }> = {
    settings: { subtitle: "Configuration", title: "Chat Settings" },
    "route-trace": { subtitle: "Route Trace", title: "Model Decision Timeline" },
    sources: { subtitle: "Sources", title: "Citation Details" },
    orchestration: { subtitle: "Orchestrator", title: "Live Progress" },
    quiz: { subtitle: "Quiz", title: "Quiz Review" },
    canvas: { subtitle: "Canvas", title: "Artifact Workspace" },
  };

  const current = titles[internalView] ?? { subtitle: "Panel", title: "Details" };

  return (
    <div
      className={docked ? "relative z-40 h-full shrink-0 overflow-hidden" : "fixed inset-0 z-50"}
      style={docked ? { width: animateIn ? `${panelWidth}px` : "0px", transition: "width 0.35s cubic-bezier(0.22, 1, 0.36, 1)" } : undefined}
    >
      {!docked ? (
        <button
          type="button"
          className={`absolute inset-0 cursor-pointer transition ${mobileOverlay ? "bg-black/45 backdrop-blur-[2px]" : "bg-transparent"}`}
          onClick={closePanel}
          aria-label="Close panel"
        />
      ) : null}

      <aside
        ref={shellRef as React.RefObject<HTMLElement>}
        className={`right-panel-shell ${rightPanelSurfaceClassName()} pointer-events-auto flex flex-col ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          docked
            ? "relative h-full border-l border-[var(--border-default)] p-0"
            : mobileOverlay
              ? "absolute inset-0 rounded-none border-0 p-0"
              : compact
              ? "absolute bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border p-4"
              : "absolute inset-y-0 right-0 w-[92vw] border-l p-4"
        }`}
        style={{
          ...(docked
            ? {
                width: `${panelWidth}px`,
                height: "100%",
                opacity: 1,
                transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
                transform: animateIn ? "translateX(0)" : "translateX(100%)",
              }
            : mobileOverlay
              ? { width: "100%", height: "100%" }
              : compact
              ? {}
              : { maxWidth: `${maxWidthPx}px` }),
          ...(!docked ? {
            transition: "transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.5s ease",
            transform: animateIn ? "translateX(0)" : compact && !mobileOverlay ? "translateY(16px)" : "translateX(32px)",
            opacity: animateIn ? 1 : 0,
          } : {}),
        }}
      >
        <div
          className={`flex items-center justify-between shrink-0 relative after:content-[''] after:absolute after:top-[56px] after:left-0 after:right-0 after:h-px after:bg-[var(--border-default)] ${docked ? "min-h-[56px] px-5 pb-3 pt-2.5" : "min-h-[56px] mb-4"}`}
        >
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-secondary)] truncate">{current.subtitle}</p>
            <h3 className={`truncate font-display text-[var(--text-primary)] ${docked ? "text-xl" : "text-2xl"}`}>{current.title}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {compact && !mobileOverlay ? (
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
            <Button type="button" variant="ghost" size="icon" onClick={closePanel} aria-label="Close panel">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!collapsed ? (
          <div className={`right-panel-content w-full min-w-0 min-h-0 flex-1 overflow-x-hidden overflow-y-auto ${activeView === "canvas" ? "p-0" : docked ? "px-5 py-4" : "pr-1"}`}>
            {activeView === "settings" && settingsProps && <SettingsView {...settingsProps} />}
            {activeView === "route-trace" && (
              <RouteTraceView trace={panelData.routeTrace ?? orchestrationProps?.routeTrace} showCostDetails={Boolean(settingsProps?.showCostDetails)} />
            )}
            {activeView === "sources" && <SourcesView citations={panelData.sources ?? []} />}
            {activeView === "orchestration" && (
              orchestrationProps
                ? <OrchestrationView {...orchestrationProps} />
                : <p className="text-sm text-[var(--text-secondary)]">No live orchestration data available.</p>
            )}
            {activeView === "quiz" && <QuizPanelView quiz={panelData.quiz} />}
            {activeView === "canvas" && canvasProps ? (
              <CodeCanvas
                {...canvasProps}
                open
                embedded
                showBackButton={canGoBack}
                onBack={backPanel}
              />
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
