"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Mic,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Square,
  X,
  Globe,
  Star,
} from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SlashCommandMenu } from "@/components/chat/slash-command-menu";
import { SmartTipRotator } from "@/components/chat/smart-tip-rotator";
import { ALL_MODES, COMING_SOON_MODES, getModeConfig, isModeAvailable } from "@/lib/modes";
import type { Agent } from "@/types";
import type { AutoPreference, FileStatus, ModelOption, UserSpending } from "@/hooks/use-chat-state";
import type { RouterMode, StudyMode } from "@/types";
import { fuzzyScore } from "@/lib/fuzzy-model-search";
import { cn } from "@/lib/utils";
import { parseSlashCommand } from "@/lib/slash-commands";
import { useSpeechToText } from "@/hooks/use-speech-to-text";
import { CHEAP_MODEL_COST_PER_MILLION, MAX_MODEL_COST_PER_MILLION } from "@/lib/model-policy";

type ChatComposerProps = {
  sidebarExpanded?: boolean;
  message: string;
  onMessageChange: (value: string) => void;
  fileList: File[];
  fileUploadState: Record<string, { status: FileStatus; thumbnailUrl?: string; error?: string }>;
  streakAtRisk?: boolean;
  continuationChat?: { id: string; title: string } | null;
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
  currentUserId?: string;
  isSuperAdmin?: boolean;
  routerMode: RouterMode;
  manualModel: string;
  imageModel?: string;
  onSelectAuto: () => void;
  onSelectModel: (modelId: string) => void;
  onSelectImageModel?: (modelId: string) => void;
  autoEnhancePrompt: AutoPreference;
  autoThinking: AutoPreference;
  autoSearch: AutoPreference;
  autoCompaction: AutoPreference;
  onAutoEnhancePromptChange: (value: AutoPreference) => void;
  onAutoThinkingChange: (value: AutoPreference) => void;
  onAutoSearchChange: (value: AutoPreference) => void;
  onAutoCompactionChange: (value: AutoPreference) => void;
  onSlashCommand?: (value: string) => Promise<boolean> | boolean;
  lastAutoResult?: {
    promptEnhanced: boolean;
    searchEnabled: boolean;
    thinkingLevel: "low" | "medium" | "high";
  } | null;
  messageCount?: number;
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

function modelBlob(model: ModelOption) {
  return `${model.modelId} ${model.name} ${model.provider} ${(model.tags ?? []).join(" ")}`.toLowerCase();
}

function isReasoningCapable(model: ModelOption) {
  if (typeof model.capabilities?.reasoning === "number") return model.capabilities.reasoning >= 5;
  if (model.reasoningRating === "high") return true;
  return /\b(reason|reasoning|logic|math|o3|o4|r1)\b/.test(modelBlob(model));
}

function isCodeCapable(model: ModelOption) {
  if (typeof model.capabilities?.code === "number") return model.capabilities.code >= 5;
  return /\b(code|coder|programming|dev)\b/.test(modelBlob(model));
}

function isImageGenerationCapable(model: ModelOption) {
  return /\b(image[-_ ]?gen|text[-_ ]to[-_ ]image|image generation|recraft|diffusion)\b/.test(modelBlob(model))
    || (model.tags ?? []).some((tag) => /image[-_ ]?generation|image-gen/.test(tag.toLowerCase()));
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
  const outputCost = typeof model.outputCostPerM === "number" ? model.outputCostPerM : Number.POSITIVE_INFINITY;
  return inputCost <= CHEAP_MODEL_COST_PER_MILLION && outputCost <= CHEAP_MODEL_COST_PER_MILLION;
}

function isExpensiveModel(model: ModelOption) {
  const inputCost = typeof model.inputCostPerM === "number" ? model.inputCostPerM : Number.POSITIVE_INFINITY;
  const outputCost = typeof model.outputCostPerM === "number" ? model.outputCostPerM : Number.POSITIVE_INFINITY;
  return inputCost > MAX_MODEL_COST_PER_MILLION || outputCost > MAX_MODEL_COST_PER_MILLION;
}

function restrictionReasonForTier(
  model: ModelOption,
  tier?: UserSpending["tier"],
  showPricingDetails = false,
) {
  if (!tier || tier === "normal") return null;
  if (tier === "expensive_blocked") {
    if (model.modelId === "openrouter/auto") {
      return showPricingDetails
        ? "Auto routing is disabled while guardrails are active."
        : "Auto routing is temporarily unavailable.";
    }
    if (isExpensiveModel(model)) {
      return showPricingDetails
        ? "Blocked while budget guard is active."
        : "Temporarily unavailable due to current usage limits.";
    }
    return null;
  }
  if (tier === "cheap_only") {
    if (model.modelId === "openrouter/auto") {
      return showPricingDetails
        ? "Auto routing is disabled while in cheap-only mode."
        : "Auto routing is temporarily unavailable.";
    }
    return isCheapModel(model)
      ? null
      : showPricingDetails
        ? "Unavailable until spending drops below the cheap-only threshold."
        : "Temporarily unavailable due to current usage limits.";
  }
  if (model.modelId === "openrouter/auto") {
    return showPricingDetails
      ? "Auto routing is disabled at hard budget limit."
      : "Auto routing is temporarily unavailable.";
  }
  return isBudgetSafeModel(model)
    ? null
    : showPricingDetails
      ? "Only budget-safe models are available at hard limit."
      : "Only currently available models can be selected right now.";
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
  if (value === "on") return "On";
  return "Off";
}

function sortedByPopularity(models: ModelOption[]) {
  return [...models].sort((a, b) => {
    const aFeatured = typeof a.featuredOrder === "number" ? a.featuredOrder : Number.MAX_SAFE_INTEGER;
    const bFeatured = typeof b.featuredOrder === "number" ? b.featuredOrder : Number.MAX_SAFE_INTEGER;
    if (aFeatured !== bFeatured) return aFeatured - bFeatured;
    if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
    const aFree = a.isFree || a.modelId.includes(":free");
    const bFree = b.isFree || b.modelId.includes(":free");
    if (aFree !== bFree) return aFree ? -1 : 1;
    const aCost = typeof a.inputCostPerM === "number" ? a.inputCostPerM : Number.MAX_SAFE_INTEGER;
    const bCost = typeof b.inputCostPerM === "number" ? b.inputCostPerM : Number.MAX_SAFE_INTEGER;
    if (aCost !== bCost) return aCost - bCost;
    return a.name.localeCompare(b.name);
  });
}

function hasVisionSupport(model: ModelOption): boolean {
  if (typeof model.capabilities?.vision === "number") return model.capabilities.vision >= 3;
  if (model.multimodalRating === "strong" || model.multimodalRating === "basic") return true;
  const modelSource = modelBlob(model);
  return /\b(vision|image|multimodal)\b/.test(modelSource);
}

function isRecommendedForMode(mode: StudyMode, model: ModelOption) {
  if (mode === "research") {
    return isReasoningCapable(model) || /\b(search|web)\b/.test(modelBlob(model));
  }
  if (mode === "marker" || mode === "exam") {
    return isReasoningCapable(model);
  }
  if (mode === "draft_coach") {
    return isCodeCapable(model) || isReasoningCapable(model);
  }
  if (mode === "image") {
    return isImageGenerationCapable(model);
  }
  if (mode === "flashcard" || mode === "quiz") {
    return isCheapModel(model) || hasVisionSupport(model);
  }
  return isCheapModel(model) || isReasoningCapable(model);
}

function estimateTokens(message: string): number {
  return Math.ceil(message.length / 4);
}

function formatRelativeTimestamp(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return "Updated recently";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "Updated just now";
  if (elapsed < 3_600_000) return `Updated ${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  if (elapsed < 86_400_000) return `Updated ${Math.max(1, Math.floor(elapsed / 3_600_000))}h ago`;
  if (elapsed < 7 * 86_400_000) return `Updated ${Math.max(1, Math.floor(elapsed / 86_400_000))}d ago`;
  return `Updated ${new Date(timestamp).toLocaleDateString()}`;
}

function SettingPill({
  label,
  value,
  onChange,
  icon,
}: {
  label: string;
  value: AutoPreference;
  onChange: (value: AutoPreference) => void;
  icon: React.ReactNode;
}) {
  const pillClass =
    value === "on"
      ? "border-[color-mix(in_oklab,var(--accent-cyan)_50%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_16%,transparent)] text-[var(--accent-cyan)]"
      : value === "auto"
        ? "auto-pill-active border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] text-[var(--text-primary)]"
        : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]";
  return (
    <div className="group/pill relative py-0.5">
      <button
        type="button"
        onClick={() => onChange(nextPreference(value))}
        aria-label={label}
        className={`inline-flex h-[34px] cursor-pointer items-center justify-center rounded-full border px-[9px] transition-all duration-200 group-hover/pill:px-3 ${pillClass}`}
      >
        <span className="shrink-0">{icon}</span>
        <span className="ml-0 max-w-0 overflow-hidden whitespace-nowrap text-[11px] font-medium opacity-0 transition-all duration-200 group-hover/pill:ml-1.5 group-hover/pill:max-w-[80px] group-hover/pill:opacity-100">
          {preferenceLabel(value)}
        </span>
      </button>
      <span className="pointer-events-none absolute -top-7 left-1/2 z-[95] -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-0 shadow-sm transition-opacity duration-200 group-hover/pill:opacity-100">
        {label}: {preferenceLabel(value)}
      </span>
    </div>
  );
}

export function ChatComposer(props: ChatComposerProps) {
  const {
    sidebarExpanded = true,
    message,
    onMessageChange,
    fileList,
    fileUploadState,
    streakAtRisk,
    continuationChat,
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
    currentUserId,
    isSuperAdmin = false,
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
    messageCount = 0,
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelSearchRef = useRef<HTMLInputElement | null>(null);
  const modelPortalRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const previousFileCountRef = useRef(0);
  const listeningBaseMessageRef = useRef<string | null>(null);
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [agentSearch, setAgentSearch] = useState("");
  const [agentSubjectFilter, setAgentSubjectFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [modelSelectorPosition, setModelSelectorPosition] = useState<{ bottom: number; left: number } | null>(null);
  const [starredModels, setStarredModels] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("ai-school:starred-models");
      if (saved) setStarredModels(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  const toggleStarModel = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation();
    setStarredModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      try {
        window.localStorage.setItem("ai-school:starred-models", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const [attachmentsExpanded, setAttachmentsExpanded] = useState(true);
  const [showVoiceStub, setShowVoiceStub] = useState(false);
  const [modeTransitioning, setModeTransitioning] = useState(false);
  const [agentTransitioning, setAgentTransitioning] = useState(false);
  const lastModeRef = useRef(mode);
  const lastAgentIdRef = useRef(selectedAgentId);
  const modeConfig = getModeConfig(mode);
  const orderedModes = useMemo(
    () => [
      ...ALL_MODES.filter((candidate) => isModeAvailable(candidate.key)),
      ...ALL_MODES.filter((candidate) => COMING_SOON_MODES.has(candidate.key)),
    ],
    [],
  );
  const selectedModel = useMemo(
    () => models.find((item) => item.modelId === manualModel),
    [manualModel, models],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent._id === selectedAgentId),
    [agents, selectedAgentId],
  );
  const recommendedAgentIds = useMemo(() => {
    const ids = new Set<string>();
    if (agentSuggestion?.id) ids.add(agentSuggestion.id);
    const topUsage = [...agents]
      .sort((a, b) => b.usageCount - a.usageCount || b.updatedAt - a.updatedAt)
      .slice(0, 3)
      .map((agent) => agent._id);
    for (const id of topUsage) ids.add(id);
    return ids;
  }, [agentSuggestion, agents]);
  const agentSubjectOptions = useMemo(
    () =>
      Array.from(
        new Set(
          agents
            .map((agent) => (agent.subjectArea || agent.category || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [agents],
  );
  const filteredAgents = useMemo(() => {
    const cleanSearch = agentSearch.trim().toLowerCase();
    return agents
      .filter((agent) => {
        if (agentSubjectFilter === "all") return true;
        const subject = (agent.subjectArea || agent.category || "").toLowerCase();
        return subject === agentSubjectFilter.toLowerCase();
      })
      .filter((agent) => {
        if (!cleanSearch) return true;
        const haystack = `${agent.name} ${agent.description} ${agent.subjectArea ?? ""} ${agent.category}`.toLowerCase();
        return haystack.includes(cleanSearch);
      });
  }, [agentSearch, agentSubjectFilter, agents]);
  const myAgents = useMemo(
    () =>
      filteredAgents.filter((agent) => currentUserId && agent.creatorUserId === currentUserId),
    [currentUserId, filteredAgents],
  );
  const schoolAgents = useMemo(
    () =>
      filteredAgents.filter((agent) => !currentUserId || agent.creatorUserId !== currentUserId),
    [currentUserId, filteredAgents],
  );
  const recommendedAgents = useMemo(
    () => filteredAgents.filter((agent) => recommendedAgentIds.has(agent._id)),
    [filteredAgents, recommendedAgentIds],
  );
  const allAgentsSection = useMemo(
    () => filteredAgents.filter((agent) => !recommendedAgentIds.has(agent._id)),
    [filteredAgents, recommendedAgentIds],
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
    () =>
      new Set(
        models
          .filter((model) => isRecommendedForMode(mode, model))
          .map((model) => model.modelId),
      ),
    [mode, models],
  );

  const modelRows = useMemo(() => {
    const sorted = sortedByPopularity(models);
    const clean = modelSearch.trim();
    const normalized = normalizeModelSearch(clean);

    const filtered = sorted.filter((model) => {
      if (!clean) return true;
      const haystack = normalizeModelSearch(`${model.name} ${model.modelId} ${model.provider}`);
      const score = fuzzyScore(clean, {
        name: model.name,
        modelId: model.modelId,
        provider: model.provider,
        description: model.description,
      });
      return haystack.includes(normalized) || score > 0.35;
    });

    if (clean) {
      filtered.sort((a, b) => {
        const scoreA = fuzzyScore(clean, { name: a.name, modelId: a.modelId, provider: a.provider, description: a.description });
        const scoreB = fuzzyScore(clean, { name: b.name, modelId: b.modelId, provider: b.provider, description: b.description });
        return scoreB - scoreA;
      });
    }

    return filtered.map((model) => {
        const cautions: string[] = [];
        if (hasImages && !hasVisionSupport(model)) {
          cautions.push("No image support");
        }
        if (model.contextLength && estimatedTokens > model.contextLength) {
          cautions.push("Context too small");
        }
        const hasKnownCost = typeof model.inputCostPerM === "number" || typeof model.outputCostPerM === "number";
        const expensiveWarning = isSuperAdmin && hasKnownCost && isExpensiveModel(model)
          ? "Exceeds 30/M cap (manual confirmation required)."
          : null;
        const restrictionReason = restrictionReasonForTier(model, userSpending?.tier, isSuperAdmin);
        return {
          model,
          recommended: recommendedModelIds.has(model.modelId),
          cautionReason: [...cautions, expensiveWarning].filter(Boolean).join(" · "),
          restrictionReason,
        };
      });
  }, [estimatedTokens, hasImages, isSuperAdmin, modelSearch, models, recommendedModelIds, userSpending?.tier]);

  const providerOptions = useMemo(
    () =>
      [...new Set(modelRows.map((row) => row.model.provider).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b)),
    [modelRows],
  );

  const filteredModelRows = useMemo(() => {
    if (providerFilter === "all") return modelRows;
    if (providerFilter === "starred") return modelRows.filter((row) => starredModels.has(row.model.modelId));
    return modelRows.filter((row) => row.model.provider === providerFilter);
  }, [modelRows, providerFilter, starredModels]);

  const hasBudgetSafeModel = useMemo(
    () => models.some((model) => restrictionReasonForTier(model, "free_only", isSuperAdmin) === null),
    [isSuperAdmin, models],
  );
  const selectedManualRestriction = useMemo(() => {
    if (routerMode !== "manual") return null;
    const selected = models.find((model) => model.modelId === manualModel);
    if (!selected) return null;
    return restrictionReasonForTier(selected, userSpending?.tier, isSuperAdmin);
  }, [isSuperAdmin, manualModel, models, routerMode, userSpending?.tier]);
  const hardLimitNoModel = userSpending?.tier === "free_only" && !hasBudgetSafeModel;
  const sendDisabledReason = hardLimitNoModel
    ? (isSuperAdmin
      ? "No budget-safe model is currently available. Sending is paused."
      : "No available model can be selected right now. Sending is paused.")
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
        isSuperAdmin,
      ),
    [isSuperAdmin, userSpending?.tier],
  );
  
  const selectorTriggerClass =
    "inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]";
  const slashActive = message.trimStart().startsWith("/");
  const speech = useSpeechToText();
  useEffect(() => {
    if (lastModeRef.current !== mode) {
      setModeTransitioning(true);
      const timer = window.setTimeout(() => setModeTransitioning(false), 340);
      lastModeRef.current = mode;
      return () => window.clearTimeout(timer);
    }
    lastModeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (lastAgentIdRef.current !== selectedAgentId) {
      setAgentTransitioning(true);
      const timer = window.setTimeout(() => setAgentTransitioning(false), 340);
      lastAgentIdRef.current = selectedAgentId;
      return () => window.clearTimeout(timer);
    }
    lastAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail?.message;
      if (msg) onMessageChange(msg);
    };
    window.addEventListener("ai-school:set-message", handler);
    return () => window.removeEventListener("ai-school:set-message", handler);
  }, [onMessageChange]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [message]);

  useEffect(() => {
    if (!showModelSelector) {
      setModelSearch("");
      setProviderFilter("all");
      setModelSelectorPosition(null);
      return;
    }

    const updateModelSelectorPosition = () => {
      const rect = modelMenuRef.current?.getBoundingClientRect();
      if (!rect) {
        setModelSelectorPosition(null);
        return;
      }
      setModelSelectorPosition({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.max(8, rect.left + rect.width / 2 - 256),
      });
    };

    updateModelSelectorPosition();
    window.addEventListener("resize", updateModelSelectorPosition);
    window.addEventListener("scroll", updateModelSelectorPosition, true);
    const timer = window.setTimeout(() => modelSearchRef.current?.focus(), 10);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateModelSelectorPosition);
      window.removeEventListener("scroll", updateModelSelectorPosition, true);
    };
  }, [showModelSelector]);

  useEffect(() => {
    const previousCount = previousFileCountRef.current;
    if (fileList.length === 0) {
      setAttachmentsExpanded(false);
    } else if (fileList.length > previousCount) {
      setAttachmentsExpanded(true);
    }
    previousFileCountRef.current = fileList.length;
  }, [fileList.length]);

  useEffect(() => {
    if (!speech.isListening) {
      listeningBaseMessageRef.current = null;
      return;
    }
    if (listeningBaseMessageRef.current === null) {
      listeningBaseMessageRef.current = message;
    }
    const baseMessage = listeningBaseMessageRef.current ?? "";
    const transcript = speech.transcript.trim();
    const nextValue = [baseMessage.trim(), transcript].filter(Boolean).join(baseMessage.trim() ? " " : "");
    if (nextValue !== message) {
      onMessageChange(nextValue);
    }
  }, [message, onMessageChange, speech.isListening, speech.transcript]);

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
    const handleFocusComposer = () => {
      textareaRef.current?.focus();
    };
    window.addEventListener("ai-school:focus-composer", handleFocusComposer);
    return () => window.removeEventListener("ai-school:focus-composer", handleFocusComposer);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (showModeSelector && modeMenuRef.current && !modeMenuRef.current.contains(target)) {
        setShowModeSelector(false);
      }
      const insideModelTrigger = modelMenuRef.current?.contains(target) ?? false;
      const insideModelPortal = modelPortalRef.current?.contains(target) ?? false;
      if (showModelSelector && !insideModelTrigger && !insideModelPortal) {
        setShowModelSelector(false);
      }
      if (showAgentSelector && agentMenuRef.current && !agentMenuRef.current.contains(target)) {
        setShowAgentSelector(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showAgentSelector, showModeSelector, showModelSelector]);

  // Issue #14: Lift composer above the virtual keyboard on mobile using the Visual Viewport API
  useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      const offset = window.innerHeight - viewport.height;
      const composerEl = document.querySelector("[data-composer]");
      if (composerEl instanceof HTMLElement) {
        composerEl.style.paddingBottom = offset > 50 ? `${offset}px` : "";
      }
    };

    viewport.addEventListener("resize", handleResize);
    return () => viewport.removeEventListener("resize", handleResize);
  }, []);

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
    if (!speech.isSupported) {
      setShowVoiceStub(true);
      return;
    }
    if (speech.isListening) {
      speech.stop();
      speech.reset();
      listeningBaseMessageRef.current = null;
      return;
    }
    listeningBaseMessageRef.current = message;
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
    if (status === "processing") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Processing
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

  function handleTipAction(actionId: "switch-research" | "open-settings" | "open-tour" | "open-timer" | "open-feedback" | "new-chat" | "open-orchestration") {
    if (actionId === "switch-research") {
      handleModeSelect("research");
      return;
    }
    if (actionId === "open-settings") {
      window.dispatchEvent(new CustomEvent("ai-school:toggle-settings"));
      return;
    }
    if (actionId === "open-tour") {
      window.dispatchEvent(new CustomEvent("ai-school:open-tour"));
      return;
    }
    if (actionId === "open-timer") {
      window.dispatchEvent(new CustomEvent("ai-school:open-focus-timer"));
      return;
    }
    if (actionId === "open-feedback") {
      window.dispatchEvent(new CustomEvent("ai-school:open-feedback"));
      return;
    }
    if (actionId === "new-chat") {
      window.dispatchEvent(new CustomEvent("ai-school:new-chat"));
      return;
    }
    window.dispatchEvent(new CustomEvent("ai-school:open-orchestration"));
  }

  const showSmartTip = !slashActive && fileList.length === 0;

  return (
    <footer
      data-composer
      className={cn(
        "sticky bottom-0 z-20 px-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-10",
        draggingFiles && "bg-[color-mix(in_oklab,var(--accent-cyan)_8%,var(--bg-primary))]",
      )}
      style={draggingFiles ? undefined : { background: "linear-gradient(to bottom, transparent 0%, var(--bg-primary) 42%)" }}
      aria-label="Message composer"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mx-auto w-full max-w-[680px] xl:max-w-[780px] 2xl:max-w-[860px]">
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

        {showSmartTip ? (
          <SmartTipRotator
            mode={mode}
            messageCount={messageCount}
            sending={sending}
            streamPhase={sending ? "generating" : "idle"}
            hasResources={fileList.length > 0}
            streakAtRisk={streakAtRisk}
            continuationChat={continuationChat}
            onAction={handleTipAction}
          />
        ) : null}

        {fileList.length > 0 && (
          <div className="-mb-px mx-auto w-[95%] overflow-hidden rounded-t-xl rounded-b-none border border-b-0 border-[var(--border-default)] bg-[var(--bg-elevated)]">
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => setAttachmentsExpanded((prev) => !prev)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
                aria-expanded={attachmentsExpanded}
              >
                <Paperclip className="h-3.5 w-3.5" />
                {fileList.length} attachment{fileList.length === 1 ? "" : "s"} attached
                {attachmentsExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div
              className={cn(
                "grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-[var(--ease-standard)]",
                attachmentsExpanded ? "[grid-template-rows:1fr] opacity-100" : "[grid-template-rows:0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden border-t border-[var(--border-default)] px-2.5 pb-2.5 pt-2">
                <div className="max-h-[220px] overflow-y-auto rounded-xl bg-[var(--bg-elevated)] p-1.5">
                  <div className="flex flex-wrap gap-2 pr-1">
                    {fileList.map((file) => {
                      const status = fileUploadState[fileKey(file)]?.status ?? "pending";
                      const thumbnailUrl = fileUploadState[fileKey(file)]?.thumbnailUrl;
                      const warning = fileUploadState[fileKey(file)]?.error;
                      const extension = file.name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
                      return (
                        <span
                          key={`${file.name}-${file.size}`}
                          className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2 text-xs font-medium"
                        >
                          {thumbnailUrl ? (
                            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-secondary)]">
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
              </div>
            </div>
          </div>
        )}

        <div className="relative overflow-visible rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <div ref={modeMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowModeSelector((prev) => !prev)}
                  title={modeConfig.description}
                  data-tour="mode-selector"
                  className={cn(selectorTriggerClass, "max-w-[11.5rem] shrink-0", modeTransitioning && "animate-subtle-pulse")}
                >
                  <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ background: modeConfig.color }} />
                  <span className="truncate">{modeConfig.label}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showModeSelector && (
                  <div className="absolute bottom-full left-0 z-[340] mb-2 max-h-[320px] w-[min(92vw,22rem)] overflow-y-auto overscroll-contain rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
                    <p className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--text-secondary)]">
                      Available
                    </p>
                    {orderedModes
                      .filter((candidate) => isModeAvailable(candidate.key))
                      .map((m) => {
                      const mc = getModeConfig(m.key);
                      const isActive = m.key === mode;
                      const available = isModeAvailable(m.key);
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
                            </p>
                            <p className="text-[11px] text-[var(--text-secondary)]">{mc.description}</p>
                          </div>
                        </button>
                      );
                    })}

                    {orderedModes.some((candidate) => COMING_SOON_MODES.has(candidate.key)) ? (
                      <>
                        <div className="my-1 border-t border-[var(--border-default)]" />
                        <p className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-[var(--text-secondary)]">
                          Coming Soon
                        </p>
                      </>
                    ) : null}
                    {orderedModes
                      .filter((candidate) => COMING_SOON_MODES.has(candidate.key))
                      .map((m) => {
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
                  className={cn(selectorTriggerClass, "max-w-[13rem] shrink-0")}
                >
                  <Bot className="h-4 w-4" />
                  <span className="max-w-[260px] truncate">
                    {routerMode === "auto" || routerMode === "openrouter_auto"
                      ? "Auto"
                      : formatModelLabel(selectedModel?.modelId ?? manualModel)}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showModelSelector && createPortal(
                  <div
                    ref={modelPortalRef}
                    className="fixed z-[9999] max-h-[480px] w-[min(92vw,32rem)] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]"
                    style={modelSelectorPosition ? { bottom: modelSelectorPosition.bottom, left: modelSelectorPosition.left, opacity: 1 } : { top: 0, left: 0, opacity: 0, pointerEvents: "none" }}
                  >
                    <div className="flex h-full max-h-[480px]">
                      <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-[var(--border-default)] bg-[var(--bg-secondary)] py-2 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => setProviderFilter("all")}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${providerFilter === "all" ? "bg-[var(--bg-elevated)] shadow-sm border border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] text-[var(--accent-cyan)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                          title="All models"
                        >
                          <Globe className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setProviderFilter("starred")}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${providerFilter === "starred" ? "bg-[var(--bg-elevated)] shadow-sm border border-[color-mix(in_oklab,var(--warning)_45%,var(--border-default))] text-[var(--warning)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
                          title="Starred models"
                        >
                          <Star className="h-4 w-4" />
                        </button>
                        <div className="my-1 w-6 border-b border-[var(--border-default)] shrink-0" />
                        {providerOptions.map((provider) => (
                          <button
                            key={provider}
                            type="button"
                            onClick={() => setProviderFilter(provider)}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${providerFilter === provider ? "bg-[var(--bg-elevated)] shadow-sm border border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))]" : "hover:bg-[var(--bg-hover)]"}`}
                            title={provider}
                          >
                            <ProviderLogo provider={provider} size={20} className="rounded-md" />
                          </button>
                        ))}
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2">
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

                        <div className="border-b border-[var(--border-default)] p-2">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
                            <input
                              ref={modelSearchRef}
                              value={modelSearch}
                              onChange={(event) => setModelSearch(event.target.value)}
                              placeholder="Search models..."
                              className="h-9 w-full appearance-none rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] pl-10 pr-2 text-sm outline-none transition focus:border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))]"
                            />
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2">
                          {providerFilter === "all" || providerFilter === "starred" ? (
                            <div className="mb-2">
                              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                                Auto
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  if (autoRoutingRestriction) return;
                                  onSelectAuto();
                                  setShowModelSelector(false);
                                }}
                                disabled={Boolean(autoRoutingRestriction)}
                                title={autoRoutingRestriction ?? "Use adaptive routing for this conversation."}
                                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
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
                                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">Auto</p>
                                  <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                    Adaptive routing (only while Auto is selected)
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
                            </div>
                          ) : null}

                          {filteredModelRows.length === 0 ? (
                            <p className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">No models found</p>
                          ) : (
                            <div className="space-y-1">
                              {filteredModelRows.map((row, index) => {
                                const model = row.model;
                                const isSelected = routerMode === "manual" && manualModel === model.modelId;
                                const displayName = cleanModelDisplayText(model.name) || formatModelLabel(model.modelId);
                                const disabled = Boolean(row.restrictionReason);
                                const isStarred = starredModels.has(model.modelId);

                                return (
                                  <div key={model.modelId} className="group relative">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (disabled) return;
                                        onSelectModel(model.modelId);
                                        setShowModelSelector(false);
                                      }}
                                      title={row.restrictionReason ?? undefined}
                                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition pr-10 ${
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
                                            {index < 5 && !modelSearch.trim() && providerFilter === "all" ? (
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
                                    <button
                                      type="button"
                                      onClick={(e) => toggleStarModel(e, model.modelId)}
                                      className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 transition ${isStarred ? 'text-[var(--warning)] opacity-100' : 'text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)]'}`}
                                      title={isStarred ? "Unstar model" : "Star model"}
                                    >
                                      <Star className="h-4 w-4" fill={isStarred ? "currentColor" : "none"} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )}
              </div>

              <div ref={agentMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowAgentSelector((prev) => !prev)}
                  title="Attach an agent persona and resources to this chat"
                  data-tour="agent-selector"
                  className={cn(selectorTriggerClass, "max-w-[10.5rem] shrink-0", agentTransitioning && "animate-subtle-pulse")}
                >
                  <span>{selectedAgent?.avatarEmoji ?? "🧠"}</span>
                  <span className="max-w-[120px] truncate">{selectedAgent?.name ?? "No agent"}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {showAgentSelector && (
                  <div className="absolute bottom-full left-0 z-[340] mb-2 w-[min(95vw,22rem)] overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
                    <div className="border-b border-[var(--border-default)] px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Agent Workspace</p>
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="relative w-full">
                          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-secondary)]" />
                          <input
                            value={agentSearch}
                            onChange={(event) => setAgentSearch(event.target.value)}
                            placeholder="Search agents..."
                            className="h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] pl-8 pr-2 text-xs outline-none transition focus:border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))]"
                          />
                        </div>
                        <select
                          value={agentSubjectFilter}
                          onChange={(event) => setAgentSubjectFilter(event.target.value)}
                          className="h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] outline-none"
                        >
                          <option value="all">All subjects</option>
                          {agentSubjectOptions.map((subject) => (
                            <option key={subject} value={subject}>
                              {subject}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="max-h-[380px] overflow-y-auto p-2">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectAgent(undefined);
                          setShowAgentSelector(false);
                        }}
                        className={`mb-2 flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                          !selectedAgentId
                            ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--text-primary)]"
                            : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span>🧠</span>
                          No agent
                        </span>
                        {!selectedAgentId ? <span className="text-[10px] uppercase tracking-[0.08em]">Active</span> : null}
                      </button>

                      {recommendedAgents.length > 0 ? (
                        <div className="mb-3">
                          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Recommended</p>
                          <div className="flex flex-col gap-1.5">
                            {recommendedAgents.map((agent) => (
                              <button
                                key={`recommended-${agent._id}`}
                                type="button"
                                onClick={() => {
                                  onSelectAgent(agent._id);
                                  setShowAgentSelector(false);
                                }}
                                className={`rounded-lg border p-2 text-left transition ${
                                  selectedAgentId === agent._id
                                    ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]"
                                    : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 overflow-hidden">
                                    <span className="text-base leading-none">{agent.avatarEmoji ?? "🧠"}</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs font-medium text-[var(--text-primary)]">{agent.name}</p>
                                      <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                        {(agent.subjectArea || agent.category || "General").slice(0, 32)}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="shrink-0 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[var(--accent-cyan)]">
                                    Match
                                  </span>
                                </div>
                                <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                                  {agent.resourceCount ?? 0} resources · {agent.usageCount} uses
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {schoolAgents.length > 0 ? (
                        <div className="mb-3">
                          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">School Agents</p>
                          <div className="flex flex-col gap-1.5">
                            {schoolAgents.slice(0, 8).map((agent) => (
                              <button
                                key={`school-${agent._id}`}
                                type="button"
                                onClick={() => {
                                  onSelectAgent(agent._id);
                                  setShowAgentSelector(false);
                                }}
                                className={`rounded-lg border p-2 text-left transition flex flex-col justify-center min-h-[50px] ${
                                  selectedAgentId === agent._id
                                    ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]"
                                    : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                <div className="flex items-center gap-2 overflow-hidden">
                                  <span className="text-base leading-none">{agent.avatarEmoji ?? "🧠"}</span>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium text-[var(--text-primary)]">{agent.name}</p>
                                    <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                      {(agent.subjectArea || agent.category || "General").slice(0, 32)}
                                    </p>
                                  </div>
                                </div>
                                <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                                  {agent.resourceCount ?? 0} resources · {agent.usageCount} uses
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {myAgents.length > 0 ? (
                        <div className="mb-3">
                          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">My Agents</p>
                          <div className="flex flex-col gap-1.5">
                            {myAgents.slice(0, 8).map((agent) => (
                              <button
                                key={`mine-${agent._id}`}
                                type="button"
                                onClick={() => {
                                  onSelectAgent(agent._id);
                                  setShowAgentSelector(false);
                                }}
                                className={`rounded-lg border p-2 text-left transition flex flex-col justify-center min-h-[50px] ${
                                  selectedAgentId === agent._id
                                    ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]"
                                    : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                <div className="flex items-center gap-2 overflow-hidden">
                                  <span className="text-base leading-none">{agent.avatarEmoji ?? "🧠"}</span>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium text-[var(--text-primary)]">{agent.name}</p>
                                    <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                      {(agent.subjectArea || agent.category || "General").slice(0, 32)}
                                    </p>
                                  </div>
                                </div>
                                <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                                  {agent.resourceCount ?? 0} resources · {agent.usageCount} uses
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {allAgentsSection.length > 0 ? (
                        <div className="mb-2">
                          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">All Agents</p>
                          <div className="flex flex-col gap-1.5">
                            {allAgentsSection.slice(0, 10).map((agent) => (
                              <button
                                key={`all-${agent._id}`}
                                type="button"
                                onClick={() => {
                                  onSelectAgent(agent._id);
                                  setShowAgentSelector(false);
                                }}
                                className={`rounded-lg border p-2 text-left transition flex flex-col justify-center min-h-[50px] ${
                                  selectedAgentId === agent._id
                                    ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]"
                                    : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                                }`}
                              >
                                <div className="flex items-center gap-2 overflow-hidden">
                                  <span className="text-base leading-none">{agent.avatarEmoji ?? "🧠"}</span>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium text-[var(--text-primary)]">{agent.name}</p>
                                    <p className="truncate text-[10px] text-[var(--text-secondary)]">
                                      {(agent.subjectArea || agent.category || "General").slice(0, 32)}
                                    </p>
                                  </div>
                                </div>
                                <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
                                  {agent.resourceCount ?? 0} resources · {agent.usageCount} uses
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="border-t border-[var(--border-default)] p-2">
                      <Link
                        href="/agents/new"
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Quick create agent
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              data-tour="auto-controls"
              className="hidden shrink-0 items-center gap-1.5 sm:flex"
            >
              <SettingPill
                label="Enhance"
                value={autoEnhancePrompt}
                onChange={onAutoEnhancePromptChange}
                icon={<Sparkles className="h-3.5 w-3.5" />}
              />
              <SettingPill
                label="Think"
                value={autoThinking}
                onChange={onAutoThinkingChange}
                icon={<Brain className="h-3.5 w-3.5" />}
              />
              <SettingPill
                label="Search"
                value={autoSearch}
                onChange={onAutoSearchChange}
                icon={<Search className="h-3.5 w-3.5" />}
              />
            </div>

            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label="More controls">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onAutoEnhancePromptChange(nextPreference(autoEnhancePrompt))}>
                    Enhance: {preferenceLabel(autoEnhancePrompt)}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAutoThinkingChange(nextPreference(autoThinking))}>
                    Think: {preferenceLabel(autoThinking)}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAutoSearchChange(nextPreference(autoSearch))}>
                    Search: {preferenceLabel(autoSearch)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {!selectedAgentId && agentSuggestion ? (
            <div className="border-b border-[var(--border-default)] px-3 py-1.5">
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

          <div className={sidebarExpanded ? "flex items-end gap-2 px-3 pb-3 pt-2" : "flex flex-col"}>
            <div className={sidebarExpanded ? "flex-1 min-w-0 max-h-[200px] overflow-y-auto" : "max-h-[200px] overflow-y-auto px-4 py-1.5"}>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(event) => onMessageChange(event.target.value)}
                onPaste={handlePaste}
                placeholder="Ask anything. For best results, include your context and goal."
                data-tour="composer"
                aria-label="Message input"
                rows={1}
                className="min-h-[24px] w-full resize-none appearance-none border-0 bg-transparent pl-3 pr-0 py-1 text-[15px] leading-6 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] shadow-none outline-none ring-0 focus:border-transparent focus:outline-none focus:ring-0 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none"
                onKeyDown={handleKeyDown}
              />
              {speech.isListening ? (
                <p className="inline-flex items-center gap-1 pb-1 text-xs text-[var(--danger)]" aria-live="polite">
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[var(--danger)]" />
                  Recording... dictating into composer
                </p>
              ) : null}
              {sendDisabledReason ? (
                <p className="pb-1 text-xs text-[var(--warning)]" aria-live="polite">{sendDisabledReason}</p>
              ) : null}
              {speech.error ? (
                <p className="pb-1 text-xs text-[var(--warning)]" aria-live="polite">{speech.error}</p>
              ) : null}
            </div>

            <div className={sidebarExpanded ? "flex shrink-0 items-center gap-1.5 mb-1" : "flex items-center justify-end gap-2 px-3 pb-2.5 pt-0.5"}>
              <input
                ref={attachInputRef}
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                onClick={() => attachInputRef.current?.click()}
                aria-label="Attach files"
                title="Attach files"
              >
                <Paperclip className="h-4.5 w-4.5" />
              </Button>
              <Button
                onClick={handleToggleMic}
                variant={speech.isListening ? "destructive" : "ghost"}
                size="icon"
                className={cn("h-9 w-9 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]", speech.isListening && "animate-pulse text-[var(--danger)]")}
                aria-label={speech.isListening ? "Stop voice input" : "Start voice input"}
                title={speech.isSupported ? "Voice input" : "Voice input support is coming soon for this browser."}
              >
                <Mic className="h-4.5 w-4.5" />
              </Button>
              {sending && onStop ? (
                <Button
                  onClick={onStop}
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  aria-label="Stop generation"
                >
                  <Square className="h-4.5 w-4.5" />
                </Button>
              ) : (
                <Button
                  onClick={onSend}
                  disabled={sending || !message.trim() || Boolean(sendDisabledReason)}
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  aria-label="Send message"
                  title={sendDisabledReason ?? "Send message"}
                >
                  <ArrowUp className="h-4.5 w-4.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showVoiceStub ? (
        <div className="fixed inset-0 z-[230] flex items-end justify-center bg-black/35 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-overlay)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Voice input</h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Voice capture is not available in this browser yet. You can still attach audio files and transcribe later.
            </p>
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="secondary" onClick={() => setShowVoiceStub(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </footer>
  );
}
