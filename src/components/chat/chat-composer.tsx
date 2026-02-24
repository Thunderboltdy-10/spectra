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
  Mic,
  MoreHorizontal,
  Paperclip,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import { ContextualTip } from "@/components/ui/contextual-tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SlashCommandMenu } from "@/components/chat/slash-command-menu";
import { ALL_MODES, COMING_SOON_MODES, getModeConfig, isModeAvailable } from "@/lib/modes";
import { getRecommendedModelsForMode, MODEL_COST_BLOCK_LIST } from "@/lib/model-config";
import type { Agent } from "@/types";
import type { AutoPreference, FileStatus, ModelOption, UserSpending } from "@/hooks/use-chat-state";
import type { RouterMode, StudyMode } from "@/types";
import { fuzzyScore } from "@/lib/fuzzy-model-search";
import { cn } from "@/lib/utils";
import { parseSlashCommand } from "@/lib/slash-commands";
import { useSpeechToText } from "@/hooks/use-speech-to-text";

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
  agentSuggestion?: { id: string; name: string; score: number; reason: string } | null;
  onApplyAgentSuggestion?: () => void;
  models: ModelOption[];
  userSpending: UserSpending | null;
  routerMode: RouterMode;
  manualModel: string;
  imageModel?: string;
  onSelectAuto: () => void;
  onSelectModel: (modelId: string) => void;
  onSelectImageModel?: (modelId: string) => void;
  autoEnhancePrompt: AutoPreference;
  autoThinking: AutoPreference;
  autoSearch: AutoPreference;
  onAutoEnhancePromptChange: (value: AutoPreference) => void;
  onAutoThinkingChange: (value: AutoPreference) => void;
  onAutoSearchChange: (value: AutoPreference) => void;
  onSlashCommand?: (value: string) => Promise<boolean> | boolean;
  lastAutoResult?: {
    promptEnhanced: boolean;
    searchEnabled: boolean;
    thinkingLevel: "low" | "medium" | "high";
  } | null;
};

function formatModelLabel(modelId: string) {
  const raw = modelId.split("/").pop() ?? modelId;
  const clean = raw
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/-\d{4}-\d{2}-\d{2}$/i, "")
    .trim();
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

function normalizeModelSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanModelDisplayText(value: string) {
  return value
    .replace(/:free/gi, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s*&\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isBudgetSafeModel(model: ModelOption) {
  if (model.isFree) return true;
  if (model.modelId.includes(":free")) return true;
  const inCost = typeof model.inputCostPerM === "number" ? model.inputCostPerM : undefined;
  const outCost = typeof model.outputCostPerM === "number" ? model.outputCostPerM : undefined;
  return (inCost ?? 0) === 0 && (outCost ?? 0) === 0;
}

function isCheapModel(model: ModelOption) {
  if (isBudgetSafeModel(model)) return true;
  const inputCost = typeof model.inputCostPerM === "number" ? model.inputCostPerM : Number.POSITIVE_INFINITY;
  return inputCost <= 3;
}

function restrictionReasonForTier(model: ModelOption, tier?: UserSpending["tier"]) {
  if (!tier || tier === "normal") return null;
  if (tier === "expensive_blocked") {
    if (model.modelId === "openrouter/auto") return "Auto routing is disabled while guardrails are active.";
    if (MODEL_COST_BLOCK_LIST.has(model.modelId)) return "Blocked while budget guard is active.";
    return null;
  }
  if (tier === "cheap_only") {
    if (model.modelId === "openrouter/auto") return "Auto routing is disabled while in cheap-only mode.";
    return isCheapModel(model) ? null : "Unavailable until spending drops below the cheap-only threshold.";
  }
  if (model.modelId === "openrouter/auto") return "Auto routing is disabled at hard budget limit.";
  return isBudgetSafeModel(model) ? null : "Only budget-safe models are available at hard limit.";
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

function hasVisionSupport(model: ModelOption): boolean {
  const visionKeywords = ["vision", "image", "multimodal", "gpt-4o", "gpt-4-turbo", "claude-3", "gemini", "sonar"];
  const modelSource = `${model.modelId} ${model.name} ${(model.tags ?? []).join(" ")}`.toLowerCase();
  return visionKeywords.some((keyword) => modelSource.includes(keyword));
}

function estimateTokens(message: string): number {
  return Math.ceil(message.length / 4);
}

function isResearchLikeDraft(value: string) {
  const text = value.toLowerCase().trim();
  if (text.length < 24) return false;

  const researchSignals = [
    "latest",
    "recent",
    "today",
    "news",
    "study",
    "studies",
    "research",
    "paper",
    "papers",
    "source",
    "sources",
    "evidence",
    "statistics",
    "stat",
    "cite",
    "citations",
    "journal",
    "meta-analysis",
    "systematic review",
  ];
  const signalCount = researchSignals.reduce(
    (count, signal) => (text.includes(signal) ? count + 1 : count),
    0,
  );
  const hasYear = /\b(19|20)\d{2}\b/.test(text);
  const hasResearchQuestionVerb = /\b(find|compare|verify|summarize|analyze|investigate|review)\b/.test(text);

  return signalCount >= 2 || (signalCount >= 1 && (hasYear || hasResearchQuestionVerb));
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

export function ChatComposer(props: ChatComposerProps) {
  const {
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
    agentSuggestion,
    onApplyAgentSuggestion,
    models,
    userSpending,
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
    onSlashCommand,
    lastAutoResult,
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelSearchRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [composerCompact, setComposerCompact] = useState(false);
  const modeConfig = getModeConfig(mode);
  const selectedModel = useMemo(
    () => models.find((item) => item.modelId === manualModel),
    [manualModel, models],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent._id === selectedAgentId),
    [agents, selectedAgentId],
  );
  
  const hasImages = useMemo(
    () => fileList.some((f) => f.type.startsWith("image/")),
    [fileList]
  );

  const estimatedTokens = useMemo(
    () => estimateTokens(message),
    [message]
  );

  const recommendedModelIds = useMemo(
    () => new Set(getRecommendedModelsForMode(mode)),
    [mode],
  );

  const modelRows = useMemo(() => {
    const sorted = sortedByPopularity(models);
    const clean = modelSearch.trim();
    const normalized = normalizeModelSearch(clean);

    return sorted
      .filter((model) => {
        if (!clean) return true;
        const haystack = normalizeModelSearch(`${model.name} ${model.modelId} ${model.provider}`);
        const score = fuzzyScore(normalized, {
          name: model.name,
          modelId: model.modelId,
          provider: model.provider,
          description: model.description,
        });
        return haystack.includes(normalized) || score > 0.35;
      })
      .map((model) => {
        const cautions: string[] = [];
        if (hasImages && !hasVisionSupport(model)) {
          cautions.push("No image support");
        }
        if (model.contextLength && estimatedTokens > model.contextLength) {
          cautions.push("Context too small");
        }
        const restrictionReason = restrictionReasonForTier(model, userSpending?.tier);
        return {
          model,
          recommended: recommendedModelIds.has(model.modelId),
          cautionReason: cautions.join(" · "),
          restrictionReason,
        };
      });
  }, [estimatedTokens, hasImages, modelSearch, models, recommendedModelIds, userSpending?.tier]);

  const providerOptions = useMemo(
    () =>
      [...new Set(modelRows.map((row) => row.model.provider).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
    [modelRows],
  );

  const filteredModelRows = useMemo(() => {
    if (providerFilter === "all") return modelRows;
    return modelRows.filter((row) => row.model.provider === providerFilter);
  }, [modelRows, providerFilter]);

  const hasBudgetSafeModel = useMemo(
    () => models.some((model) => restrictionReasonForTier(model, "free_only") === null),
    [models],
  );
  const selectedManualRestriction = useMemo(() => {
    if (routerMode !== "manual") return null;
    const selected = models.find((model) => model.modelId === manualModel);
    if (!selected) return null;
    return restrictionReasonForTier(selected, userSpending?.tier);
  }, [manualModel, models, routerMode, userSpending?.tier]);
  const hardLimitNoModel = userSpending?.tier === "free_only" && !hasBudgetSafeModel;
  const sendDisabledReason = hardLimitNoModel
    ? "No budget-safe model is currently available. Sending is paused."
    : selectedManualRestriction;
  const autoRoutingRestriction = useMemo(
    () =>
      restrictionReasonForTier(
        {
          _id: "openrouter/auto",
          modelId: "openrouter/auto",
          name: "Auto Routing",
          provider: "OpenRouter",
          tags: [],
        },
        userSpending?.tier,
      ),
    [userSpending?.tier],
  );
  
  const selectorTriggerClass =
    "inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]";
  const slashActive = message.trimStart().startsWith("/");
  const speech = useSpeechToText();
  const shouldShowResearchTip = useMemo(() => {
    if (!onModeChange) return false;
    if (mode === "research") return false;
    if (mode !== "general" && mode !== "explain") return false;
    return isResearchLikeDraft(message);
  }, [message, mode, onModeChange]);
  useEffect(() => {
    try {
      const persisted = window.localStorage.getItem("ai-school-composer-compact");
      setComposerCompact(persisted === "1");
    } catch {
      setComposerCompact(false);
    }
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [message]);

  useEffect(() => {
    if (!showModelSelector) {
      setModelSearch("");
      setProviderFilter("all");
      return;
    }
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
    if (sendDisabledReason) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const maybeSlash = parseSlashCommand(message.trim());
      if (maybeSlash && onSlashCommand) {
        void onSlashCommand(message.trim());
        return;
      }
      onSend();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSend();
    }
  }

  function handleModeSelect(newMode: StudyMode) {
    if (!isModeAvailable(newMode)) return;
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

  function handleToggleMic() {
    if (!speech.isSupported) return;
    if (speech.isListening) {
      speech.stop();
      if (speech.transcript.trim()) {
        onMessageChange([message, speech.transcript.trim()].filter(Boolean).join(message.trim() ? " " : ""));
      }
      speech.reset();
      return;
    }
    speech.start();
  }

  function toggleComposerCompact() {
    setComposerCompact((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("ai-school-composer-compact", next ? "1" : "0");
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
  }

  function renderStatus(status: FileStatus, warning?: string) {
    if (status === "uploading") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Uploading
        </span>
      );
    }
    if (status === "ready") {
      if (warning?.trim()) {
        return (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--warning)]">
            <AlertCircle className="h-3 w-3" />
            Chat-only
          </span>
        );
      }
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
        "sticky bottom-0 z-20 bg-[color-mix(in_oklab,var(--bg-primary)_88%,transparent)] px-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur-md sm:px-6 lg:px-10",
        draggingFiles && "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-primary))]",
      )}
      aria-label="Message composer"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mx-auto w-full max-w-6xl">
        {shouldShowResearchTip ? (
          <div className="mb-2">
            <ContextualTip
              tipId="composer-research-mode-tip"
              message="Try Research mode for factual questions."
              actionLabel="Switch to Research"
              onAction={() => onModeChange?.("research")}
            />
          </div>
        ) : null}

        {slashActive ? (
          <SlashCommandMenu
            query={message.trim()}
            onSelect={(command) => {
              onMessageChange(command);
              textareaRef.current?.focus();
            }}
          />
        ) : null}
        {draggingFiles && (
          <div className="mb-2 rounded-xl border border-dashed border-[color-mix(in_oklab,var(--accent-cyan)_55%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] px-3 py-2 text-xs font-medium text-[var(--accent-cyan)]">
            Drop files to attach
          </div>
        )}

        {fileList.length > 0 && (
          <div className="mb-2 rounded-xl bg-[var(--bg-secondary)] p-2">
            <div className="flex flex-wrap gap-2">
              {fileList.map((file) => {
                const status = fileUploadState[fileKey(file)]?.status ?? "pending";
                const thumbnailUrl = fileUploadState[fileKey(file)]?.thumbnailUrl;
                const warning = fileUploadState[fileKey(file)]?.error;
                const extension = file.name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
                return (
                  <span
                    key={`${file.name}-${file.size}`}
                    className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-2 text-xs font-medium shadow-sm"
                  >
                    {thumbnailUrl ? (
                      <span
                        className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-[size:12px_12px]"
                        style={{
                          backgroundImage:
                            "linear-gradient(45deg, rgba(148,163,184,0.14) 25%, transparent 25%, transparent 75%, rgba(148,163,184,0.14) 75%, rgba(148,163,184,0.14)), linear-gradient(45deg, rgba(148,163,184,0.14) 25%, transparent 25%, transparent 75%, rgba(148,163,184,0.14) 75%, rgba(148,163,184,0.14))",
                          backgroundPosition: "0 0, 6px 6px",
                        }}
                      >
                        <Image
                          src={thumbnailUrl}
                          alt={file.name}
                          className="h-16 w-16 rounded-lg object-contain"
                          width={64}
                          height={64}
                        />
                      </span>
                    ) : (
                      <span className="inline-flex h-12 min-w-12 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-1.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        <FileText className="mr-1 h-3 w-3" />
                        {extension}
                      </span>
                    )}
                    <span className="max-w-[220px] truncate">{file.name}</span>
                    {renderStatus(status, warning)}
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
          </div>
        )}

        <div className="relative rounded-2xl bg-[color-mix(in_oklab,var(--bg-elevated)_94%,transparent)] shadow-[var(--shadow-soft)] backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <div ref={modeMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowModeSelector((prev) => !prev)}
                  title={modeConfig.description}
                  data-tour="mode-selector"
                  className={selectorTriggerClass}
                >
                  <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ background: modeConfig.color }} />
                  <span>{modeConfig.label}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showModeSelector && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 max-h-[320px] w-[min(92vw,22rem)] overflow-y-auto overscroll-contain rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
                    {ALL_MODES.map((m) => {
                      const mc = getModeConfig(m.key);
                      const isActive = m.key === mode;
                      const available = isModeAvailable(m.key);
                      const comingSoon = COMING_SOON_MODES.has(m.key);
                      return (
                        <button
                          key={m.key}
                          type="button"
                          disabled={!available}
                          onClick={() => handleModeSelect(m.key)}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                            isActive
                              ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          } ${available ? "cursor-pointer" : "cursor-not-allowed opacity-45"}`}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: mc.color }} />
                          <div>
                            <p className="inline-flex items-center gap-1.5">
                              <span>{mc.label}</span>
                              {comingSoon ? (
                                <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em]">
                                  Soon
                                </span>
                              ) : null}
                            </p>
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
                  data-tour="model-selector"
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
                  <div className="absolute bottom-full left-1/2 z-20 mb-2 max-h-[480px] w-[min(92vw,32rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow-soft)]">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium text-[var(--text-primary)]">Choose model</p>
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
                          placeholder="Search models..."
                          className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] pl-8 pr-2 text-sm"
                        />
                      </div>
                    </div>

                    <div className="max-h-[360px] overflow-y-auto pr-1">
                      <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        Auto Routing
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (autoRoutingRestriction) return;
                          onSelectAuto();
                          setShowModelSelector(false);
                        }}
                        disabled={Boolean(autoRoutingRestriction)}
                        title={autoRoutingRestriction ?? "Let routing choose the best model for this prompt."}
                        className={`mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                          autoRoutingRestriction
                            ? "cursor-not-allowed opacity-55"
                            : "cursor-pointer hover:bg-[var(--bg-hover)]"
                        } ${
                          routerMode !== "manual"
                            ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                            : ""
                        }`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--bg-secondary))]">
                          <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[var(--text-primary)]">Auto Routing</p>
                          <p className="truncate text-[10px] text-[var(--text-secondary)]">
                            Smart model selection based on your prompt
                          </p>
                          {autoRoutingRestriction ? (
                            <p className="truncate text-[10px] text-[var(--warning)]">{autoRoutingRestriction}</p>
                          ) : null}
                        </div>
                        {routerMode !== "manual" ? (
                          <span className="shrink-0 rounded-full bg-[var(--accent-cyan)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                            Active
                          </span>
                        ) : null}
                      </button>

                      {modelSearch.trim().length > 0 && providerOptions.length > 1 ? (
                        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                          <button
                            type="button"
                            onClick={() => setProviderFilter("all")}
                            className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                              providerFilter === "all"
                                ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-[var(--text-primary)]"
                                : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            }`}
                          >
                            All providers
                          </button>
                          {providerOptions.map((provider) => (
                            <button
                              key={provider}
                              type="button"
                              onClick={() => setProviderFilter(provider)}
                              className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                                providerFilter === provider
                                  ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-[var(--text-primary)]"
                                  : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                              }`}
                            >
                              {provider}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {filteredModelRows.length === 0 ? (
                        <p className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">No models found</p>
                      ) : (
                        <div className="space-y-1 px-1">
                          {filteredModelRows.map((row, index) => {
                            const model = row.model;
                            const isSelected = routerMode === "manual" && manualModel === model.modelId;
                            const displayName = cleanModelDisplayText(model.name) || formatModelLabel(model.modelId);
                            const disabled = Boolean(row.restrictionReason);

                            return (
                              <button
                                key={model.modelId}
                                type="button"
                                onClick={() => {
                                  if (disabled) return;
                                  onSelectModel(model.modelId);
                                  setShowModelSelector(false);
                                }}
                                title={row.restrictionReason ?? undefined}
                                className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                                  disabled
                                    ? "cursor-not-allowed opacity-55"
                                    : "cursor-pointer hover:bg-[var(--bg-hover)]"
                                } ${
                                  isSelected
                                    ? "border-[color-mix(in_oklab,var(--accent-cyan)_42%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                                    : "border-transparent"
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <ProviderLogo provider={model.provider} modelId={model.modelId} size={14} className="mt-0.5 h-6 w-6 rounded-md" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      {index < 5 && !modelSearch.trim() ? (
                                        <span className="rounded-full border border-[var(--border-default)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                                          Popular
                                        </span>
                                      ) : null}
                                      {row.recommended ? (
                                        <span className="rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--accent-cyan)]">
                                          Recommended
                                        </span>
                                      ) : null}
                                    </div>
                                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{displayName}</p>
                                    <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                      {model.provider} · {model.contextLength ? `${Math.round((model.contextLength ?? 0) / 1000)}k ctx` : "Context unknown"}
                                    </p>
                                    {row.cautionReason ? (
                                      <p className="truncate text-[10px] text-[var(--warning)]">{row.cautionReason}</p>
                                    ) : null}
                                    {row.restrictionReason ? (
                                      <p className="truncate text-[10px] text-[var(--warning)]">{row.restrictionReason}</p>
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div ref={agentMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowAgentSelector((prev) => !prev)}
                  title="Attach an agent persona and resources to this chat"
                  data-tour="agent-selector"
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

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 rounded-full px-3 text-xs"
                onClick={toggleComposerCompact}
              >
                {composerCompact ? "Expand" : "Compact"}
              </Button>
              <div data-tour="auto-controls" className={`hidden flex-wrap items-center gap-1.5 sm:flex ${composerCompact ? "opacity-0 pointer-events-none w-0 overflow-hidden" : ""}`}>
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
                  <span>Attach</span>
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

              <div className={`sm:hidden ${composerCompact ? "hidden" : ""}`}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="secondary" size="icon" className="h-8 w-8 rounded-full" aria-label="More controls">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onAutoEnhancePromptChange(nextPreference(autoEnhancePrompt))}>
                      Enhance: {preferenceLabel(autoEnhancePrompt)}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onAutoThinkingChange(nextPreference(autoThinking))}>
                      Thinking: {preferenceLabel(autoThinking)}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onAutoSearchChange(nextPreference(autoSearch))}>
                      Search: {preferenceLabel(autoSearch)}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => mobileFileInputRef.current?.click()}>
                      Attach files
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <input
                  ref={mobileFileInputRef}
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
              </div>
            </div>
          </div>

          {!selectedAgentId && agentSuggestion ? (
            <div className="border-b border-[var(--border-default)] px-3 py-2">
              <button
                type="button"
                onClick={onApplyAgentSuggestion}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] px-3 py-1 text-xs text-[var(--accent-cyan)] transition hover:bg-[color-mix(in_oklab,var(--accent-cyan)_16%,transparent)]"
                title={agentSuggestion.reason}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Suggested agent: {agentSuggestion.name}
              </button>
            </div>
          ) : null}

          <div className="flex items-end gap-2 px-3 py-2.5">
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(event) => onMessageChange(event.target.value)}
                onPaste={handlePaste}
                placeholder="Ask anything. For best results, include your context and goal."
                data-tour="composer"
                aria-label="Message input"
                className={`max-h-[220px] w-full resize-none bg-transparent px-2 py-1 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none ${
                  composerCompact ? "min-h-[56px]" : "min-h-[70px]"
                }`}
                onKeyDown={handleKeyDown}
              />
              {speech.isListening ? (
                <p className="inline-flex items-center gap-1 px-2 pb-1 text-xs text-[var(--danger)]" aria-live="polite">
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[var(--danger)]" />
                  Recording... {speech.transcript || "Listening"}
                </p>
              ) : null}
              {sendDisabledReason ? (
                <p className="px-2 pb-1 text-xs text-[var(--warning)]" aria-live="polite">{sendDisabledReason}</p>
              ) : null}
            </div>

            {speech.isSupported ? (
              <Button
                onClick={handleToggleMic}
                variant={speech.isListening ? "destructive" : "secondary"}
                size="icon"
                className={cn("h-10 w-10 rounded-full", speech.isListening && "animate-pulse")}
                aria-label={speech.isListening ? "Stop voice input" : "Start voice input"}
              >
                <Mic className="h-4 w-4" />
              </Button>
            ) : null}

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
                disabled={sending || !message.trim() || Boolean(sendDisabledReason)}
                size="icon"
                className="h-10 w-10 rounded-full"
                aria-label="Send message"
                title={sendDisabledReason ?? "Send message"}
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
