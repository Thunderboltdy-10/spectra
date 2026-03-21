"use client";

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AchievementToast, type AchievementToastData } from "@/components/achievement-toast";
import type { Agent, Citation, RouteTrace, RouterMode, StudyMode, ThinkingLevel } from "@/types";
import { appendToBuffer, createBufferState } from "@/lib/structured-stream-buffer";
import { useSidebar } from "@/context/sidebar-context";
import { isModeAvailable } from "@/lib/modes";
import { shouldRetryResourceProcessing, toClientFileStatus } from "../../shared/resource-processing";

export type Chat = {
  _id: string;
  title: string;
  latestUserPrompt?: string;
  mode: StudyMode;
  packId?: string;
  agentId?: string;
  updatedAt: number;
};

type ChatSearchHit = {
  chatId: string;
  chatTitle: string;
  messageSnippet: string;
  createdAt: number;
  messageId: string;
};

type ActiveCollaboratorState = {
  role: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  model?: string;
  preview?: string;
  tokensUsed?: number;
};

type AgentSuggestion = {
  id: string;
  name: string;
  score: number;
  reason: string;
};

export type Message = {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
  enhancedContent?: string;
  thinkingContent?: string;
  attachments?: string[];
  attachmentResourceIds?: string[];
  attachmentPreviews?: Array<{
    name: string;
    mimeType?: string;
    isImage?: boolean;
    thumbnailUrl?: string;
  }>;
  modelUsed?: string;
  modelRequested?: string;
  whyThisResponse?: string;
  routeTrace?: RouteTrace;
  citations?: Citation[];
  usageIn?: number;
  usageOut?: number;
  createdAt?: number;
  mode?: StudyMode;
};

export type FileStatus = "pending" | "uploading" | "processing" | "ready" | "error";

export type ModelOption = {
  _id: string;
  modelId: string;
  name: string;
  provider: string;
  description?: string;
  contextLength?: number;
  tags: string[];
  inputCostPerM?: number;
  outputCostPerM?: number;
  isFree?: boolean;
  costRating?: "low" | "medium" | "high";
  speedRating?: "low" | "medium" | "high";
  reasoningRating?: "low" | "medium" | "high";
  multimodalRating?: "none" | "basic" | "strong";
  capabilities?: {
    reasoning?: number;
    creative?: number;
    code?: number;
    vision?: number;
    speed?: number;
  };
  isFeatured?: boolean;
  featuredOrder?: number;
};

export type PersonalResource = {
  _id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: "uploaded" | "processing" | "processed" | "failed";
  processingAttempts?: number;
  error?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type UserSpending = {
  totalSpentEur: number;
  totalCostCents: number;
  knownCostCents?: number;
  estimatedUnpricedCostCents?: number;
  tier: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
  softLimitReached: boolean;
  hardLimitReached: boolean;
  softLimitCents?: number;
  cheapOnlyLimitCents?: number;
  hardLimitCents?: number;
  budgetUsagePercent?: number;
  activityUsagePercent?: number;
  tokenUsagePercent?: number;
  monthlyTokens?: number;
  monthlyEvents?: number;
  monthlyTokenBudget?: number;
  monthlyCostCentsFromEvents?: number;
  marginPercent?: number;
};

export type AutoPreference = "auto" | "on" | "off";
type StreamPhase = "idle" | "compacting" | "routing" | "searching" | "thinking" | "generating" | "synthesizing";
type SearchStatusBanner = "model_knowledge" | "real_search" | "error" | null;

function normalizePhaseStatus(value?: string): "planned" | "running" | "completed" | "skipped" | "failed" {
  if (value === "in_progress" || value === "running") return "running";
  if (value === "completed") return "completed";
  if (value === "skipped") return "skipped";
  if (value === "failed") return "failed";
  return "planned";
}

function streamPhaseFromPhaseId(phaseId?: string): StreamPhase | undefined {
  if (!phaseId) return undefined;
  if (phaseId === "routing" || phaseId === "planning") return "routing";
  if (phaseId === "retrieval" || phaseId === "search") return "searching";
  if (phaseId === "analysis" || phaseId === "verification" || phaseId === "memory" || phaseId === "title") return "thinking";
  if (phaseId === "authoring" || phaseId === "repair") return "generating";
  if (phaseId === "synthesis") return "synthesizing";
  return undefined;
}

const AUTO_COMPACTION_MIN_MESSAGES = 10;
const AUTO_COMPACTION_KEEP_LATEST = 6;
const SAVE_CONVERSATION_FILES_KEY = "ai-school:save-conversation-files-to-library";
const LAST_ACTIVE_CHAT_TS_KEY = "ai-school:lastActiveChatTimestamp";
const LAST_ACTIVE_CHAT_ID_KEY = "ai-school:lastActiveChatId";
const CHAT_SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;
const MEMORY_ENABLED_KEY = "ai-school:memory-enabled";
const SEARXNG_ENABLED_KEY = "ai-school:searxng-enabled";

type LiveModel = {
  id: string;
  name: string;
  provider: string;
  description?: string;
  contextLength?: number;
  pricing: {
    prompt?: number;
    completion?: number;
  };
  tags: string[];
  created?: string;
};

function readStoredToggle(key: string, fallback = true) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return fallback;
    return stored !== "0";
  } catch {
    return fallback;
  }
}

type ChatDetailResponse = {
  chat: {
    mode: StudyMode;
    routerMode: RouterMode;
    manualModel?: string;
    thinkingLevel: ThinkingLevel;
    usePersonalResources: boolean;
    packId?: string;
    agentId?: string;
  };
  messages: Message[];
};

type SendMessageOptions = {
  regenerate?: boolean;
  skipLocalUser?: boolean;
  skipServerUserPersist?: boolean;
  retryAttempt?: number;
  chatIdOverride?: string;
  modeOverride?: StudyMode;
  routerModeOverride?: RouterMode;
  manualModelOverride?: string;
  forcedModelOverride?: string;
  attemptedModels?: string[];
  preservedText?: string;
  preservedFiles?: File[];
  localUserMessageId?: string;
};

function mergeFetchedMessages(
  fetched: Message[],
  local: Message[],
  options?: {
    pendingLocalUserMessageIds?: Set<string>;
    isSendInFlight?: boolean;
  },
) {
  if (local.length === 0) return fetched;

  const merged = [...fetched];
  const fetchedById = new Set(fetched.map((item) => item._id));
  const pendingLocalUserMessageIds = options?.pendingLocalUserMessageIds ?? new Set<string>();
  const isSendInFlight = options?.isSendInFlight ?? false;

  for (const pending of local) {
    if (!pending || fetchedById.has(pending._id) || merged.some((item) => item._id === pending._id)) continue;

    if (pending.role === "user") {
      const shouldPreserve =
        pending._id.startsWith("local-") || (isSendInFlight && pendingLocalUserMessageIds.has(pending._id));
      if (!shouldPreserve) continue;
      const key = pending.content.trim();
      if (!key) continue;
      const pendingCreatedAt = pending.createdAt ?? Date.now();
      const duplicateUser = merged.some(
        (item) =>
          item.role === "user" &&
          item.content.trim() === key &&
          Math.abs((item.createdAt ?? pendingCreatedAt) - pendingCreatedAt) < 90_000,
      );
      if (duplicateUser) continue;
      merged.push(pending);
      continue;
    }

    if (pending.role === "assistant") {
      const pendingCreatedAt = pending.createdAt ?? 0;
      const duplicateAssistant = fetched.some(
        (item) =>
          item.role === "assistant" &&
          item.content.trim() === pending.content.trim() &&
          Math.abs((item.createdAt ?? pendingCreatedAt) - pendingCreatedAt) < 90_000,
      );
      if (duplicateAssistant) continue;
      merged.push(pending);
    }
  }

  return merged.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

function ext(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

async function buildImageThumbnail(file: File): Promise<string | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(undefined);
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const max = 320;
        const ratio = Math.min(1, max / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * ratio));
        const height = Math.max(1, Math.round(image.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(undefined);
          return;
        }
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/webp", 0.8));
      };
      image.onerror = () => resolve(undefined);
      image.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

const IMAGE_UPLOAD_MAX_BYTES = 4_500_000;
const IMAGE_UPLOAD_MAX_EDGE = 1800;

async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= IMAGE_UPLOAD_MAX_BYTES) return file;

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const ratio = Math.min(1, IMAGE_UPLOAD_MAX_EDGE / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * ratio));
      const height = Math.max(1, Math.round(image.height * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
        return;
      }

      ctx.drawImage(image, 0, 0, width, height);
      const targetMime = file.type === "image/jpeg" || file.type === "image/webp" ? file.type : "image/webp";
      const qualities = [0.86, 0.78, 0.7, 0.62];

      const tryEncode = (index: number) => {
        const quality = qualities[index];
        canvas.toBlob((blob) => {
          if (!blob) {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
            return;
          }
          if (blob.size <= IMAGE_UPLOAD_MAX_BYTES || index >= qualities.length - 1) {
            URL.revokeObjectURL(objectUrl);
            if (blob.size >= file.size * 0.98) {
              resolve(file);
              return;
            }
            resolve(new File([blob], file.name, { type: blob.type || targetMime, lastModified: file.lastModified }));
            return;
          }
          tryEncode(index + 1);
        }, targetMime, quality);
      };

      tryEncode(0);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    image.src = objectUrl;
  });
}

type UploadResponse = {
  resourceIds?: string[];
  chatOnlyResourceIds?: string[];
  results?: Array<{
    file: string;
    resourceId?: string;
    status: string;
    error?: string;
    savedToLibrary?: boolean;
  }>;
};

async function uploadComposerFiles(
  files: File[],
  agentId?: string,
  options?: { saveToLibrary?: boolean },
): Promise<UploadResponse> {
  if (files.length === 0) return { resourceIds: [], results: [] };

  const formData = new FormData();
  formData.set("scope", "personal");
  formData.set("saveToLibrary", options?.saveToLibrary === false ? "0" : "1");
  if (agentId) {
    formData.set("agentId", agentId);
  }

  const preparedFiles = await Promise.all(
    files.map(async (file) => compressImageForUpload(file).catch(() => file)),
  );

  for (const file of preparedFiles) {
    formData.append("files", file);
  }

  const response = await fetch("/api/resources", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as UploadResponse;
}

function isLocalProvider(value?: string) {
  const normalized = (value ?? "").toLowerCase();
  return normalized.includes("local") || normalized.includes("ollama");
}

function sanitizeModelName(name: string) {
  return name
    .replace(/:free/gi, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s*&\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeProviderName(provider: string) {
  const clean = provider.trim();
  if (!clean) return "Unknown";
  const normalized = clean.toLowerCase();

  if (normalized.includes("openai")) return "OpenAI";
  if (normalized.includes("google") || normalized.includes("gemini")) return "Google";
  if (normalized.includes("anthropic")) return "Anthropic";
  if (normalized.includes("meta")) return "Meta";
  if (normalized.includes("mistral")) return "Mistral";
  if (normalized.includes("deepseek")) return "DeepSeek";
  if (normalized.includes("perplexity")) return "Perplexity";
  if (normalized.includes("x-ai") || normalized.includes("xai")) return "xAI";
  if (normalized.includes("cohere")) return "Cohere";
  if (normalized.includes("moonshot")) return "Moonshot";
  if (normalized.includes("qwen")) return "Qwen";
  if (normalized.includes("openrouter")) return "OpenRouter";

  return clean
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function mergeModels(catalog: ModelOption[], live: LiveModel[]) {
  const merged = new Map<string, ModelOption>();

  for (const model of catalog) {
    if (!model.modelId || isLocalProvider(model.provider) || isLocalProvider(model.modelId)) continue;
    merged.set(model.modelId, {
      ...model,
      name: sanitizeModelName(model.name),
      provider: normalizeProviderName(model.provider),
    });
  }

  for (const model of live) {
    if (!model.id || isLocalProvider(model.provider) || isLocalProvider(model.id)) continue;
    const existing = merged.get(model.id);
    merged.set(model.id, {
      _id: existing?._id ?? model.id,
      modelId: model.id,
      name: sanitizeModelName(model.name || existing?.name || model.id),
      provider: normalizeProviderName(model.provider || existing?.provider || "Unknown"),
      description: model.description || existing?.description,
      contextLength: model.contextLength ?? existing?.contextLength,
      tags: Array.from(new Set([...(existing?.tags ?? []), ...(model.tags ?? [])])),
      inputCostPerM: model.pricing.prompt ?? existing?.inputCostPerM,
      outputCostPerM: model.pricing.completion ?? existing?.outputCostPerM,
      isFree:
        existing?.isFree ??
        (model.id.includes(":free") ||
          (model.pricing.prompt === 0 && model.pricing.completion === 0)),
    });
  }

  return [...merged.values()].sort((a, b) => {
    const aCost = a.inputCostPerM ?? Number.MAX_SAFE_INTEGER;
    const bCost = b.inputCostPerM ?? Number.MAX_SAFE_INTEGER;
    if (aCost !== bCost) return aCost - bCost;
    return a.name.localeCompare(b.name);
  });
}

export function useChatState() {
  const sidebar = useSidebar();
  const [loading, setLoading] = useState(true);
  const role = sidebar.role;
  const isSuperAdmin = sidebar.isSuperAdmin;
  const chats = sidebar.chats;
  const setChats = sidebar.setChats;
  const [models, setModels] = useState<ModelOption[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [personalResources, setPersonalResources] = useState<PersonalResource[]>([]);

  const [selectedChatId, setSelectedChatId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();

  const [mode, setMode] = useState<StudyMode>("tutor");
  const [routerMode, setRouterMode] = useState<RouterMode>("auto");
  const [manualModel, setManualModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [usePersonalResources, setUsePersonalResources] = useState(true);
  const [autoSaveConversationFilesToLibrary, setAutoSaveConversationFilesToLibrary] = useState(true);

  const [autoEnhancePrompt, setAutoEnhancePrompt] = useState<AutoPreference>("auto");
  const [autoModel, setAutoModel] = useState(true);
  const [autoThinking, setAutoThinking] = useState<AutoPreference>("auto");
  const [autoSearch, setAutoSearch] = useState<AutoPreference>("auto");
  const [autoCompaction, setAutoCompaction] = useState<AutoPreference>("auto");

  const userSpending = sidebar.userSpending;
  const setUserSpending = sidebar.setUserSpending;
  const userMemorySummary = sidebar.userMemorySummary;
  const orgWelcomeMessage = sidebar.orgWelcomeMessage;
  const orgLogoUrl = sidebar.orgLogoUrl;
  const orgName = sidebar.orgName;
  const [lastAutoResult, setLastAutoResult] = useState<{
    modelUsed?: string;
    searchEnabled: boolean;
    thinkingLevel: ThinkingLevel;
    promptEnhanced: boolean;
  } | null>(null);
  const [agentSuggestion, setAgentSuggestion] = useState<AgentSuggestion | null>(null);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftResponses, setDraftResponses] = useState<Map<string, string>>(new Map());
  const [draftThinkings, setDraftThinkings] = useState<Map<string, string>>(new Map());
  const [activeStreamIds, setActiveStreamIds] = useState<Set<string>>(new Set());
  const [hasRealThinking, setHasRealThinking] = useState(false);
  const draftResponse = draftResponses.get(selectedChatId) ?? "";
  const draftThinking = draftThinkings.get(selectedChatId) ?? "";
  const sending = activeStreamIds.has(selectedChatId);
  const [activeCollaborators, setActiveCollaborators] = useState<ActiveCollaboratorState[]>([]);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>("idle");
  const [livePhasePlan, setLivePhasePlan] = useState<NonNullable<RouteTrace["phasePlan"]>>([]);
  const [searchStatusBanner, setSearchStatusBanner] = useState<SearchStatusBanner>(null);
  const [collaboratorPhase, setCollaboratorPhase] = useState<"idle" | "running" | "synthesizing">("idle");
  const [fileList, setFileList] = useState<File[]>([]);
  const [fileUploadState, setFileUploadState] = useState<
    Record<string, { status: FileStatus; thumbnailUrl?: string; error?: string }>
  >({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [compactingConversation, setCompactingConversation] = useState(false);
  const [bookmarkedMessageIds, setBookmarkedMessageIds] = useState<Set<string>>(new Set());
  const [bookmarkingMessageId, setBookmarkingMessageId] = useState<string | null>(null);

  const search = sidebar.search;
  const setSearch = sidebar.setSearch;
  const [searchHits, setSearchHits] = useState<ChatSearchHit[]>([]);
  const sidebarOpen = sidebar.sidebarOpen;
  const setSidebarOpen = sidebar.setSidebarOpen;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pinnedChatIds = sidebar.pinnedChatIds;
  const [imageModel, setImageModel] = useState<string>("");

  const abortControllerRef = useRef<AbortController | null>(null);
  const selectedChatIdRef = useRef("");
  const previousSelectedChatIdRef = useRef("");
  const initializedRef = useRef(false);
  const lastAttachmentPreviewsRef = useRef<Map<string, Message["attachmentPreviews"]>>(new Map());
  const pendingCompletionsRef = useRef<Map<string, Message[]>>(new Map());
  const streamChatIdRef = useRef<string | null>(null);
  const activeStreamsRef = useRef<Set<string>>(new Set());
  const activeStreamIdsRef = useRef<Set<string>>(new Set());
  const pendingLocalUserMessageIdsRef = useRef<Set<string>>(new Set());
  const pendingLocalUserMessagesRef = useRef<Map<string, Message>>(new Map());
  const pendingLocalUserMessageChatIdsRef = useRef<Map<string, string>>(new Map());
  const sendingRef = useRef(false);
  const shownAchievementToastsRef = useRef<Set<string>>(new Set());
  const lastPersonalRetryFailureRef = useRef("");

  const refreshBookmarks = useCallback(async (chatId = selectedChatIdRef.current) => {
    if (!chatId) {
      setBookmarkedMessageIds(new Set());
      return;
    }

    const response = await fetch(`/api/bookmarks?chatId=${encodeURIComponent(chatId)}`);
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as { bookmarks?: Array<{ messageId?: string }> };
    const ids = new Set(
      (payload.bookmarks ?? [])
        .map((bookmark) => bookmark.messageId)
        .filter((value): value is string => Boolean(value)),
    );

    if (selectedChatIdRef.current === chatId) {
      setBookmarkedMessageIds(ids);
    }
  }, []);

  // Draft persistence helpers
  const getDraftKey = (chatId: string) => `ai-school:draft:${chatId}`;
  
  const saveDraft = useCallback((chatId: string, draft: string) => {
    if (!chatId) return;
    if (draft.trim()) {
      localStorage.setItem(getDraftKey(chatId), draft);
    } else {
      localStorage.removeItem(getDraftKey(chatId));
    }
  }, []);

  const loadDraft = useCallback((chatId: string): string => {
    if (!chatId) return "";
    return localStorage.getItem(getDraftKey(chatId)) ?? "";
  }, []);

  const clearDraft = useCallback((chatId: string) => {
    if (!chatId) return;
    localStorage.removeItem(getDraftKey(chatId));
  }, []);

  const hasDraft = useCallback((chatId: string): boolean => {
    if (!chatId) return false;
    const draft = localStorage.getItem(getDraftKey(chatId));
    return draft !== null && draft.trim().length > 0;
  }, []);

  const syncChatIdToUrl = useCallback((chatId?: string) => {
    if (typeof window === "undefined") return;
    const current = new URL(window.location.href);
    const nextChatId = chatId?.trim() ?? "";
    if (nextChatId) {
      current.searchParams.set("chatId", nextChatId);
    } else {
      current.searchParams.delete("chatId");
    }
    const nextUrl = `${current.pathname}${current.search}${current.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, []);

  const clearRecentChatActivity = useCallback(() => {
    try {
      window.localStorage.removeItem(LAST_ACTIVE_CHAT_TS_KEY);
      window.localStorage.removeItem(LAST_ACTIVE_CHAT_ID_KEY);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const markChatActive = useCallback((chatId: string) => {
    if (!chatId) return;
    try {
      window.localStorage.setItem(LAST_ACTIVE_CHAT_TS_KEY, String(Date.now()));
      window.localStorage.setItem(LAST_ACTIVE_CHAT_ID_KEY, chatId);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const getRecentChatIdFromStorage = useCallback((): string | null => {
    try {
      const storedChatId = window.localStorage.getItem(LAST_ACTIVE_CHAT_ID_KEY);
      const storedTsRaw = window.localStorage.getItem(LAST_ACTIVE_CHAT_TS_KEY);
      if (!storedChatId || !storedTsRaw) return null;
      const storedTs = Number(storedTsRaw);
      if (!Number.isFinite(storedTs)) {
        clearRecentChatActivity();
        return null;
      }
      if (Date.now() - storedTs > CHAT_SESSION_WINDOW_MS) {
        clearRecentChatActivity();
        return null;
      }
      return storedChatId;
    } catch {
      return null;
    }
  }, [clearRecentChatActivity]);

  const selectedAgent = useMemo(
    () => agents.find((item) => item._id === selectedAgentId),
    [agents, selectedAgentId],
  );

  const selectedChat = useMemo(
    () => chats.find((chat) => chat._id === selectedChatId),
    [chats, selectedChatId],
  );

  const selectedModel = useMemo(
    () => models.find((model) => model.modelId === manualModel),
    [models, manualModel],
  );

  const filteredChats = useMemo(() => {
    const clean = search.trim().toLowerCase();
    if (!clean) return chats;

    if (searchHits.length > 0) {
      const byId = new Map(chats.map((chat) => [chat._id, chat]));
      const ranked: Chat[] = [];
      for (const hit of searchHits) {
        const base = byId.get(hit.chatId);
        if (!base) continue;
        ranked.push({
          ...base,
          title: hit.chatTitle || base.title,
          latestUserPrompt: hit.messageSnippet || base.latestUserPrompt,
          updatedAt: Math.max(base.updatedAt, hit.createdAt),
        });
      }
      return ranked;
    }

    return chats.filter((chat) =>
      `${chat.latestUserPrompt ?? ""} ${chat.title}`.toLowerCase().includes(clean),
    );
  }, [chats, search, searchHits]);

  useEffect(() => {
    if (sidebar.loading || initializedRef.current) return;
    initializedRef.current = true;

    setModels(mergeModels(sidebar.models as ModelOption[], []));
    setAgents(sidebar.agents);

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const modelParam = params?.get("model") ?? null;
    const modeParam = (params?.get("mode") as StudyMode | null) ?? null;
    const chatIdParam = params?.get("chatId") ?? null;

    if (modelParam) {
      setManualModel(modelParam);
      setRouterMode("manual");
    } else {
      const mergedModels = mergeModels(sidebar.models as ModelOption[], []);
      if (mergedModels.length > 0) {
        setManualModel(mergedModels[0].modelId);
      }
    }

    if (modeParam) {
      setMode(modeParam);
    }

    let firstChat: Chat | undefined;
    if (chatIdParam) {
      firstChat = chats.find((chat) => chat._id === chatIdParam);
      if (!firstChat) {
        const recentChatId = getRecentChatIdFromStorage();
        if (recentChatId) {
          firstChat = chats.find((chat) => chat._id === recentChatId);
        }
      }
    } else {
      const recentChatId = getRecentChatIdFromStorage();
      if (recentChatId) {
        firstChat = chats.find((chat) => chat._id === recentChatId);
      }
    }
    if (firstChat?._id) {
      selectedChatIdRef.current = firstChat._id;
      setSelectedChatId(firstChat._id);
      markChatActive(firstChat._id);
    } else {
      selectedChatIdRef.current = "";
      setSelectedChatId("");
      setMessages([]);
      syncChatIdToUrl(undefined);
    }

    void refreshPersonalResources().catch(() => {});
    void (async () => {
      try {
        const liveRes = await fetch("/api/models/live");
        if (!liveRes.ok) return;
        const liveData = (await liveRes.json()) as { models: LiveModel[] };
        setModels(mergeModels(sidebar.models as ModelOption[], liveData.models));
      } catch {
        // Ignore live model fetch failures.
      }
    })();

    setLoading(false);
  }, [sidebar.loading, sidebar.models, sidebar.agents, chats, getRecentChatIdFromStorage, markChatActive, syncChatIdToUrl]);

  useEffect(() => {
    if (sidebar.loading || !initializedRef.current) return;
    if (models.length > 0) return;
    setModels(mergeModels(sidebar.models as ModelOption[], []));
    setAgents(sidebar.agents);
  }, [models.length, sidebar.agents, sidebar.loading, sidebar.models]);

  useEffect(() => {
    const pendingResources = personalResources.filter(
      (resource) => resource.status === "uploaded" || resource.status === "processing",
    );
    if (pendingResources.length === 0) return;

    const now = Date.now();
    const staleResourceIds = pendingResources
      .filter((resource) => {
        return shouldRetryResourceProcessing({
          status: resource.status,
          updatedAt: Math.max(resource.updatedAt ?? resource.createdAt, resource.createdAt),
          processingAttempts: resource.processingAttempts,
          now,
        });
      })
      .map((resource) => resource._id);

    if (staleResourceIds.length > 0) {
      void retryPendingPersonalResources(staleResourceIds)
        .then(() => refreshPersonalResources())
        .catch((error) => {
          const key = staleResourceIds.slice().sort().join(",");
          if (lastPersonalRetryFailureRef.current !== key) {
            lastPersonalRetryFailureRef.current = key;
            toast.error(error instanceof Error ? error.message : "Failed to retry My Files processing");
          }
          void refreshPersonalResources().catch(() => {});
        });
    }

    const timer = window.setTimeout(() => {
      void refreshPersonalResources().catch(() => {});
    }, staleResourceIds.length > 0 ? 4000 : 3500);
    return () => window.clearTimeout(timer);
  }, [personalResources]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
    if (!initializedRef.current) return;
    syncChatIdToUrl(selectedChatId || undefined);
    if (selectedChatId) {
      markChatActive(selectedChatId);
    }
    setLivePhasePlan([]);
    setSearchStatusBanner(null);
  }, [selectedChatId, markChatActive, syncChatIdToUrl]);

  useEffect(() => {
    activeStreamIdsRef.current = activeStreamIds;
  }, [activeStreamIds]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SAVE_CONVERSATION_FILES_KEY);
      setAutoSaveConversationFilesToLibrary(stored !== "0");
    } catch {
      setAutoSaveConversationFilesToLibrary(true);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SAVE_CONVERSATION_FILES_KEY,
        autoSaveConversationFilesToLibrary ? "1" : "0",
      );
    } catch {
      // Ignore localStorage write failures.
    }
  }, [autoSaveConversationFilesToLibrary]);

  useEffect(() => {
    if (!selectedChatId) {
      previousSelectedChatIdRef.current = "";
      setMessages([]);
      setMessage(""); // Clear message when no chat selected
      // Don't clear drafts for chats that are still streaming
      if (!activeStreamIdsRef.current.has(selectedChatId)) {
        setDraftResponses(prev => { const next = new Map(prev); next.delete(selectedChatId); return next; });
        setDraftThinkings(prev => { const next = new Map(prev); next.delete(selectedChatId); return next; });
      }
      setActiveCollaborators([]);
      setCollaboratorPhase("idle");
      setStreamPhase("idle");
      setStreamError(null);
      setLastAutoResult(null);
      setAgentSuggestion(null);
      setBookmarkedMessageIds(new Set());
      setBookmarkingMessageId(null);
      return;
    }

    if (previousSelectedChatIdRef.current !== selectedChatId) {
      // Clear stale messages from the previously viewed chat before merging pending/fetched state.
      setMessages(() => {
        if (pendingLocalUserMessageIdsRef.current.size === 0) {
          return [];
        }
        const pendingUsers = [...pendingLocalUserMessagesRef.current.values()]
          .filter((item) => {
            const chatId = pendingLocalUserMessageChatIdsRef.current.get(item._id) ?? "";
            return chatId === "" || chatId === selectedChatId;
          })
          .filter((item) => pendingLocalUserMessageIdsRef.current.has(item._id))
          .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
        return pendingUsers;
      });
      previousSelectedChatIdRef.current = selectedChatId;
    }

    // Load draft for this chat
    const draft = loadDraft(selectedChatId);
    setMessage(draft);

    // Merge any pending completions for this chat
    const pending = pendingCompletionsRef.current.get(selectedChatId);
    if (pending && pending.length > 0) {
      setMessages((prev) => [...prev, ...pending]);
      pendingCompletionsRef.current.delete(selectedChatId);
    }

    setLastAutoResult(null);
    setAgentSuggestion(null);
    void refreshBookmarks(selectedChatId).catch(() => {});

    void (async () => {
      try {
        const response = await fetch(`/api/chats/${selectedChatId}`);
        if (!response.ok) throw new Error(await response.text());

        const data = (await response.json()) as ChatDetailResponse;
        setMode(data.chat.mode);
        setRouterMode(data.chat.routerMode);
        setThinkingLevel(data.chat.thinkingLevel);
        setUsePersonalResources(data.chat.usePersonalResources);
        setSelectedAgentId(data.chat.agentId);
        if (data.chat.manualModel) {
          setManualModel(data.chat.manualModel);
        }
        const messagesWithPreviews = data.messages.map((msg) => {
          if (msg.role === "user" && msg.attachments && msg.attachments.length > 0 && !msg.attachmentPreviews) {
            const previewKey = [...msg.attachments].sort().join("|");
            const cached = lastAttachmentPreviewsRef.current.get(previewKey);
            if (cached) {
              return { ...msg, attachmentPreviews: cached };
            }
          }
          return msg;
        });
        for (const [pendingId, localMessage] of pendingLocalUserMessagesRef.current.entries()) {
          if (pendingLocalUserMessageChatIdsRef.current.get(pendingId) !== selectedChatId) {
            continue;
          }
          const trimmedLocal = localMessage.content.trim();
          if (!trimmedLocal) continue;
          const localCreatedAt = localMessage.createdAt ?? Date.now();
          const matched = messagesWithPreviews.some(
            (item) =>
              item.role === "user" &&
              item.content.trim() === trimmedLocal &&
              Math.abs((item.createdAt ?? localCreatedAt) - localCreatedAt) < 90_000,
          );
          if (matched) {
            pendingLocalUserMessageIdsRef.current.delete(pendingId);
            pendingLocalUserMessagesRef.current.delete(pendingId);
            pendingLocalUserMessageChatIdsRef.current.delete(pendingId);
          }
        }
        const localPendingForCurrentChat = [...pendingLocalUserMessagesRef.current.entries()]
          .filter(([pendingId]) => pendingLocalUserMessageChatIdsRef.current.get(pendingId) === selectedChatId)
          .map(([, message]) => message);

        setMessages((prev) =>
          mergeFetchedMessages(
            messagesWithPreviews,
            [...prev, ...localPendingForCurrentChat],
            {
              pendingLocalUserMessageIds: pendingLocalUserMessageIdsRef.current,
              isSendInFlight: sendingRef.current,
            },
          ),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load chat");
      }
    })();
  }, [selectedChatId, loadDraft, refreshBookmarks]);

  // Auto-save draft when message changes (debounced)
  useEffect(() => {
    if (!selectedChatId) return;
    
    const timeout = setTimeout(() => {
      saveDraft(selectedChatId, message);
    }, 500); // Debounce 500ms
    
    return () => clearTimeout(timeout);
  }, [message, selectedChatId, saveDraft]);

  useEffect(() => {
    const activeKeys = new Set(fileList.map((file) => fileKey(file)));

    setFileUploadState((prev) => {
      const next: typeof prev = {};
      for (const [key, value] of Object.entries(prev)) {
        if (activeKeys.has(key)) next[key] = value;
      }
      for (const file of fileList) {
        const key = fileKey(file);
        if (!next[key]) {
          next[key] = { status: "pending" };
        }
      }
      return next;
    });

    void (async () => {
      for (const file of fileList) {
        if (!file.type.startsWith("image/")) continue;
        const key = fileKey(file);
        const thumbnail = await buildImageThumbnail(file);
        if (!thumbnail) continue;
        setFileUploadState((prev) => {
          const current = prev[key];
          if (!current) return prev;
          if (current.thumbnailUrl) return prev;
          return {
            ...prev,
            [key]: {
              ...current,
              thumbnailUrl: thumbnail,
            },
          };
        });
      }
    })();
  }, [fileList]);

  const startNewChat = useCallback(
    (agentId?: string) => {
      selectedChatIdRef.current = "";
      setSelectedChatId("");
      clearRecentChatActivity();
      setMessages([]);
      setMessage("");
      // No need to clear per-chat drafts when starting new chat
      setFileList([]);
      setFileUploadState({});
      setStreamError(null);
      setLastFailedMessage(null);
      setLastAutoResult(null);
      setAgentSuggestion(null);
      setMobileSidebarOpen(false);
      setStreamPhase("idle");
      pendingLocalUserMessageIdsRef.current.clear();
      pendingLocalUserMessagesRef.current.clear();
      pendingLocalUserMessageChatIdsRef.current.clear();

      setMode("auto");
      setRouterMode("auto");
      setManualModel("");
      setThinkingLevel("medium");
      setAutoEnhancePrompt("auto");
      setAutoThinking("auto");
      setAutoSearch("auto");
      setAutoCompaction("auto");

      if (agentId) {
        setSelectedAgentId(agentId);
      }
    },
    [clearRecentChatActivity],
  );

  useEffect(() => {
    const clean = search.trim();
    if (clean.length < 3) {
      setSearchHits([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/chats/search?q=${encodeURIComponent(clean)}&limit=40`);
          if (!response.ok) return;
          const data = (await response.json()) as { results: ChatSearchHit[] };
          setSearchHits(data.results ?? []);
        } catch {
          // Ignore transient search failures.
        }
      })();
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;

      if (isMod && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSidebarOpen((prev) => !prev);
      }

      // Cmd/Ctrl+K → quick mode picker
      if (isMod && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        window.dispatchEvent(new Event("ai-school:toggle-mode-picker"));
      }

      // Cmd/Ctrl+N → new chat
      if (isMod && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        startNewChat(selectedAgentId);
      }

      // Cmd/Ctrl+/ → focus search
      if (isMod && event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-search-input]")?.focus();
      }

      if (event.key === "Escape") {
        setSettingsOpen(false);
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSidebarOpen, startNewChat, selectedAgentId]);

  const updateExistingChatSettings = useCallback(
    async (next: {
      mode?: StudyMode;
      routerMode?: RouterMode;
      manualModel?: string;
      thinkingLevel?: ThinkingLevel;
      usePersonalResources?: boolean;
      title?: string;
    }) => {
      if (!selectedChatId) return;
      const response = await fetch(`/api/chats/${selectedChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    },
    [selectedChatId],
  );

  // Helper to update settings for a specific chat (used in stream handlers)
  const updateChatSettingsById = useCallback(
    async (chatId: string, next: {
      mode?: StudyMode;
      routerMode?: RouterMode;
      manualModel?: string;
      thinkingLevel?: ThinkingLevel;
      usePersonalResources?: boolean;
      title?: string;
    }) => {
      if (!chatId) return;
      const response = await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    },
    [],
  );

  useEffect(() => {
    const handleNewChat = () => startNewChat(selectedAgentId);
    const handleSettings = () => setSettingsOpen((prev) => !prev);
    const handleSetMode = (event: Event) => {
      const custom = event as CustomEvent<StudyMode>;
      const nextMode = custom.detail;
      if (!nextMode) return;
      if (!isModeAvailable(nextMode)) return;
      if (sendingRef.current) {
        stopGeneration();
      }
      setMode(nextMode);
      void updateExistingChatSettings({ mode: nextMode }).catch(() => {});
    };

    window.addEventListener("ai-school:new-chat", handleNewChat);
    window.addEventListener("ai-school:toggle-settings", handleSettings);
    window.addEventListener("ai-school:set-mode", handleSetMode);
    return () => {
      window.removeEventListener("ai-school:new-chat", handleNewChat);
      window.removeEventListener("ai-school:toggle-settings", handleSettings);
      window.removeEventListener("ai-school:set-mode", handleSetMode);
    };
  }, [selectedAgentId, startNewChat, updateExistingChatSettings]);

  useEffect(() => {
    const handleContextRequest = () => {
      window.dispatchEvent(
        new CustomEvent("ai-school:chat-context-response", {
          detail: {
            chatId: selectedChatId,
            lastMessage: messages.length > 0 ? messages[messages.length - 1].content : undefined,
            activeMode: mode,
            activeModel: activeCollaborators.length > 0
              ? activeCollaborators[activeCollaborators.length - 1].model
              : (messages.length > 0 && messages[messages.length - 1].modelUsed)
                ? messages[messages.length - 1].modelUsed
                : undefined,
          },
        })
      );
    };
    window.addEventListener("ai-school:request-chat-context", handleContextRequest);
    return () => window.removeEventListener("ai-school:request-chat-context", handleContextRequest);
  }, [selectedChatId, messages, mode, activeCollaborators]);

  function pickBusyFallbackModel(exclude: string[]) {
    const blocked = new Set(exclude.map((item) => item.trim()).filter(Boolean));
    const spendingTier = userSpending?.tier ?? "normal";

    const eligible = models
      .filter((model) => model.modelId !== "openrouter/auto")
      .filter((model) => !blocked.has(model.modelId))
      .filter((model) =>
        spendingTier === "free_only"
          ? Boolean(model.isFree || model.modelId.includes(":free"))
          : spendingTier === "cheap_only"
            ? Boolean(model.isFree || (typeof model.inputCostPerM === "number" && model.inputCostPerM <= 3))
            : spendingTier === "expensive_blocked"
              ? model.modelId !== "openrouter/auto" && (typeof model.inputCostPerM !== "number" || model.inputCostPerM <= 12)
              : true,
      )
      .sort((a, b) => {
        const aFree = a.isFree || a.modelId.includes(":free");
        const bFree = b.isFree || b.modelId.includes(":free");
        if (aFree !== bFree) return aFree ? -1 : 1;
        const aCost = typeof a.inputCostPerM === "number" ? a.inputCostPerM : Number.MAX_SAFE_INTEGER;
        const bCost = typeof b.inputCostPerM === "number" ? b.inputCostPerM : Number.MAX_SAFE_INTEGER;
        if (aCost !== bCost) return aCost - bCost;
        return a.name.localeCompare(b.name);
      });

    return eligible[0]?.modelId;
  }

  async function createChatIfNeeded(chatIdOverride?: string, modeOverride?: StudyMode) {
    if (chatIdOverride) {
      markChatActive(chatIdOverride);
      return chatIdOverride;
    }

    const currentChatId = selectedChatIdRef.current;
    if (currentChatId) {
      markChatActive(currentChatId);
      return currentChatId;
    }
    const requestedMode = modeOverride ?? mode;

    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: selectedAgentId,
        mode: requestedMode,
        thinkingLevel,
        routerMode,
        manualModel: routerMode === "manual" ? manualModel : undefined,
        usePersonalResources,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { chatId: string };

    const newChat: Chat = {
      _id: data.chatId,
      title: "New chat",
      mode: requestedMode,
      agentId: selectedAgentId,
      updatedAt: Date.now(),
    };

    selectedChatIdRef.current = data.chatId;
    setSelectedChatId(data.chatId);
    markChatActive(data.chatId);
    syncChatIdToUrl(data.chatId);
    sidebar.addChat(newChat);
    return data.chatId;
  }

  async function handleDeleteChat(chatId: string) {
    try {
      await sidebar.deleteChat(chatId);
    } catch {
      toast.error("Failed to delete chat");
      return;
    }
    if (selectedChatId === chatId) {
      startNewChat(selectedAgentId);
    }
  }

  async function renameChat(chatId: string, title: string) {
    const clean = title.trim();
    if (!clean) return;
    try {
      await sidebar.renameChat(chatId, clean);
    } catch {
      toast.error("Failed to rename chat");
    }
  }

  function stopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      // Clear active stream for current chat
      const currentStreamChat = streamChatIdRef.current;
      if (currentStreamChat) {
        activeStreamsRef.current.delete(currentStreamChat);
        setActiveStreamIds(prev => { const next = new Set(prev); next.delete(currentStreamChat); return next; });
      }
      setStreamPhase("idle");
      setCollaboratorPhase("idle");
    }
  }

  function pinChat(chatId: string) {
    sidebar.pinChat(chatId);
  }

  async function sendMessage(override?: string, options?: SendMessageOptions) {
    const text = (override ?? message).trim();
    const retryAttempt = options?.retryAttempt ?? 0;
    if (!text) return;
    const targetChatId = options?.chatIdOverride || selectedChatIdRef.current || "";
    if (activeStreamIds.has(targetChatId) && retryAttempt === 0) return;
    const preservedText = options?.preservedText ?? text;
    const preservedFiles = options?.preservedFiles ?? [...fileList];
    const outgoingFiles = retryAttempt > 0 && options?.preservedFiles ? options.preservedFiles : [...fileList];
    const requestedMode = options?.modeOverride ?? mode;
    const requestedRouterMode = options?.routerModeOverride ?? routerMode;
    const requestedManualModel = options?.manualModelOverride ?? manualModel;
    const localUserMessageId = options?.localUserMessageId ?? `local-${Date.now()}`;
    const attachedFileNames = outgoingFiles.map((file) => file.name);
    const isRegenerate = Boolean(options?.regenerate);
    const skipLocalUser = Boolean(options?.skipLocalUser);
    const skipServerUserPersist = Boolean(options?.skipServerUserPersist);
    const effectiveRouterMode = requestedRouterMode;
    const effectiveManualModel = requestedManualModel;
    const messageCountBeforeSend = messages.filter((item) => item.role !== "system").length;

    // Capture which chat this stream belongs to
    const streamChatId = selectedChatIdRef.current || options?.chatIdOverride || "";
    streamChatIdRef.current = streamChatId;
    // Per-chat streaming state is managed via activeStreamIds
    setDraftResponses(prev => { const next = new Map(prev); next.delete(streamChatId || ""); return next; });
    setDraftThinkings(prev => { const next = new Map(prev); next.delete(streamChatId || ""); return next; });
    setHasRealThinking(false);
    setActiveCollaborators([]);
    setCollaboratorPhase("idle");
    setStreamPhase("idle");
    setLivePhasePlan([]);
    setSearchStatusBanner(null);
    setStreamError(null);
    setSearch("");
    if (retryAttempt === 0) {
      setMessage("");
      // Clear draft from localStorage when message is sent
      if (targetChatId) {
        clearDraft(targetChatId);
      }
      if (!options?.regenerate) {
        setFileList([]);
        setFileUploadState({});
      }
    }

    abortControllerRef.current = new AbortController();
    let activeChatId = options?.chatIdOverride;
    let chatOnlyResourceIds: string[] = [];

    try {
      if (!skipLocalUser) {
        const initialPreviews = outgoingFiles.map((file) => {
          const key = fileKey(file);
          const existingThumbnail = fileUploadState[key]?.thumbnailUrl;
          return {
            name: file.name,
            mimeType: file.type || undefined,
            isImage: file.type.startsWith("image/"),
            thumbnailUrl: existingThumbnail,
          };
        });
        const userMessage: Message = {
          _id: localUserMessageId,
          role: "user",
          content: text,
          createdAt: Date.now(),
          attachments: attachedFileNames,
          attachmentPreviews: initialPreviews.length > 0 ? initialPreviews : undefined,
        };
        pendingLocalUserMessageIdsRef.current.add(localUserMessageId);
        pendingLocalUserMessagesRef.current.set(localUserMessageId, userMessage);
        pendingLocalUserMessageChatIdsRef.current.set(localUserMessageId, targetChatId);
        setMessages((prev) => [...prev, userMessage]);
      }

      const chatId = await createChatIfNeeded(options?.chatIdOverride, requestedMode);
      activeChatId = chatId;
      markChatActive(chatId);
      pendingLocalUserMessageChatIdsRef.current.set(localUserMessageId, chatId);
      streamChatIdRef.current = chatId;
      activeStreamsRef.current.add(chatId);
      setActiveStreamIds(prev => { const next = new Set(prev); next.add(chatId); return next; });
      const shouldAutoCompact =
        retryAttempt === 0 &&
        !isRegenerate &&
        ((autoCompaction === "on") ||
          (autoCompaction === "auto" && messageCountBeforeSend >= AUTO_COMPACTION_MIN_MESSAGES));
      if (shouldAutoCompact) {
        setStreamPhase("compacting");
        await runCompaction({
          chatId,
          keepLatestMessages: AUTO_COMPACTION_KEEP_LATEST,
          silent: true,
          showSuccessToast: false,
        });
        if (autoCompaction === "on") {
          setAutoCompaction("auto");
        }
      }
      let uploadedResourceIds: string[] = [];

      const attachmentPreviews = await Promise.all(
        outgoingFiles.map(async (file) => {
          const key = fileKey(file);
          const isImage = file.type.startsWith("image/");
          const existingThumbnail = fileUploadState[key]?.thumbnailUrl;
          const thumbnailUrl = isImage
            ? existingThumbnail ?? (await buildImageThumbnail(file))
            : undefined;
          return {
            name: file.name,
            mimeType: file.type || undefined,
            isImage,
            thumbnailUrl,
          };
        }),
      );

      if (!skipLocalUser && attachmentPreviews.length > 0) {
        const existingLocalMessage = pendingLocalUserMessagesRef.current.get(localUserMessageId);
        pendingLocalUserMessagesRef.current.set(localUserMessageId, {
          _id: localUserMessageId,
          role: "user",
          content: text,
          createdAt: existingLocalMessage?.createdAt ?? Date.now(),
          attachments: attachedFileNames,
          attachmentPreviews,
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === localUserMessageId
              ? {
                  ...msg,
                  attachmentPreviews,
                }
              : msg,
          ),
        );
      }

      if (attachmentPreviews.length > 0) {
        const previewKey = outgoingFiles.map((f) => f.name).sort().join("|");
        lastAttachmentPreviewsRef.current.set(previewKey, attachmentPreviews);
      }

      if (outgoingFiles.length > 0 && !isRegenerate) {
        setFileUploadState((prev) => {
          const next = { ...prev };
          for (const file of outgoingFiles) {
            const key = fileKey(file);
            const current = next[key] ?? {};
            next[key] = { ...current, status: "uploading", error: undefined };
          }
          return next;
        });

        const uploadResult = await uploadComposerFiles(outgoingFiles, selectedAgentId, {
          saveToLibrary: autoSaveConversationFilesToLibrary,
        });
        uploadedResourceIds = uploadResult.resourceIds ?? [];
        chatOnlyResourceIds = uploadResult.chatOnlyResourceIds ?? [];
        const resultByFile = new Map((uploadResult.results ?? []).map((result) => [result.file, result]));
        setFileUploadState((prev) => {
          const next = { ...prev };
          for (const file of outgoingFiles) {
            const key = fileKey(file);
            const current = next[key] ?? {};
            const result = resultByFile.get(file.name);
            next[key] = {
              ...current,
              status: toClientFileStatus(result?.status as "uploaded" | "processed" | "failed" | "reused" | undefined),
              error:
                result?.status === "failed"
                  ? result?.error
                  : result?.savedToLibrary === false
                    ? result?.error ?? "Attached for this chat only (not saved in My Files)."
                    : undefined,
            };
          }
          return next;
        });
        if (chatOnlyResourceIds.length > 0) {
          toast.warning(
            `${chatOnlyResourceIds.length} file${chatOnlyResourceIds.length === 1 ? "" : "s"} attached for this chat only. Personal library limit reached.`,
          );
        }
      }

      setStreamPhase("routing");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          agentId: selectedAgentId,
          mode: requestedMode,
          message: text,
          thinkingLevel,
          routerMode: effectiveRouterMode,
          manualModel: effectiveRouterMode === "manual" ? effectiveManualModel : undefined,
          imageModel: requestedMode === "image" ? imageModel : undefined,
          usePersonalResources,
          regenerate: isRegenerate,
          retryAttempt,
          skipUserMessagePersist: !isRegenerate && skipServerUserPersist,
          forcedModel: options?.forcedModelOverride,
          attachmentTypes: outgoingFiles.map((file) => ext(file.name)).filter(Boolean),
          attachmentResourceIds: uploadedResourceIds,
          autoSettings: {
            enhancePrompt: autoEnhancePrompt !== "off",
            autoModel,
            autoThinking: autoThinking !== "off",
            autoSearch: autoSearch !== "off",
            enhanceMode: autoEnhancePrompt,
            thinkingMode: autoThinking,
            searchMode: autoSearch,
          },
          toolPreferences: {
            memoryEnabled: readStoredToggle(MEMORY_ENABLED_KEY, true),
            searxngEnabled: readStoredToggle(SEARXNG_ENABLED_KEY, true),
          },
          clientMessageId: !isRegenerate ? localUserMessageId : undefined,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        let normalizedError = errorText;
        try {
          const parsed = JSON.parse(errorText) as { error?: { message?: string }; message?: string };
          normalizedError = parsed.error?.message ?? parsed.message ?? errorText;
        } catch {
          // Keep plain text error.
        }
        throw new Error(normalizedError || "Failed to send message");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantBuffer = "";
      let finalMeta: {
        messageId?: string;
        userMessageId?: string;
        modelUsed?: string;
        modelRequested?: string;
        attachments?: string[];
        attachmentResourceIds?: string[];
        whyThisResponse?: string;
        citations?: Citation[];
        routeTrace?: RouteTrace;
        usageIn?: number;
        usageOut?: number;
        thinkingContent?: string;
      } = {};
      let enhancedPrompt: string | undefined;
      let bufferState = createBufferState(requestedMode);
      let thinkingBuffer = "";
      let hasModelThinking = false;
      let orchestrationNotes: string[] = [];

      const buildThinkingContent = () => {
        const sections: string[] = [];
        const modelSection = thinkingBuffer.trim();
        if (modelSection) sections.push(modelSection);
        if (orchestrationNotes.length > 0) {
          sections.push(`Planner notes\n${orchestrationNotes.map((note) => `- ${note}`).join("\n")}`);
        }
        return sections.join("\n\n").trim();
      };

      const syncDraftThinking = () => {
        const composed = buildThinkingContent();
        setDraftThinkings((prev) => {
          if (!composed) {
            if (!prev.has(chatId)) return prev;
            const next = new Map(prev);
            next.delete(chatId);
            return next;
          }
          if (prev.get(chatId) === composed) return prev;
          const next = new Map(prev);
          next.set(chatId, composed);
          return next;
        });
      };

      const pushThinkingNote = (note: string) => {
        const clean = note.replace(/\s+/g, " ").trim();
        if (!clean) return;
        orchestrationNotes = [...orchestrationNotes.filter((item) => item !== clean), clean].slice(-10);
        setHasRealThinking(true);
        syncDraftThinking();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const payload = JSON.parse(line) as {
            type:
              | "delta"
              | "thinking"
              | "done"
              | "error"
              | "mode_update"
              | "route_model"
              | "collab_start"
              | "collab_progress"
              | "collab_done"
              | "collab_synthesizing"
              | "chat_title"
              | "notice"
              | "rag_used"
              | "soul_update"
              | "agent_summoned"
              | "phase"
              | "phase_update"
              | "search_status";
            content?: string;
            message?: string;
            error?: string | { message?: string };
            modelUsed?: string;
            modelRequested?: string;
            whyThisResponse?: string;
            citations?: Citation[];
            attachments?: string[];
            attachmentResourceIds?: string[];
            messageId?: string;
            userMessageId?: string;
            usageIn?: number;
            usageOut?: number;
            thinkingContent?: string;
            spendingUpdate?: UserSpending;
            autoResult?: {
              modelUsed?: string;
              searchEnabled: boolean;
              thinkingLevel: ThinkingLevel;
              promptEnhanced: boolean;
            };
            enhancedPrompt?: string;
            routeTrace?: RouteTrace;
            chatTitle?: string;
            suggestedMode?: string;
            agents?: string[];
            agent?: string;
            preview?: string;
            tokensUsed?: number;
            model?: string;
            reason?: string;
            phase?: StreamPhase;
            phaseId?: string;
            detail?: string;
            phasePlan?: Array<{
              id: string;
              label: string;
              status: "planned" | "running" | "completed" | "skipped" | "failed" | "in_progress";
              detail?: string;
              model?: string;
              thinkingLevel?: ThinkingLevel;
              startedAt?: number;
              finishedAt?: number;
            }>;
            status?: "pending" | "running" | "done" | "failed" | "skipped" | "planned" | "in_progress" | "completed";
            searchStatus?: "model_fallback" | "real_search" | "error";
            agentSuggestion?: AgentSuggestion;
            unlockedAchievements?: AchievementToastData[];
            sources?: Array<{ filename: string; page?: number; sourceType: string }>;
            entries?: Array<{ key: string; value: string; confidence: number }>;
          };

          // Guard: only update visual draft state if user is still viewing this chat
          const isViewingStreamChat = selectedChatIdRef.current === chatId;

          if (payload.type === "delta" && payload.content) {
            setStreamPhase("generating");
            assistantBuffer += payload.content;
            const targetChatId = chatId;
            if (bufferState.mode !== "none") {
              bufferState = appendToBuffer(bufferState, assistantBuffer);
              setDraftResponses(prev => {
                if (prev.get(targetChatId) === bufferState.safeContent) return prev;
                const next = new Map(prev);
                next.set(targetChatId, bufferState.safeContent);
                return next;
              });
            } else {
              setDraftResponses(prev => {
                const newContent = (prev.get(targetChatId) ?? "") + payload.content;
                if (prev.get(targetChatId) === newContent) return prev;
                const next = new Map(prev);
                next.set(targetChatId, newContent);
                return next;
              });
            }
          }

          if (payload.type === "thinking" && payload.content?.trim()) {
            setStreamPhase("thinking");
            if (!hasModelThinking) {
              thinkingBuffer = payload.content;
              hasModelThinking = true;
            } else {
              thinkingBuffer += payload.content;
            }
            setHasRealThinking(true);
            syncDraftThinking();
          }

          if (payload.type === "collab_start") {
            setStreamPhase("routing");
            const agents = payload.agents ?? [];
            if (agents.length > 0) {
              pushThinkingNote(
                `Delegating specialist work to ${agents.map((agent) => agent.replace(/_/g, " ")).join(", ")}.`,
              );
            }
            if (isViewingStreamChat) {
              setActiveCollaborators(
                agents.map((role) => ({
                  role,
                  status: "pending",
                })),
              );
              if (agents.length > 0) {
                setCollaboratorPhase("running");
              }
            }
          }

          if (payload.type === "collab_progress" && payload.agent) {
            const agentRole = payload.agent;
            const collaboratorStatus =
              payload.status === "pending"
              || payload.status === "running"
              || payload.status === "done"
              || payload.status === "failed"
              || payload.status === "skipped"
                ? payload.status
                : "running";
            pushThinkingNote(
              `${agentRole.replace(/_/g, " ")} ${collaboratorStatus === "done" ? "completed" : "is running"}${
                payload.model ? ` with ${payload.model}` : ""
              }${payload.preview ? `: ${payload.preview}` : ""}`,
            );
            if (isViewingStreamChat) {
              setCollaboratorPhase("running");
              setActiveCollaborators((prev) => {
                const has = prev.some((item) => item.role === agentRole);
                if (!has) {
                  return [
                    ...prev,
                    {
                      role: agentRole,
                      status: collaboratorStatus,
                      model: payload.model,
                      preview: payload.preview,
                    },
                  ];
                }
                return prev.map((item) =>
                  item.role === agentRole
                    ? {
                        ...item,
                        status: collaboratorStatus,
                        model: payload.model ?? item.model,
                        preview: payload.preview ?? item.preview,
                      }
                    : item,
                );
              });
            }
          }

          if (payload.type === "collab_done" && payload.agent) {
            const agentRole = payload.agent;
            pushThinkingNote(
              `${agentRole.replace(/_/g, " ")} finished${payload.model ? ` on ${payload.model}` : ""}${
                payload.preview ? `: ${payload.preview}` : ""
              }`,
            );
            if (isViewingStreamChat) {
              setActiveCollaborators((prev) =>
                prev.map((item) =>
                  item.role === agentRole
                    ? {
                        ...item,
                        status: "done",
                        model: payload.model ?? item.model,
                        preview: payload.preview ?? item.preview,
                        tokensUsed: payload.tokensUsed ?? item.tokensUsed,
                      }
                    : item,
                ),
              );
            }
          }

          if (payload.type === "collab_synthesizing") {
            setStreamPhase("synthesizing");
            pushThinkingNote("Synthesizing specialist outputs into one final response.");
            if (isViewingStreamChat) {
              setCollaboratorPhase("synthesizing");
            }
          }

          if (payload.type === "mode_update" && payload.suggestedMode) {
            const nextMode = payload.suggestedMode as StudyMode;
            if (isModeAvailable(nextMode)) {
              setMode(nextMode);
              void updateChatSettingsById(chatId, { mode: nextMode }).catch(() => {});
            }
          }

          if (payload.type === "route_model" && payload.modelUsed) {
            setLastAutoResult((prev) => ({
              modelUsed: payload.modelUsed,
              searchEnabled: prev?.searchEnabled ?? false,
              thinkingLevel: prev?.thinkingLevel ?? thinkingLevel,
              promptEnhanced: prev?.promptEnhanced ?? false,
            }));
          }

          if (payload.type === "search_status") {
            const status = payload.searchStatus ?? payload.status;
            if (status === "model_fallback") {
              setSearchStatusBanner("model_knowledge");
              pushThinkingNote("Web search was unavailable. Response used model knowledge fallback.");
            } else if (status === "real_search") {
              setSearchStatusBanner("real_search");
            } else if (status === "error") {
              setSearchStatusBanner("error");
            }
          }

          if (payload.type === "phase_update") {
            if (Array.isArray(payload.phasePlan) && payload.phasePlan.length > 0) {
              const normalized = payload.phasePlan.map((phase) => ({
                ...phase,
                status: normalizePhaseStatus(phase.status),
              }));
              setLivePhasePlan(normalized);
            } else if (payload.phaseId) {
              const normalizedStatus = normalizePhaseStatus(payload.status);
              setLivePhasePlan((prev) => {
                const existingIndex = prev.findIndex((phase) => phase.id === payload.phaseId);
                if (existingIndex < 0) {
                  return [
                    ...prev,
                    {
                      id: payload.phaseId!,
                      label: payload.phaseId!,
                      status: normalizedStatus,
                      detail: payload.detail,
                    },
                  ];
                }
                const next = [...prev];
                next[existingIndex] = {
                  ...next[existingIndex],
                  status: normalizedStatus,
                  detail: payload.detail ?? next[existingIndex].detail,
                };
                return next;
              });
            }

            const nextPhase = streamPhaseFromPhaseId(payload.phaseId);
            if ((payload.status === "in_progress" || payload.status === "running") && nextPhase) {
              setStreamPhase(nextPhase);
            }
          }

          if (payload.type === "phase" && payload.phase) {
            setStreamPhase(payload.phase);
          }

          if (payload.type === "done") {
            if (typeof payload.content === "string" && payload.content.trim()) {
              assistantBuffer = payload.content;
              if (bufferState.mode !== "none") {
                bufferState = appendToBuffer(bufferState, assistantBuffer);
                setDraftResponses(prev => {
                  if (prev.get(chatId) === bufferState.safeContent) return prev;
                  const next = new Map(prev);
                  next.set(chatId, bufferState.safeContent);
                  return next;
                });
              } else {
                setDraftResponses(prev => {
                  if (prev.get(chatId) === payload.content) return prev;
                  const next = new Map(prev);
                  next.set(chatId, payload.content!);
                  return next;
                });
              }
            }
            const actualModel =
              payload.modelUsed && payload.modelUsed !== "openrouter/auto"
                ? payload.modelUsed
                : payload.modelRequested ?? payload.modelUsed;

            const normalizedTrace =
              payload.routeTrace && payload.modelUsed === "openrouter/auto"
                ? {
                    ...payload.routeTrace,
                    toolchain: [...payload.routeTrace.toolchain, "openrouter_auto_unresolved_model"],
                    selected: {
                      ...payload.routeTrace.selected,
                      reason: `${payload.routeTrace.selected.reason} (delegated model not reported by provider)`,
                    },
                  }
                : payload.routeTrace;
            if (normalizedTrace?.phasePlan?.length) {
              setLivePhasePlan(normalizedTrace.phasePlan);
            }

            const nextFinalMeta: typeof finalMeta = {
              messageId: payload.messageId,
              userMessageId: payload.userMessageId,
              modelUsed: actualModel,
              modelRequested: payload.modelRequested,
              attachments: Array.isArray(payload.attachments) ? payload.attachments : undefined,
              attachmentResourceIds: Array.isArray(payload.attachmentResourceIds) ? payload.attachmentResourceIds : undefined,
              whyThisResponse: payload.whyThisResponse,
              citations: payload.citations,
              routeTrace: normalizedTrace,
              usageIn: payload.usageIn,
              usageOut: payload.usageOut,
              thinkingContent: payload.thinkingContent ?? (buildThinkingContent() || undefined),
            };
            finalMeta = nextFinalMeta;

            if (payload.spendingUpdate) {
              setUserSpending(payload.spendingUpdate);
            }
            if (payload.autoResult) {
              setLastAutoResult(payload.autoResult);
              if (payload.autoResult.searchEnabled) {
                setStreamPhase("searching");
              }
            }
            if (typeof payload.enhancedPrompt === "string" && payload.enhancedPrompt.trim()) {
              enhancedPrompt = payload.enhancedPrompt;
            }
            if (typeof payload.chatTitle === "string" && payload.chatTitle.trim()) {
              const nextTitle = payload.chatTitle.trim();
              setChats((prev) =>
                prev.map((chat) => (chat._id === chatId ? { ...chat, title: nextTitle } : chat)),
              );
            }
            if (payload.agentSuggestion && !selectedAgentId) {
              setAgentSuggestion(payload.agentSuggestion);
            } else if (!selectedAgentId) {
              setAgentSuggestion(null);
            }
            if (payload.suggestedMode && payload.suggestedMode !== requestedMode) {
              setMode(payload.suggestedMode as StudyMode);
              // Use the stream's chatId, not selectedChatId, to avoid updating wrong chat
              void updateChatSettingsById(chatId, { mode: payload.suggestedMode as StudyMode }).catch(() => {});
            }
            if (payload.unlockedAchievements?.length) {
              for (const achievement of payload.unlockedAchievements) {
                const toastKey = `${achievement.type}:${achievement.earnedAt}`;
                if (shownAchievementToastsRef.current.has(toastKey)) continue;
                shownAchievementToastsRef.current.add(toastKey);
                toast.custom((toastId) => createElement(AchievementToast, {
                  achievement,
                  onDismiss: () => toast.dismiss(toastId),
                }), {
                  duration: 7000,
                });
              }
            }
            setCollaboratorPhase("idle");
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event("ai-school:refresh-gamification"));
            }
          }

          if (payload.type === "chat_title" && typeof payload.chatTitle === "string" && payload.chatTitle.trim()) {
            const nextTitle = payload.chatTitle.trim();
            setChats((prev) =>
              prev.map((chat) => (chat._id === chatId ? { ...chat, title: nextTitle } : chat)),
            );
          }

          if (payload.type === "notice" && typeof payload.message === "string" && payload.message.trim()) {
            pushThinkingNote(payload.message.trim());
          }

          if (payload.type === "rag_used" && payload.sources?.length) {
            pushThinkingNote(
              `Referenced ${payload.sources.length} personal or school source${
                payload.sources.length === 1 ? "" : "s"
              }: ${payload.sources
                .slice(0, 3)
                .map((source) => source.filename)
                .join(", ")}.`,
            );
          }

          if (payload.type === "soul_update" && payload.entries?.length) {
            pushThinkingNote(`Updated personal memory: ${payload.entries[0]?.key ?? "profile"}.`);
          }

          if (payload.type === "agent_summoned" && payload.agent && payload.model) {
            pushThinkingNote(`Called specialist ${payload.agent.replace(/_/g, " ")} on ${payload.model}.`);
          }

          if (payload.type === "error") {
            const messageFromPayload =
              typeof payload.error === "string" ? payload.error : payload.error?.message ?? "Chat stream failed";
            throw new Error(messageFromPayload);
          }
        }
      }

      const persistedUserMessageId = finalMeta.userMessageId;
      if (persistedUserMessageId) {
        setMessages((prev) => {
          if (!prev.some((item) => item._id === localUserMessageId)) return prev;

          let changed = false;
          const next: Message[] = [];
          for (const item of prev) {
            if (item._id !== localUserMessageId) {
              next.push(item);
              continue;
            }
            changed = true;
            if (next.some((existing) => existing._id === persistedUserMessageId)) continue;
            next.push({
              ...item,
              _id: persistedUserMessageId,
            });
          }
          return changed ? next : prev;
        });
        pendingLocalUserMessageIdsRef.current.delete(localUserMessageId);
        pendingLocalUserMessagesRef.current.delete(localUserMessageId);
        pendingLocalUserMessageChatIdsRef.current.delete(localUserMessageId);
      }

      if (assistantBuffer) {
        const { userMessageId: _ignoredUserMessageId, ...assistantMeta } = finalMeta;
        void _ignoredUserMessageId;
        const assistantMessage: Message = {
          _id: finalMeta.messageId ?? `assistant-${Date.now()}`,
          role: "assistant",
          content: assistantBuffer,
          createdAt: Date.now(),
          ...assistantMeta,
        };

        const stillViewingStreamChat = selectedChatIdRef.current === chatId;

        if (stillViewingStreamChat) {
          if (enhancedPrompt) {
            setMessages((prev) => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i -= 1) {
                const candidate = updated[i];
                if (candidate?.role === "user") {
                  updated[i] = {
                    ...candidate,
                    enhancedContent: enhancedPrompt,
                  };
                  break;
                }
              }
              return updated;
            });
          }
          setMessages((prev) => [...prev, assistantMessage]);
        } else {
          // User navigated away - store for later merge
          const existing = pendingCompletionsRef.current.get(chatId) ?? [];
          existing.push(assistantMessage);
          pendingCompletionsRef.current.set(chatId, existing);

          // Find the chat title for the toast
          const chatTitle = chats.find((c) => c._id === chatId)?.title ?? "a chat";
          toast.info(`Response ready in "${chatTitle}"`);
        }
      }

      setDraftResponses(prev => { const next = new Map(prev); next.delete(chatId); return next; });
      setDraftThinkings(prev => { const next = new Map(prev); next.delete(chatId); return next; });
      setHasRealThinking(false);
      setLastFailedMessage(null);
      setChats((prev) =>
        prev.map((chat) =>
          chat._id === chatId
            ? {
                ...chat,
                updatedAt: Date.now(),
                title: chat.title,
                mode: requestedMode,
                agentId: selectedAgentId,
              }
            : chat,
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      if (outgoingFiles.length > 0) {
        setFileUploadState((prev) => {
          const next = { ...prev };
          for (const file of outgoingFiles) {
            const key = fileKey(file);
            const current = next[key];
            if (!current) continue;
            if (current.status === "uploading") {
              next[key] = { ...current, status: "error", error: "Upload failed" };
            }
          }
          return next;
        });
      }
      const message = error instanceof Error ? error.message : "Failed to send message";
      const isBusyError = /429|busy|rate/i.test(message);
      const allowBusyFallback = requestedRouterMode !== "manual";
      if (isBusyError && allowBusyFallback) {
        const attemptedModels = [
          ...(options?.attemptedModels ?? []),
          options?.forcedModelOverride,
          options?.manualModelOverride,
          requestedManualModel,
          lastAutoResult?.modelUsed,
        ].filter((value): value is string => Boolean(value && value.trim()));
        const backupModel =
          pickBusyFallbackModel(attemptedModels) ||
          (!attemptedModels.includes("openrouter/auto") ? "openrouter/auto" : undefined);
        const switchingModel = Boolean(backupModel) && options?.forcedModelOverride !== backupModel;
        const canRetryWithNewModel = Boolean(switchingModel && backupModel);
        const maxBusyRetries = Math.max(
          2,
          Math.min(5, models.filter((model) => model.modelId !== "openrouter/auto").length),
        );

        if (canRetryWithNewModel && retryAttempt < maxBusyRetries) {
          abortControllerRef.current = null;
          await new Promise((resolve) => setTimeout(resolve, 900 + retryAttempt * 500));
          return await sendMessage(override ?? text, {
            regenerate: options?.regenerate,
            skipLocalUser: true,
            skipServerUserPersist,
            retryAttempt: retryAttempt + 1,
            chatIdOverride: activeChatId,
            modeOverride: requestedMode,
            routerModeOverride: requestedRouterMode,
            manualModelOverride: requestedManualModel,
            forcedModelOverride: backupModel,
            attemptedModels,
            preservedText,
            preservedFiles,
            localUserMessageId,
          });
        }
      }
      setMessages((prev) => prev.filter((item) => item._id !== localUserMessageId));
      pendingLocalUserMessageIdsRef.current.delete(localUserMessageId);
      pendingLocalUserMessagesRef.current.delete(localUserMessageId);
      pendingLocalUserMessageChatIdsRef.current.delete(localUserMessageId);
      setMessage(preservedText);
      setFileList(preservedFiles);
      setFileUploadState({});
      setStreamError(message);
      setDraftResponses(prev => { const next = new Map(prev); next.delete(activeChatId ?? ""); return next; });
      setDraftThinkings(prev => { const next = new Map(prev); next.delete(activeChatId ?? ""); return next; });
      setHasRealThinking(false);
      setLastFailedMessage(preservedText);
    } finally {
      if (activeChatId) {
        activeStreamsRef.current.delete(activeChatId);
        setActiveStreamIds(prev => { const next = new Set(prev); next.delete(activeChatId!); return next; });
      }
      setActiveCollaborators([]);
      setCollaboratorPhase("idle");
      setStreamPhase("idle");
      setHasRealThinking(false);
      abortControllerRef.current = null;
    }
  }

  async function retryLastMessage() {
    if (!lastFailedMessage) return;
    await sendMessage(lastFailedMessage, {
      retryAttempt: 0,
      skipLocalUser: false,
      skipServerUserPersist: false,
    });
  }

  async function regenerateLastResponse() {
    const lastUser = [...messages].reverse().find((item) => item.role === "user");
    if (!lastUser || sending) return;

    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i]?.role === "assistant") {
          next.splice(i, 1);
          break;
        }
      }
      return next;
    });

    await sendMessage(lastUser.content, {
      regenerate: true,
      skipLocalUser: true,
      retryAttempt: 0,
    });
  }

  async function submitQuizAnswers(payload: {
    messageId: string;
    result: {
      score: number;
      total: number;
      questions: Array<{
        id: string;
        prompt: string;
        selected?: string;
        correct?: string;
        isCorrect: boolean;
        explanation?: string;
      }>;
      incorrectDetails: string[];
    };
  }) {
    if (!selectedChatId) return;
    try {
      await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: selectedChatId,
          messageId: payload.messageId,
          questions: payload.result.questions,
          score: payload.result.score,
          total: payload.result.total,
        }),
      });

      const scoreRatio = payload.result.total > 0 ? payload.result.score / payload.result.total : 0;
      const incorrectSummary =
        payload.result.incorrectDetails.length > 0
          ? payload.result.incorrectDetails.slice(0, 8).join("; ")
          : "None";

      let nextMode: StudyMode = mode;
      let followUpPrompt = "";
      let recommendationLabel = "";
      if (scoreRatio < 0.5) {
        nextMode = "tutor";
        recommendationLabel = "Learn mode recommendation ready";
        followUpPrompt = [
          `Student answered quiz. Score: ${payload.result.score}/${payload.result.total}.`,
          `Incorrect: ${incorrectSummary}.`,
          "Teach the missed concepts step-by-step in Learn mode, then generate 6 flashcards focused on weak areas, then end with a short 3-question checkpoint quiz.",
        ].join(" ");
      } else if (scoreRatio < 0.8) {
        nextMode = "flashcard";
        recommendationLabel = "Flashcard review recommendation ready";
        followUpPrompt = [
          `Student answered quiz. Score: ${payload.result.score}/${payload.result.total}.`,
          `Incorrect: ${incorrectSummary}.`,
          "Provide concise explanations for misses, then generate a targeted flashcard deck for the weak concepts.",
        ].join(" ");
      } else {
        nextMode = "quiz";
        recommendationLabel = "Challenge quiz suggestion ready";
        followUpPrompt = [
          `Student answered quiz. Score: ${payload.result.score}/${payload.result.total}.`,
          "Generate a slightly harder follow-up quiz on the same topic with short explanations only if I ask for it.",
        ].join(" ");
      }

      if (nextMode !== mode) {
        setMode(nextMode);
        void updateExistingChatSettings({ mode: nextMode }).catch(() => {});
      }
      setMessage(followUpPrompt);
      toast.success(`Quiz saved. ${recommendationLabel}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit quiz");
    }
  }

  async function saveFlashcardDeck(payload: {
    messageId: string;
    title: string;
    cards: Array<{ front: string; back: string; cardHash: string }>;
  }) {
    if (!selectedChatId) return;
    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_deck",
          chatId: selectedChatId,
          sourceMessageId: payload.messageId,
          title: payload.title,
          cards: payload.cards,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = (await response.json()) as { updated?: boolean; created?: boolean; appended?: number };
      if (result.updated) {
        if (typeof result.appended === "number" && result.appended > 0) {
          toast.success(`Added ${result.appended} new flashcard${result.appended === 1 ? "" : "s"}`);
        } else {
          toast.message("Flashcard deck updated");
        }
      } else {
        toast.success("Flashcard deck saved");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save deck");
    }
  }

  async function rateFlashcardCard(payload: { cardHash: string; quality: number }) {
    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rate_card",
          cardHash: payload.cardHash,
          quality: payload.quality,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rate card");
    }
  }

  async function editFlashcardCard(payload: { cardHash: string; front: string; back: string }) {
    if (!selectedChatId) return;
    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit_card",
          chatId: selectedChatId,
          cardHash: payload.cardHash,
          front: payload.front,
          back: payload.back,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      toast.success("Flashcard updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update flashcard");
    }
  }

  async function refreshPersonalResources() {
    const response = await fetch("/api/resources?scope=personal");
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { resources: PersonalResource[] };
    setPersonalResources(
      [...(data.resources ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    );
  }

  async function retryPendingPersonalResources(resourceIds: string[]) {
    if (resourceIds.length === 0) return;
    const response = await fetch("/api/personal-resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "retry_processing",
        resourceIds,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const payload = (await response.json()) as {
      ok?: boolean;
      retried?: number;
      failures?: Array<{ resourceId?: string; error?: string; reason?: string }>;
    };
    if (payload.ok === false) {
      const detail = (payload.failures ?? [])
        .map((failure) => failure.reason?.trim() || failure.error?.trim())
        .filter((value): value is string => Boolean(value))
        .join("; ");
      throw new Error(detail || "Some My Files retries failed");
    }
    lastPersonalRetryFailureRef.current = "";
  }

  async function deletePersonalResource(resourceId: string) {
    const response = await fetch("/api/resources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId }),
    });
    if (!response.ok) throw new Error(await response.text());
    await refreshPersonalResources();
  }

  async function uploadPersonalResources(files: File[]) {
    if (files.length === 0) return;
    const result = await uploadComposerFiles(files, undefined, {
      saveToLibrary: true,
    });
    await refreshPersonalResources();
    const uploadedCount = (result.results ?? []).filter((item) => item.status === "uploaded" || item.status === "reused").length;
    if (uploadedCount > 0) {
      window.setTimeout(() => {
        void refreshPersonalResources().catch(() => {});
      }, 2500);
      window.setTimeout(() => {
        void refreshPersonalResources().catch(() => {});
      }, 7000);
    }
    const failure = (result.results ?? []).find((item) => item.status === "failed");
    if (failure) {
      if (uploadedCount > 0) {
        throw new Error(`${uploadedCount} file(s) uploaded, but ${failure.file} failed: ${failure.error || "Unknown error"}`);
      }
      throw new Error(failure.error || `Failed to upload ${failure.file}`);
    }
  }

  async function runCompaction({
    chatId,
    keepLatestMessages,
    silent,
    showSuccessToast,
  }: {
    chatId: string;
    keepLatestMessages?: number;
    silent?: boolean;
    showSuccessToast?: boolean;
  }): Promise<"compacted" | "skipped" | "failed"> {
    if (!chatId || compactingConversation) return "skipped";
    setCompactingConversation(true);
    try {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          typeof keepLatestMessages === "number" && Number.isFinite(keepLatestMessages)
            ? { keepLatestMessages: Math.max(2, Math.min(20, Math.round(keepLatestMessages))) }
            : {},
        ),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as {
        ok?: boolean;
        reason?: string;
        compactedMessages?: number;
        currentMessages?: number;
        minimumMessages?: number;
      };

      if (!result.ok) {
        if (!silent) {
          if (result.reason === "not_enough_messages") {
            const minimum = Math.max(4, Math.round(result.minimumMessages ?? 20));
            const current = Math.max(0, Math.round(result.currentMessages ?? 0));
            toast.info(`Compaction works best after about ${minimum} messages (currently ${current}).`);
          } else {
            toast.info("Nothing to compact yet.");
          }
        }
        return "skipped";
      }

      if (showSuccessToast) {
        toast.success(`Conversation compacted (${result.compactedMessages ?? 0} messages summarized).`);
      }
      return "compacted";
    } catch (error) {
      if (!silent) {
        toast.error(error instanceof Error ? error.message : "Failed to compact conversation");
      }
      return "failed";
    } finally {
      setCompactingConversation(false);
    }
  }

  async function compactConversation(keepLatestMessages?: number) {
    if (!selectedChatId) {
      toast.info("Start a chat before running compaction.");
      return;
    }
    if (sending) {
      toast.info("Wait for the current response to finish before compacting.");
      return;
    }
    await runCompaction({
      chatId: selectedChatId,
      keepLatestMessages,
      silent: false,
      showSuccessToast: true,
    });
  }

  async function regenerateWithModel(modelId: string) {
    const lastUser = [...messages].reverse().find((item) => item.role === "user");
    if (!lastUser || sending) return;

    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i]?.role === "assistant") {
          next.splice(i, 1);
          break;
        }
      }
      return next;
    });

    await sendMessage(lastUser.content, {
      regenerate: true,
      skipLocalUser: true,
      retryAttempt: 0,
      forcedModelOverride: modelId,
    });
  }

  async function editAndResend(messageId: string, newContent: string) {
    if (!selectedChatId) return;
    const clean = newContent.trim();
    if (!clean || sending) return;

    const response = await fetch("/api/chats/messages/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, newContent: clean }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const reload = await fetch(`/api/chats/${selectedChatId}`);
    if (reload.ok) {
      const data = (await reload.json()) as ChatDetailResponse;
      setMessages(data.messages);
    }

    await sendMessage(clean, {
      skipLocalUser: true,
      skipServerUserPersist: true,
      chatIdOverride: selectedChatId,
      retryAttempt: 0,
    });
  }

  async function branchFromMessage(messageId: string) {
    const response = await fetch("/api/chats/messages/branch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = (await response.json()) as { chatId?: string };
    const branchChatId = data.chatId;
    if (!branchChatId) return;

    await sidebar.refreshBootstrap().catch(() => {});
    setSelectedChatId(branchChatId);
    markChatActive(branchChatId);
  }

  async function toggleBookmark(messageId: string) {
    const chatId = selectedChatIdRef.current;
    if (!chatId || !messageId || bookmarkingMessageId) return;

    const currentlyBookmarked = bookmarkedMessageIds.has(messageId);
    setBookmarkingMessageId(messageId);
    setBookmarkedMessageIds((prev) => {
      const next = new Set(prev);
      if (currentlyBookmarked) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

    try {
      const response = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, messageId }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as { bookmarked?: boolean };
      const isBookmarked = Boolean(result.bookmarked);
      setBookmarkedMessageIds((prev) => {
        const next = new Set(prev);
        if (isBookmarked) next.add(messageId);
        else next.delete(messageId);
        return next;
      });
      toast.success(isBookmarked ? "Message bookmarked" : "Bookmark removed");
    } catch (error) {
      setBookmarkedMessageIds((prev) => {
        const next = new Set(prev);
        if (currentlyBookmarked) next.add(messageId);
        else next.delete(messageId);
        return next;
      });
      toast.error(error instanceof Error ? error.message : "Failed to update bookmark");
    } finally {
      setBookmarkingMessageId(null);
    }
  }

  async function recordAssistantFeedback(params: {
    messageId: string;
    chatId?: string;
    modelId?: string;
    positive: boolean;
  }) {
    await fetch("/api/agents/model-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: params.chatId ?? selectedChatId,
        messageId: params.messageId,
        agentId: selectedAgentId,
        modelId: params.modelId,
        positive: params.positive,
      }),
    });
  }

  return {
    loading,
    sending,
    role,
    isSuperAdmin,
    chats,
    models,
    agents,
    personalResources,
    selectedChat,
    selectedAgent,
    selectedModel,
    selectedChatId,
    selectedAgentId,
    mode,
    routerMode,
    manualModel,
    thinkingLevel,
    usePersonalResources,
    autoSaveConversationFilesToLibrary,
    autoEnhancePrompt,
    autoModel,
    autoThinking,
    autoSearch,
    autoCompaction,
    userSpending,
    userMemorySummary,
    orgWelcomeMessage,
    orgLogoUrl,
    orgName,
    lastAutoResult,
    agentSuggestion,
    message,
    messages,
    draftResponse,
    draftThinking,
    hasRealThinking,
    streamPhase,
    livePhasePlan,
    searchStatusBanner,
    activeCollaborators,
    collaboratorPhase,
    activeStreamIds,
    fileList,
    fileUploadState,
    streamError,
    compactingConversation,
    bookmarkedMessageIds,
    bookmarkingMessageId,
    search,
    filteredChats,
    sidebarOpen,
    mobileSidebarOpen,
    settingsOpen,
    pinnedChatIds,
    setSelectedChatId,
    setSelectedAgentId,
    setMode,
    setRouterMode,
    setManualModel,
    setThinkingLevel,
    setUsePersonalResources,
    setAutoSaveConversationFilesToLibrary,
    setAutoEnhancePrompt,
    setAutoModel,
    setAutoThinking,
    setAutoSearch,
    setAutoCompaction,
    setAgentSuggestion,
    imageModel,
    setImageModel,
    setMessage,
    setFileList,
    setSearch,
    setSidebarOpen,
    setMobileSidebarOpen,
    setSettingsOpen,
    startNewChat,
    handleDeleteChat,
    renameChat,
    sendMessage,
    retryLastMessage,
    regenerateLastResponse,
    submitQuizAnswers,
    saveFlashcardDeck,
    rateFlashcardCard,
    editFlashcardCard,
    regenerateWithModel,
    editAndResend,
    branchFromMessage,
    toggleBookmark,
    recordAssistantFeedback,
    refreshBookmarks,
    refreshPersonalResources,
    deletePersonalResource,
    uploadPersonalResources,
    compactConversation,
    updateExistingChatSettings,
    stopGeneration,
    pinChat,
    hasDraft,
  };
}
