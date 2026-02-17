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
  Paperclip,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlashCommandMenu } from "@/components/chat/slash-command-menu";
import { ALL_MODES, getModeConfig } from "@/lib/modes";
import { getRecommendedModelsForMode } from "@/lib/model-config";
import type { Agent } from "@/types";
import type { AutoPreference, FileStatus, ModelOption } from "@/hooks/use-chat-state";
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
  models: ModelOption[];
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

function formatNumberCompact(value?: number) {
  if (!value || value <= 0) return "—";
  return Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function formatModelCost(value?: number, isFree?: boolean) {
  if (isFree) return "--";
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value <= 0) return "--";
  if (value < 0.01) return `$${value.toFixed(4)}/M`;
  return `$${value.toFixed(2)}/M`;
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

// Get models categorized for display in dropdown
function getCategorizedModels(
  models: ModelOption[],
  mode: StudyMode,
  modelSearch: string,
  hasImages: boolean,
  estimatedTokens: number,
): {
  recommended: ModelOption[];
  others: ModelOption[];
  notRecommended: Array<{ model: ModelOption; reason: string }>;
} {
  const sorted = sortedByPopularity(models);
  
  // If searching, return all matching models without categorization
  const clean = modelSearch.trim();
  if (clean) {
    const normalized = normalizeModelSearch(clean);
    const filtered = sorted.filter((model) => {
      const haystack = normalizeModelSearch(`${model.name} ${model.modelId} ${model.provider}`);
      const score = fuzzyScore(normalized, {
        name: model.name,
        modelId: model.modelId,
        provider: model.provider,
        description: model.description,
      });
      return haystack.includes(normalized) || score > 0.35;
    });
    return { recommended: filtered, others: [], notRecommended: [] };
  }
  
  // Get recommended model IDs for this mode
  const recommendedIds = new Set(getRecommendedModelsForMode(mode));
  
  const recommended: ModelOption[] = [];
  const others: ModelOption[] = [];
  const notRecommended: Array<{ model: ModelOption; reason: string }> = [];
  
  for (const model of sorted) {
    const reasons: string[] = [];
    
    if (hasImages && !hasVisionSupport(model)) {
      reasons.push("No image support");
    }
    
    if (model.contextLength && estimatedTokens > model.contextLength) {
      reasons.push("Context too small");
    }
    
    if (reasons.length > 0) {
      notRecommended.push({ model, reason: reasons.join(" · ") });
    } else if (recommendedIds.has(model.modelId)) {
      recommended.push(model);
    } else {
      others.push(model);
    }
  }
  
  return { recommended, others, notRecommended };
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
  imageModel,
  onSelectAuto,
  onSelectModel,
  onSelectImageModel,
  autoEnhancePrompt,
  autoThinking,
  autoSearch,
  onAutoEnhancePromptChange,
  onAutoThinkingChange,
  onAutoSearchChange,
  onSlashCommand,
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
  
  const hasImages = useMemo(
    () => fileList.some((f) => f.type.startsWith("image/")),
    [fileList]
  );
  
  const estimatedTokens = useMemo(
    () => estimateTokens(message),
    [message]
  );
  
  // Get categorized models for dropdown
  const { recommended, others, notRecommended } = useMemo(
    () => getCategorizedModels(models, mode, modelSearch, hasImages, estimatedTokens),
    [models, mode, modelSearch, hasImages, estimatedTokens]
  );
  
  const selectorTriggerClass =
    "inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]";
  const slashActive = message.trimStart().startsWith("/");
  const speech = useSpeechToText();

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
        "bg-[var(--bg-primary)] px-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 lg:px-10",
        draggingFiles && "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-primary))]",
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mx-auto w-full max-w-5xl">
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
                  <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ background: modeConfig.color }} />
                  <span>{modeConfig.label}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showModeSelector && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 max-h-[320px] w-[min(92vw,22rem)] overflow-y-auto overscroll-contain rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
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
                      {/* Auto Router Option */}
                      {!modelSearch.trim() && (
                        <>
                          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                            Auto Routing
                          </p>
                          
                          {/* OpenRouter Premium Auto */}
                          <button
                            type="button"
                            onClick={() => {
                              onSelectModel("openrouter/auto");
                              setShowModelSelector(false);
                            }}
                            className={`mb-2 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                              routerMode === "manual" && manualModel === "openrouter/auto"
                                ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                                : routerMode === "auto"
                                  ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                                  : "hover:bg-[var(--bg-hover)]"
                            }`}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--bg-secondary))]">
                              <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-[var(--text-primary)]">Auto Routing</p>
                              <p className="truncate text-[10px] text-[var(--text-secondary)]">Smart model selection based on your prompt</p>
                            </div>
                            {(routerMode === "auto" || (routerMode === "manual" && manualModel === "openrouter/auto")) && (
                              <span className="shrink-0 rounded-full bg-[var(--accent-cyan)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                                Active
                              </span>
                            )}
                          </button>
                        </>
                      )}

                      {/* Recommended Models */}
                      {!modelSearch.trim() && recommended.length > 0 && (
                        <>
                          <p className="mb-1 mt-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                            Recommended for {modeConfig.label}
                          </p>
                          {recommended.map((model) => {
                            const displayName = cleanModelDisplayText(model.name) || formatModelLabel(model.modelId);
                            const isSelected = routerMode === "manual" && manualModel === model.modelId;

                            return (
                              <button
                                key={model.modelId}
                                type="button"
                                onClick={() => {
                                  onSelectModel(model.modelId);
                                  setShowModelSelector(false);
                                }}
                                className={`mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                                  isSelected
                                    ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                                    : "hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{displayName}</p>
                                  <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                    {model.provider}
                                    {model.contextLength ? ` · ${Math.round((model.contextLength ?? 0) / 1000)}k ctx` : ""}
                                    {model.isFree
                                      ? " · Free"
                                      : model.inputCostPerM != null
                                        ? ` · $${model.inputCostPerM.toFixed(2)}/$${(model.outputCostPerM ?? 0).toFixed(2)}`
                                        : ""}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </>
                      )}

                      {/* All Other Models */}
                      {!modelSearch.trim() && (
                        <p className="mb-1 mt-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          All Models
                        </p>
                      )}
                      
                      {others.map((model) => {
                        const displayName = cleanModelDisplayText(model.name) || formatModelLabel(model.modelId);
                        const isSelected = routerMode === "manual" && manualModel === model.modelId;

                        return (
                          <button
                            key={model.modelId}
                            type="button"
                            onClick={() => {
                              onSelectModel(model.modelId);
                              setShowModelSelector(false);
                            }}
                            className={`mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                              isSelected
                                ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                                : "hover:bg-[var(--bg-hover)]"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-[var(--text-primary)]">{displayName}</p>
                              <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                {model.provider}
                                {model.contextLength ? ` · ${Math.round((model.contextLength ?? 0) / 1000)}k ctx` : ""}
                                {model.isFree
                                  ? " · Free"
                                  : model.inputCostPerM != null
                                    ? ` · $${model.inputCostPerM.toFixed(2)}/$${(model.outputCostPerM ?? 0).toFixed(2)}`
                                    : ""}
                              </p>
                            </div>
                          </button>
                        );
                      })}

                      {/* Not Recommended Models */}
                      {!modelSearch.trim() && notRecommended.length > 0 && (
                        <>
                          <p className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--warning)]">
                            Not Recommended
                          </p>
                          {notRecommended.map(({ model, reason }) => {
                            const displayName = cleanModelDisplayText(model.name) || formatModelLabel(model.modelId);
                            const isSelected = routerMode === "manual" && manualModel === model.modelId;

                            return (
                              <button
                                key={model.modelId}
                                type="button"
                                onClick={() => {
                                  onSelectModel(model.modelId);
                                  setShowModelSelector(false);
                                }}
                                className={`mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition opacity-60 hover:opacity-80 ${
                                  isSelected
                                    ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))] font-medium text-[var(--text-primary)]"
                                    : "hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{displayName}</p>
                                  <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                    <span className="text-[var(--warning)]">{reason}</span>
                                    {" · "}
                                    {model.provider}
                                    {model.contextLength ? ` · ${Math.round((model.contextLength ?? 0) / 1000)}k ctx` : ""}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </>
                      )}

                      {/* Search Results */}
                      {modelSearch.trim() && (
                        <>
                          {recommended.length === 0 && others.length === 0 && (
                            <p className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
                              No models found
                            </p>
                          )}
                        </>
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
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(event) => onMessageChange(event.target.value)}
                onPaste={handlePaste}
                placeholder="Ask anything. For best results, include your context and goal."
                className="max-h-[220px] min-h-[70px] w-full resize-none bg-transparent px-2 py-1 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none"
                onKeyDown={handleKeyDown}
              />
              {speech.isListening ? (
                <p className="px-2 pb-1 text-xs text-[var(--danger)]">
                  Recording... {speech.transcript || "Listening"}
                </p>
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
