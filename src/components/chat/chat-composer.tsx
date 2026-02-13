"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Paperclip,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ALL_MODES, getModeConfig } from "@/lib/modes";
import type { Agent } from "@/types";
import type { AutoPreference, FileStatus, ModelOption } from "@/hooks/use-chat-state";
import type { RouterMode, StudyMode } from "@/types";
import { fuzzyScore } from "@/lib/fuzzy-model-search";
import { cn } from "@/lib/utils";

type ChatComposerProps = {
  message: string;
  onMessageChange: (value: string) => void;
  fileList: File[];
  fileUploadState: Record<string, { status: FileStatus; thumbnailUrl?: string; error?: string }>;
  onFilesAdd: (files: File[]) => void;
  onRemoveFile: (file: File) => void;
  onSend: () => void;
  onStop?: () => void;
  sending: boolean;
  mode: StudyMode;
  onModeChange?: (mode: StudyMode) => void;
  agents: Agent[];
  selectedAgentId?: string;
  onSelectAgent: (agentId?: string) => void;
  models: ModelOption[];
  routerMode: RouterMode;
  manualModel: string;
  onSelectAuto: () => void;
  onSelectModel: (modelId: string) => void;
  autoEnhancePrompt: AutoPreference;
  autoThinking: AutoPreference;
  autoSearch: AutoPreference;
  onAutoEnhancePromptChange: (value: AutoPreference) => void;
  onAutoThinkingChange: (value: AutoPreference) => void;
  onAutoSearchChange: (value: AutoPreference) => void;
  lastAutoResult?: {
    promptEnhanced: boolean;
    searchEnabled: boolean;
    thinkingLevel: "low" | "medium" | "high";
  } | null;
};

function formatModelLabel(modelId: string) {
  const raw = modelId.split("/").pop() ?? modelId;
  const clean = raw.replace(/:free$/i, "").replace(/-\d{4}-\d{2}-\d{2}$/i, "");
  return clean
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((word) => {
      if (/^\d+(\.\d+)?$/.test(word)) return word;
      if (/^(gpt|o3|o4|r1|claude|gemini)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function formatNumberCompact(value?: number) {
  if (!value || value <= 0) return "—";
  return Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function formatModelCost(value?: number, isFree?: boolean) {
  if (isFree) return "$0.0000/M";
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value <= 0) return "$0.0000/M";
  if (value < 0.01) return `$${value.toFixed(4)}/M`;
  return `$${value.toFixed(2)}/M`;
}

function normalizeModelSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanModelDisplayText(value: string) {
  return value
    .replace(/:free/gi, "")
    .replace(/\bfree\b/gi, "")
    .replace(/\s*&\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function dataTransferHasFiles(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file")) return true;
  return Array.from(dataTransfer.types ?? []).includes("Files");
}

function filesFromDataTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return [];
  const fromItems = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (fromItems.length > 0) return fromItems;
  return Array.from(dataTransfer.files ?? []);
}

function nextPreference(value: AutoPreference): AutoPreference {
  if (value === "auto") return "on";
  if (value === "on") return "off";
  return "auto";
}

function preferenceLabel(value: AutoPreference) {
  if (value === "auto") return "Auto";
  if (value === "on") return "Yes";
  return "No";
}

function sortedByPopularity(models: ModelOption[]) {
  const POPULAR_MODELS = [
    "openrouter/auto",
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-4.1-mini",
    "google/gemini-2.5-pro",
    "perplexity/sonar",
    "perplexity/sonar-pro",
    "deepseek/deepseek-r1-0528:free",
    "google/gemini-2.0-flash-exp:free",
  ];

  return [...models].sort((a, b) => {
    const aRank = POPULAR_MODELS.indexOf(a.modelId);
    const bRank = POPULAR_MODELS.indexOf(b.modelId);
    const aScore = aRank === -1 ? 999 : aRank;
    const bScore = bRank === -1 ? 999 : bRank;
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name);
  });
}

function SettingPill({
  label,
  value,
  onChange,
  title,
  icon,
}: {
  label: string;
  value: AutoPreference;
  onChange: (value: AutoPreference) => void;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(nextPreference(value))}
      title={title}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
    >
      {icon}
      <span>{label}: {preferenceLabel(value)}</span>
    </button>
  );
}

export function ChatComposer({
  message,
  onMessageChange,
  fileList,
  fileUploadState,
  onFilesAdd,
  onRemoveFile,
  onSend,
  onStop,
  sending,
  mode,
  onModeChange,
  agents,
  selectedAgentId,
  onSelectAgent,
  models,
  routerMode,
  manualModel,
  onSelectAuto,
  onSelectModel,
  autoEnhancePrompt,
  autoThinking,
  autoSearch,
  onAutoEnhancePromptChange,
  onAutoThinkingChange,
  onAutoSearchChange,
  lastAutoResult,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelSearchRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const modeConfig = getModeConfig(mode);
  const selectedModel = useMemo(
    () => models.find((item) => item.modelId === manualModel),
    [manualModel, models],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent._id === selectedAgentId),
    [agents, selectedAgentId],
  );
  const displayedModels = useMemo(() => {
    const clean = modelSearch.trim();
    const normalized = normalizeModelSearch(clean);
    const sorted = sortedByPopularity(models);
    if (!normalized) return sorted;
    return sorted
      .map((model) => {
        const haystack = normalizeModelSearch(`${model.name} ${model.modelId} ${model.provider}`);
        const compactHaystack = haystack.replace(/\s+/g, "");
        const compactNeedle = normalized.replace(/\s+/g, "");
        const includes = haystack.includes(normalized) || compactHaystack.includes(compactNeedle);
        const score = fuzzyScore(normalized, {
          name: model.name,
          modelId: model.modelId,
          provider: model.provider,
          description: model.description,
        });
        return { model, includes, score };
      })
      .filter((row) => row.includes || row.score > 0.35)
      .sort((a, b) => {
        if (a.includes !== b.includes) return a.includes ? -1 : 1;
        return b.score - a.score;
      })
      .map((row) => row.model);
  }, [modelSearch, models]);
  const selectorTriggerClass =
    "inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]";

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [message]);

  useEffect(() => {
    if (!showModelSelector) return;
    const timer = window.setTimeout(() => modelSearchRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [showModelSelector]);

  useEffect(() => {
    const preventWindowFileDrop = (event: DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
    };
    const clearDragState = () => {
      dragDepthRef.current = 0;
      setDraggingFiles(false);
    };

    window.addEventListener("dragover", preventWindowFileDrop);
    window.addEventListener("drop", preventWindowFileDrop);
    window.addEventListener("dragend", clearDragState);
    window.addEventListener("drop", clearDragState);

    return () => {
      window.removeEventListener("dragover", preventWindowFileDrop);
      window.removeEventListener("drop", preventWindowFileDrop);
      window.removeEventListener("dragend", clearDragState);
      window.removeEventListener("drop", clearDragState);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (showModeSelector && modeMenuRef.current && !modeMenuRef.current.contains(target)) {
        setShowModeSelector(false);
      }
      if (showModelSelector && modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setShowModelSelector(false);
      }
      if (showAgentSelector && agentMenuRef.current && !agentMenuRef.current.contains(target)) {
        setShowAgentSelector(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showAgentSelector, showModeSelector, showModelSelector]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSend();
    }
  }

  function handleModeSelect(newMode: StudyMode) {
    if (onModeChange) {
      onModeChange(newMode);
    }
    setShowModeSelector(false);
  }

  function fileKey(file: File) {
    return `${file.name}-${file.size}-${file.lastModified}`;
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = filesFromDataTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    onFilesAdd(files);
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!draggingFiles) {
      setDraggingFiles(true);
    }
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDraggingFiles(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length > 0) {
      onFilesAdd(files);
    }
  }

  function renderStatus(status: FileStatus) {
    if (status === "uploading") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Uploading
        </span>
      );
    }
    if (status === "ready") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--success)]">
          <CheckCircle2 className="h-3 w-3" />
          Ready
        </span>
      );
    }
    if (status === "error") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--danger)]">
          <AlertCircle className="h-3 w-3" />
          Error
        </span>
      );
    }
    return null;
  }

  return (
    <footer
      className={cn(
        "border-t border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_90%,transparent)] px-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:px-6 lg:px-10",
        draggingFiles && "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-primary))]",
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mx-auto w-full max-w-5xl">
        {draggingFiles && (
          <div className="mb-2 rounded-xl border border-dashed border-[color-mix(in_oklab,var(--accent-cyan)_55%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] px-3 py-2 text-xs font-medium text-[var(--accent-cyan)]">
            Drop files to attach
          </div>
        )}

        {fileList.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {fileList.map((file) => {
              const status = fileUploadState[fileKey(file)]?.status ?? "pending";
              const thumbnailUrl = fileUploadState[fileKey(file)]?.thumbnailUrl;
              const extension = file.name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
              return (
              <span
                key={`${file.name}-${file.size}`}
                className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2 text-xs font-medium shadow-sm"
              >
                {thumbnailUrl ? (
                  <Image
                    src={thumbnailUrl}
                    alt={file.name}
                    className="h-16 w-16 rounded-lg object-cover"
                    width={64}
                    height={64}
                  />
                ) : (
                  <span className="inline-flex h-12 min-w-12 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-1.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                    <FileText className="mr-1 h-3 w-3" />
                    {extension}
                  </span>
                )}
                <span className="max-w-[220px] truncate">{file.name}</span>
                {renderStatus(status)}
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-[var(--bg-hover)]"
                  onClick={() => onRemoveFile(file)}
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
              );
            })}
          </div>
        )}

        <div className="relative rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <div ref={modeMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowModeSelector((prev) => !prev)}
                  title={modeConfig.description}
                  className={selectorTriggerClass}
                >
                  <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: modeConfig.color }} />
                  <span>{modeConfig.label}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showModeSelector && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 max-h-[360px] w-[min(92vw,22rem)] overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
                    {ALL_MODES.map((m) => {
                      const mc = getModeConfig(m.key);
                      const isActive = m.key === mode;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => handleModeSelect(m.key)}
                          className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                            isActive
                              ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: mc.color }} />
                          <div>
                            <p>{mc.label}</p>
                            <p className="text-[11px] text-[var(--text-secondary)]">{mc.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div ref={modelMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowModelSelector((prev) => !prev)}
                  title="Choose model manually or keep auto-routing"
                  className={selectorTriggerClass}
                >
                  <Bot className="h-4 w-4" />
                  <span className="max-w-[260px] truncate">
                    {routerMode === "auto" || routerMode === "openrouter_auto"
                      ? "Auto model"
                      : formatModelLabel(selectedModel?.modelId ?? manualModel)}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showModelSelector && (
                  <div className="absolute bottom-full left-1/2 z-20 mb-2 max-h-[420px] w-[min(92vw,30rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow-soft)]">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">Choose model</p>
                      <button
                        type="button"
                        onClick={() => setShowModelSelector(false)}
                        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
                        aria-label="Close model selector"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mb-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--text-secondary)]" />
                        <input
                          ref={modelSearchRef}
                          value={modelSearch}
                          onChange={(event) => setModelSearch(event.target.value)}
                          placeholder="Search models"
                          className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] pl-8 pr-2 text-sm"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onSelectAuto();
                        setShowModelSelector(false);
                      }}
                      className={`mb-1 flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                        routerMode === "auto" || routerMode === "openrouter_auto"
                          ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span>Auto model routing</span>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>

                    <div className="max-h-[300px] overflow-y-auto pr-1">
                      {displayedModels.map((model) => {
                        const displayName = cleanModelDisplayText(model.name) || formatModelLabel(model.modelId);
                        const isSelected = routerMode === "manual" && manualModel === model.modelId;
                        const displayModelId = cleanModelDisplayText(model.modelId);

                        return (
                          <button
                            key={model.modelId}
                            type="button"
                            onClick={() => {
                              onSelectModel(model.modelId);
                              setShowModelSelector(false);
                            }}
                            className={`mb-1 flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                              isSelected
                                ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                                : "hover:bg-[var(--bg-hover)]"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold text-[var(--text-primary)]">{displayName}</p>
                              <p className="truncate text-[11px] text-[var(--text-secondary)]">{model.provider}</p>
                              <p className="truncate text-[10px] text-[var(--text-secondary)]">{displayModelId}</p>
                            </div>
                            <div className="shrink-0 text-right text-[10px] text-[var(--text-secondary)]">
                              <p>Ctx {formatNumberCompact(model.contextLength)}</p>
                              <p>In {formatModelCost(model.inputCostPerM, model.isFree)}</p>
                              <p>Out {formatModelCost(model.outputCostPerM, model.isFree)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div ref={agentMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowAgentSelector((prev) => !prev)}
                  title="Attach an agent persona and resources to this chat"
                  className={selectorTriggerClass}
                >
                  <span>{selectedAgent?.avatarEmoji ?? "🧠"}</span>
                  <span className="max-w-[160px] truncate">{selectedAgent?.name ?? "No agent"}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showAgentSelector && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 max-h-[360px] w-[min(92vw,22rem)] overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectAgent(undefined);
                        setShowAgentSelector(false);
                      }}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                        !selectedAgentId
                          ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span>🧠</span>
                      <span>No agent</span>
                    </button>
                    {agents.map((agent) => (
                      <button
                        key={agent._id}
                        type="button"
                        onClick={() => {
                          onSelectAgent(agent._id);
                          setShowAgentSelector(false);
                        }}
                        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                          selectedAgentId === agent._id
                            ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <span>{agent.avatarEmoji}</span>
                        <span className="truncate">{agent.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <SettingPill
                label="Enhance"
                value={autoEnhancePrompt}
                onChange={onAutoEnhancePromptChange}
                title="Auto chooses when to refine prompts. Yes forces refinement. No disables."
                icon={<Sparkles className="h-3.5 w-3.5" />}
              />
              <SettingPill
                label="Thinking"
                value={autoThinking}
                onChange={onAutoThinkingChange}
                title="Auto adapts reasoning depth. Yes forces deeper reasoning. No keeps it lightweight."
                icon={<Brain className="h-3.5 w-3.5" />}
              />
              <SettingPill
                label="Search"
                value={autoSearch}
                onChange={onAutoSearchChange}
                title="Auto enables web research for time-sensitive prompts. Yes always enables. No disables."
                icon={<Search className="h-3.5 w-3.5" />}
              />

              {lastAutoResult?.promptEnhanced && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] px-2 py-1 text-[11px] text-[var(--accent-cyan)]">
                  <Sparkles className="h-3 w-3" />
                  Enhanced
                </span>
              )}

              <label className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]">
                <Paperclip className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Attach</span>
                <input
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length > 0) {
                      onFilesAdd(files);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </div>

          <div className="flex items-end gap-2 px-3 py-2.5">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              onPaste={handlePaste}
              placeholder="Ask anything. For best results, include your context and goal."
              className="max-h-[220px] min-h-[70px] flex-1 resize-none bg-transparent px-2 py-1 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none"
              onKeyDown={handleKeyDown}
            />

            {sending && onStop ? (
              <Button
                onClick={onStop}
                variant="secondary"
                size="icon"
                className="h-10 w-10 rounded-full"
                aria-label="Stop generation"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={onSend}
                disabled={sending || !message.trim()}
                size="icon"
                className="h-10 w-10 rounded-full"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
