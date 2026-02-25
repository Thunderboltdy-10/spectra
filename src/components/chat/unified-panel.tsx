"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Settings2, X, XCircle, FileText, Milestone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";
import { ChatModeSelector } from "@/components/chat/chat-mode-selector";
import type { ActiveCollaborator } from "@/components/chat/collaborators-live";
import { RichText } from "@/components/chat/rich-text";
import { usePanel, type PanelQuizData } from "@/context/panel-context";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";
import type { AutoPreference, ModelOption, PersonalResource, UserSpending } from "@/hooks/use-chat-state";
import type { RouterMode, StudyMode, ThinkingLevel, Citation, RouteTrace } from "@/types";
import { FILE_LIMITS } from "@/lib/file-limits";

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
  const ratio = userSpending
    ? Math.min(
        Math.max(
          typeof userSpending.budgetUsagePercent === "number"
            ? userSpending.budgetUsagePercent / 100
            : (userSpending.totalCostCents ?? 0) / Math.max(1, userSpending.hardLimitCents ?? 1),
          0,
        ),
        1,
      )
    : 0;
  const percentUsed = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const usageLabel =
    percentUsed >= 80
      ? "High activity"
      : percentUsed >= 40
        ? "Steady activity"
        : percentUsed > 0
          ? "Getting started"
          : "No activity yet";
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
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{usageLabel}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
          <div
            className="h-full rounded-full bg-[var(--gradient-brand)]"
            style={{ width: `${Math.max(0, ratio * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          {percentUsed}% utilization
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

type OrchestrationViewProps = {
  sending: boolean;
  collaboratorPhase: "idle" | "running" | "synthesizing";
  activeCollaborators: ActiveCollaborator[];
  routeTrace?: RouteTrace;
  lastModelUsed?: string;
  searchEnabled?: boolean;
};

function orchestrationStage(params: {
  sending: boolean;
  collaboratorPhase: "idle" | "running" | "synthesizing";
  activeCollaborators: ActiveCollaborator[];
  searchEnabled?: boolean;
}) {
  if (!params.sending) return "verifying";
  if (params.collaboratorPhase === "synthesizing") return "generating";
  if (params.activeCollaborators.length > 0 && params.searchEnabled) return "searching";
  if (params.activeCollaborators.length > 0) return "generating";
  return "thinking";
}

function OrchestrationView({
  sending,
  collaboratorPhase,
  activeCollaborators,
  routeTrace,
  lastModelUsed,
  searchEnabled,
}: OrchestrationViewProps) {
  const stage = orchestrationStage({
    sending,
    collaboratorPhase,
    activeCollaborators,
    searchEnabled,
  });
  const steps = ["thinking", "searching", "generating", "verifying"] as const;
  const stageIndex = steps.indexOf(stage);
  const selectedModel = routeTrace?.selected.modelId || lastModelUsed;
  const selectedReason =
    routeTrace?.selected.reason ||
    (sending
      ? "Final model reason will appear when this response finishes."
      : "No route trace captured yet for this chat.");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Current phase</p>
          <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            {sending ? "Live" : "Idle"}
          </span>
        </div>
        <p className="mt-1 text-sm font-medium capitalize text-[var(--text-primary)]">{stage}</p>
      </section>

      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Progress</p>
        <ol className="space-y-1.5">
          {steps.map((item, index) => {
            const done = !sending || index < stageIndex;
            const active = sending && index === stageIndex;
            return (
              <li key={item} className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    done
                      ? "bg-[var(--success)]"
                      : active
                        ? "bg-[var(--accent-cyan)]"
                        : "bg-[var(--border-default)]"
                  }`}
                />
                <span className={`text-xs capitalize ${active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                  {item}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Active agents</p>
        {activeCollaborators.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No specialist agents active right now.</p>
        ) : (
          <div className="space-y-2">
            {activeCollaborators.map((agent) => (
              <div
                key={agent.role}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium capitalize text-[var(--text-primary)]">{agent.role.replace(/_/g, " ")}</p>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">{agent.status}</span>
                </div>
                {agent.model ? (
                  <p className="mt-1 font-mono text-[10px] text-[var(--text-secondary)]">
                    {sanitizeModelId(agent.model)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

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
                {tool}
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
      {citations.map((citation, index) => {
        const href = hrefForCitation(citation);
        const isSearch = citation.sourceType === "search";
        const label = citation.title || citation.filename;

        return (
          <article
            key={`${citation.filename}-${index}`}
            className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"
          >
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              {isSearch ? <Milestone className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
              <span className="uppercase tracking-[0.08em]">[{index + 1}] {citation.sourceType}</span>
            </div>

            <p className="font-medium text-[var(--text-primary)]">{label}</p>
            {isSearch && citation.domain ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{citation.domain}</p> : null}
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
};

export function UnifiedPanel({ settingsProps, orchestrationProps }: UnifiedPanelProps) {
  const { activeView, panelData, closePanel } = usePanel();
  const compact = useCompactSheet(1024);
  const maxWidthPx = activeView === "settings" ? 400 : activeView === "quiz" ? 460 : 520;
  const { docked, isOverlay, panelWidth } = useRightPanelDock({
    id: "unified-panel",
    open: !!activeView,
    compact,
    maxWidthPx,
  });
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
    orchestration: { subtitle: "Orchestrator", title: "Live Progress" },
    quiz: { subtitle: "Quiz", title: "Quiz Review" },
  };

  const current = titles[activeView] ?? { subtitle: "Panel", title: "Details" };

  return (
    <div
      className={docked ? "relative z-40 h-full shrink-0" : "fixed inset-0 z-50"}
      style={docked ? { width: `${panelWidth}px` } : undefined}
    >
      {!docked ? (
        <button
          type="button"
          className={`absolute inset-0 cursor-pointer transition ${isOverlay ? "bg-black/40" : "bg-transparent"}`}
          onClick={closePanel}
          aria-label="Close panel"
        />
      ) : null}

      <aside
        className={`right-panel-shell ${rightPanelSurfaceClassName()} pointer-events-auto flex flex-col p-4 ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          docked
            ? "relative h-full w-full"
            : compact
              ? "absolute bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border"
              : "absolute inset-y-0 right-0 w-[92vw] border-l"
        }`}
        style={
          docked
            ? { width: "100%", height: "100%" }
            : compact
              ? undefined
              : { maxWidth: `${maxWidthPx}px` }
        }
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
            {activeView === "route-trace" && <RouteTraceView trace={panelData.routeTrace ?? orchestrationProps?.routeTrace} />}
            {activeView === "sources" && <SourcesView citations={panelData.sources ?? []} />}
            {activeView === "orchestration" && (
              orchestrationProps
                ? <OrchestrationView {...orchestrationProps} />
                : <p className="text-sm text-[var(--text-secondary)]">No live orchestration data available.</p>
            )}
            {activeView === "quiz" && <QuizPanelView quiz={panelData.quiz} />}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
