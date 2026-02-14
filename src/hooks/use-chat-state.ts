"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Agent, Citation, RouteTrace, RouterMode, StudyMode, ThinkingLevel } from "@/types";
import { appendToBuffer, createBufferState } from "@/lib/structured-stream-buffer";

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
  status: "pending" | "running" | "done" | "failed";
  model?: string;
  preview?: string;
  tokensUsed?: number;
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
};

export type FileStatus = "pending" | "uploading" | "ready" | "error";

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
};

export type PersonalResource = {
  _id: string;
  filename: string;
  mimeType: string;
  size: number;
  status: "uploaded" | "processed" | "failed";
  pinned?: boolean;
  createdAt: number;
};

export type UserSpending = {
  totalSpentEur: number;
  totalCostCents: number;
  tier: "normal" | "cheap_only" | "free_only";
  softLimitReached: boolean;
  hardLimitReached: boolean;
};

export type AutoPreference = "auto" | "on" | "off";

type BootstrapResponse = {
  actor: { role: "student" | "teacher" | "admin" };
  chats: Chat[];
  models: ModelOption[];
  agents: Agent[];
  orgSettings?: {
    org?: {
      name?: string;
      welcomeMessage?: string;
      primaryColor?: string;
      accentColor?: string;
      logoUrl?: string;
    };
  };
  userSpending: UserSpending;
  userMemory: {
    summary: string;
    updatedAt: number;
    entryCount: number;
  };
};

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
  routerModeOverride?: RouterMode;
  manualModelOverride?: string;
  forcedModelOverride?: string;
  attemptedModels?: string[];
  preservedText?: string;
  preservedFiles?: File[];
  localUserMessageId?: string;
};

function mergeFetchedMessages(fetched: Message[], local: Message[]) {
  const pendingLocalUsers = local.filter((item) => item.role === "user" && item._id.startsWith("local-"));
  if (pendingLocalUsers.length === 0) return fetched;

  const existingUserPayloads = new Set(
    fetched
      .filter((item) => item.role === "user")
      .map((item) => item.content.trim()),
  );

  const merged = [...fetched];
  for (const pending of pendingLocalUsers) {
    const key = pending.content.trim();
    if (!key || existingUserPayloads.has(key)) continue;
    merged.push(pending);
  }

  return merged;
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

type UploadResponse = {
  resourceIds?: string[];
  results?: Array<{ file: string; resourceId?: string; status: string; error?: string }>;
};

async function uploadComposerFiles(files: File[], agentId?: string): Promise<UploadResponse> {
  if (files.length === 0) return { resourceIds: [], results: [] };

  const formData = new FormData();
  formData.set("scope", "personal");
  if (agentId) {
    formData.set("agentId", agentId);
  }

  for (const file of files) {
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
    .replace(/\bfree\b/gi, "")
    .replace(/\s*&\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function mergeModels(catalog: ModelOption[], live: LiveModel[]) {
  const merged = new Map<string, ModelOption>();

  for (const model of catalog) {
    if (!model.modelId || isLocalProvider(model.provider) || isLocalProvider(model.modelId)) continue;
    merged.set(model.modelId, { ...model, name: sanitizeModelName(model.name) });
  }

  for (const model of live) {
    if (!model.id || isLocalProvider(model.provider) || isLocalProvider(model.id)) continue;
    const existing = merged.get(model.id);
    merged.set(model.id, {
      _id: existing?._id ?? model.id,
      modelId: model.id,
      name: sanitizeModelName(model.name || existing?.name || model.id),
      provider: model.provider || existing?.provider || "Unknown",
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
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [role, setRole] = useState<"student" | "teacher" | "admin">("student");

  const [chats, setChats] = useState<Chat[]>([]);
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

  const [autoEnhancePrompt, setAutoEnhancePrompt] = useState<AutoPreference>("auto");
  const [autoModel, setAutoModel] = useState(true);
  const [autoThinking, setAutoThinking] = useState<AutoPreference>("auto");
  const [autoSearch, setAutoSearch] = useState<AutoPreference>("auto");

  const [userSpending, setUserSpending] = useState<UserSpending | null>(null);
  const [userMemorySummary, setUserMemorySummary] = useState<string>("");
  const [orgWelcomeMessage, setOrgWelcomeMessage] = useState<string>("");
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | undefined>(undefined);
  const [orgName, setOrgName] = useState<string>("AI School");
  const [lastAutoResult, setLastAutoResult] = useState<{
    modelUsed?: string;
    searchEnabled: boolean;
    thinkingLevel: ThinkingLevel;
    promptEnhanced: boolean;
  } | null>(null);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftResponse, setDraftResponse] = useState("");
  const [draftThinking, setDraftThinking] = useState("");
  const [activeCollaborators, setActiveCollaborators] = useState<ActiveCollaboratorState[]>([]);
  const [collaboratorPhase, setCollaboratorPhase] = useState<"idle" | "running" | "synthesizing">("idle");
  const [fileList, setFileList] = useState<File[]>([]);
  const [fileUploadState, setFileUploadState] = useState<
    Record<string, { status: FileStatus; thumbnailUrl?: string; error?: string }>
  >({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchHits, setSearchHits] = useState<ChatSearchHit[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set());

  const abortControllerRef = useRef<AbortController | null>(null);
  const selectedChatIdRef = useRef("");

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

  const loadBootstrap = useCallback(async () => {
    const [bootstrapRes, liveRes, resourceRes] = await Promise.all([
      fetch("/api/bootstrap"),
      fetch("/api/models/live").catch(() => null),
      fetch("/api/resources?scope=personal").catch(() => null),
    ]);
    if (!bootstrapRes.ok) {
      throw new Error(await bootstrapRes.text());
    }

    const data = (await bootstrapRes.json()) as BootstrapResponse;
    const liveData =
      liveRes && liveRes.ok
        ? ((await liveRes.json()) as { models: LiveModel[] })
        : { models: [] as LiveModel[] };
    const resourceData =
      resourceRes && resourceRes.ok
        ? ((await resourceRes.json()) as { resources: PersonalResource[] })
        : { resources: [] as PersonalResource[] };

    setRole(data.actor.role);
    setChats(data.chats);
    setModels(mergeModels(data.models, liveData.models));
    setAgents(data.agents);
    setPersonalResources(
      [...(resourceData.resources ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    );
    setUserSpending(data.userSpending);
    setUserMemorySummary(data.userMemory.summary);
    setOrgWelcomeMessage(data.orgSettings?.org?.welcomeMessage ?? "");
    setOrgLogoUrl(data.orgSettings?.org?.logoUrl);
    setOrgName(data.orgSettings?.org?.name ?? "AI School");

    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (data.orgSettings?.org?.primaryColor) {
        root.style.setProperty("--brand-primary", data.orgSettings.org.primaryColor);
      }
      if (data.orgSettings?.org?.accentColor) {
        root.style.setProperty("--brand-accent", data.orgSettings.org.accentColor);
      }
    }

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const modelParam = params?.get("model") ?? null;
    const modeParam = (params?.get("mode") as StudyMode | null) ?? null;
    const chatIdParam = params?.get("chatId") ?? null;

    if (modelParam) {
      setManualModel(modelParam);
      setRouterMode("manual");
    } else {
      const mergedModels = mergeModels(data.models, liveData.models);
      if (mergedModels.length > 0) {
        setManualModel(mergedModels[0].modelId);
      }
    }

    if (modeParam) {
      setMode(modeParam);
    }

    const firstChat = chatIdParam
      ? data.chats.find((chat) => chat._id === chatIdParam) ?? data.chats[0]
      : data.chats[0];
    if (firstChat?._id) {
      selectedChatIdRef.current = firstChat._id;
      setSelectedChatId(firstChat._id);
    } else {
      selectedChatIdRef.current = "";
      setSelectedChatId("");
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadBootstrap();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load workspace");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadBootstrap]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      setDraftResponse("");
      setDraftThinking("");
      setActiveCollaborators([]);
      setCollaboratorPhase("idle");
      setStreamError(null);
      return;
    }

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
        setMessages((prev) => mergeFetchedMessages(data.messages, prev));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load chat");
      }
    })();
  }, [selectedChatId]);

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
      setMessages([]);
      setMessage("");
      setDraftResponse("");
      setDraftThinking("");
      setFileList([]);
      setFileUploadState({});
      setStreamError(null);
      setLastFailedMessage(null);
      setMobileSidebarOpen(false);

      if (agentId) {
        setSelectedAgentId(agentId);
      }
    },
    [],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("ai-school:pinned-chats");
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (!Array.isArray(parsed)) return;
      setPinnedChatIds(new Set(parsed.filter((id) => typeof id === "string" && id.trim().length > 0)));
    } catch {
      // Ignore invalid persisted state.
    }
  }, []);

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
    try {
      window.localStorage.setItem("ai-school:pinned-chats", JSON.stringify([...pinnedChatIds]));
    } catch {
      // Ignore storage errors.
    }
  }, [pinnedChatIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSidebarOpen((prev) => !prev);
      }

      if (event.key === "Escape") {
        setSettingsOpen(false);
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  useEffect(() => {
    const handleNewChat = () => startNewChat(selectedAgentId);
    const handleSettings = () => setSettingsOpen((prev) => !prev);
    const handleSetMode = (event: Event) => {
      const custom = event as CustomEvent<StudyMode>;
      const nextMode = custom.detail;
      if (!nextMode) return;
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

  async function createChatIfNeeded(chatIdOverride?: string) {
    if (chatIdOverride) return chatIdOverride;

    const currentChatId = selectedChatIdRef.current;
    if (currentChatId) return currentChatId;

    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: selectedAgentId,
        mode,
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
      mode,
      agentId: selectedAgentId,
      updatedAt: Date.now(),
    };

    selectedChatIdRef.current = data.chatId;
    setSelectedChatId(data.chatId);
    setChats((prev) => [newChat, ...prev]);
    return data.chatId;
  }

  async function handleDeleteChat(chatId: string) {
    const response = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Failed to delete chat");
      return;
    }

    setChats((prev) => prev.filter((chat) => chat._id !== chatId));
    if (selectedChatId === chatId) {
      startNewChat(selectedAgentId);
    }
  }

  async function renameChat(chatId: string, title: string) {
    const clean = title.trim();
    if (!clean) return;

    const response = await fetch(`/api/chats/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: clean }),
    });

    if (!response.ok) {
      toast.error("Failed to rename chat");
      return;
    }

    setChats((prev) => prev.map((chat) => (chat._id === chatId ? { ...chat, title: clean } : chat)));
  }

  function stopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setSending(false);
      toast.info("Generation stopped");
    }
  }

  function pinChat(chatId: string) {
    setPinnedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
        toast.info("Chat unpinned");
      } else {
        next.add(chatId);
        toast.success("Chat pinned");
      }
      return next;
    });
  }

  async function sendMessage(override?: string, options?: SendMessageOptions) {
    const text = (override ?? message).trim();
    const retryAttempt = options?.retryAttempt ?? 0;
    if (!text || (sending && retryAttempt === 0)) return;
    const preservedText = options?.preservedText ?? text;
    const preservedFiles = options?.preservedFiles ?? [...fileList];
    const outgoingFiles = retryAttempt > 0 && options?.preservedFiles ? options.preservedFiles : [...fileList];
    const requestedRouterMode = options?.routerModeOverride ?? routerMode;
    const requestedManualModel = options?.manualModelOverride ?? manualModel;
    const localUserMessageId = options?.localUserMessageId ?? `local-${Date.now()}`;

    setSending(true);
    setDraftResponse("");
    setDraftThinking("Preparing response plan.\n\nAnalyzing prompt and selecting the best strategy.");
    setActiveCollaborators([]);
    setCollaboratorPhase("idle");
    setStreamError(null);
    setSearch("");

    abortControllerRef.current = new AbortController();
    let activeChatId = options?.chatIdOverride;

    try {
      const chatId = await createChatIfNeeded(options?.chatIdOverride);
      activeChatId = chatId;
      const attachedFileNames = outgoingFiles.map((file) => file.name);
      const isRegenerate = Boolean(options?.regenerate);
      const skipLocalUser = Boolean(options?.skipLocalUser);
      const skipServerUserPersist = Boolean(options?.skipServerUserPersist);
      const effectiveRouterMode = requestedRouterMode;
      const effectiveManualModel = requestedManualModel;
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

      if (!isRegenerate && retryAttempt === 0) {
        setMessage("");
        setFileList([]);
        setFileUploadState({});
      }

      if (!skipLocalUser) {
        const userMessage: Message = {
          _id: localUserMessageId,
          role: "user",
          content: text,
          createdAt: Date.now(),
          attachments: attachedFileNames,
          attachmentPreviews: attachmentPreviews.length > 0 ? attachmentPreviews : undefined,
        };
        setMessages((prev) => [...prev, userMessage]);
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

        const uploadResult = await uploadComposerFiles(outgoingFiles, selectedAgentId);
        uploadedResourceIds = uploadResult.resourceIds ?? [];
        const resultByFile = new Map((uploadResult.results ?? []).map((result) => [result.file, result]));
        setFileUploadState((prev) => {
          const next = { ...prev };
          for (const file of outgoingFiles) {
            const key = fileKey(file);
            const current = next[key] ?? {};
            const result = resultByFile.get(file.name);
            next[key] = {
              ...current,
              status: result?.status === "processed" ? "ready" : result?.status === "failed" ? "error" : "ready",
              error: result?.error,
            };
          }
          return next;
        });
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          agentId: selectedAgentId,
          mode,
          message: text,
          thinkingLevel,
          routerMode: effectiveRouterMode,
          manualModel: effectiveRouterMode === "manual" ? effectiveManualModel : undefined,
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
        modelUsed?: string;
        modelRequested?: string;
        whyThisResponse?: string;
        citations?: Citation[];
        routeTrace?: RouteTrace;
        usageIn?: number;
        usageOut?: number;
        thinkingContent?: string;
      } = {};
      let enhancedPrompt: string | undefined;
      let bufferState = createBufferState(mode);
      let thinkingBuffer = "";
      let hasModelThinking = false;

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
              | "collab_start"
              | "collab_progress"
              | "collab_done"
              | "collab_synthesizing";
            content?: string;
            error?: string | { message?: string };
            modelUsed?: string;
            modelRequested?: string;
            whyThisResponse?: string;
            citations?: Citation[];
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
            agents?: string[];
            agent?: string;
            status?: "pending" | "running" | "done" | "failed";
            preview?: string;
            tokensUsed?: number;
            model?: string;
          };

          if (payload.type === "delta" && payload.content) {
            assistantBuffer += payload.content;
            if (bufferState.mode !== "none") {
              bufferState = appendToBuffer(bufferState, assistantBuffer);
              setDraftResponse(bufferState.safeContent);
            } else {
              setDraftResponse((prev) => prev + payload.content);
            }
          }

          if (payload.type === "thinking" && payload.content) {
            if (!hasModelThinking) {
              thinkingBuffer = payload.content;
              hasModelThinking = true;
            } else {
              thinkingBuffer += payload.content;
            }
            setDraftThinking(thinkingBuffer);
          }

          if (payload.type === "collab_start") {
            const agents = payload.agents ?? [];
            setActiveCollaborators(
              agents.map((role) => ({
                role,
                status: "pending",
              })),
            );
            if (agents.length > 0) {
              setCollaboratorPhase("running");
              if (!hasModelThinking) {
                setDraftThinking(
                  `Planning specialist collaboration.\n\nActive agents: ${agents
                    .map((role) => role.replace(/_/g, " "))
                    .join(", ")}.`,
                );
              }
            }
          }

          if (payload.type === "collab_progress" && payload.agent) {
            const agentRole = payload.agent;
            setCollaboratorPhase("running");
            if (!hasModelThinking) {
              const label = agentRole.replace(/_/g, " ");
              setDraftThinking(`Coordinating specialist steps.\n\nNow running: ${label}.`);
            }
            setActiveCollaborators((prev) => {
              const has = prev.some((item) => item.role === agentRole);
              if (!has) {
                return [
                  ...prev,
                  {
                    role: agentRole,
                    status: payload.status ?? "running",
                    model: payload.model,
                    preview: payload.preview,
                  },
                ];
              }
              return prev.map((item) =>
                item.role === agentRole
                  ? {
                      ...item,
                      status: payload.status ?? "running",
                      model: payload.model ?? item.model,
                      preview: payload.preview ?? item.preview,
                    }
                  : item,
              );
            });
          }

          if (payload.type === "collab_done" && payload.agent) {
            const agentRole = payload.agent;
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

          if (payload.type === "collab_synthesizing") {
            setCollaboratorPhase("synthesizing");
          }

          if (payload.type === "done") {
            if (typeof payload.content === "string" && payload.content.trim()) {
              assistantBuffer = payload.content;
              if (bufferState.mode !== "none") {
                bufferState = appendToBuffer(bufferState, assistantBuffer);
                setDraftResponse(bufferState.safeContent);
              } else {
                setDraftResponse(payload.content);
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

            finalMeta = {
              modelUsed: actualModel,
              modelRequested: payload.modelRequested,
              whyThisResponse: payload.whyThisResponse,
              citations: payload.citations,
              routeTrace: normalizedTrace,
              usageIn: payload.usageIn,
              usageOut: payload.usageOut,
              thinkingContent: payload.thinkingContent ?? (thinkingBuffer || undefined),
            };

            if (payload.spendingUpdate) {
              setUserSpending(payload.spendingUpdate);
            }
            if (payload.autoResult) {
              setLastAutoResult(payload.autoResult);
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
            setCollaboratorPhase("idle");
          }

          if (payload.type === "error") {
            const messageFromPayload =
              typeof payload.error === "string" ? payload.error : payload.error?.message ?? "Chat stream failed";
            throw new Error(messageFromPayload);
          }
        }
      }

      if (assistantBuffer) {
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

        const assistantMessage: Message = {
          _id: `assistant-${Date.now()}`,
          role: "assistant",
          content: assistantBuffer,
          createdAt: Date.now(),
          ...finalMeta,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      }

      setDraftResponse("");
      setDraftThinking("");
      setLastFailedMessage(null);
      setChats((prev) =>
        prev.map((chat) =>
          chat._id === chatId
            ? {
                ...chat,
                updatedAt: Date.now(),
                title: chat.title === "New chat" ? text.slice(0, 60) : chat.title,
                mode,
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
          3,
          Math.min(12, models.filter((model) => model.modelId !== "openrouter/auto").length),
        );

        if (canRetryWithNewModel && retryAttempt < maxBusyRetries) {
          abortControllerRef.current = null;
          await new Promise((resolve) => setTimeout(resolve, 900 + retryAttempt * 500));
          return await sendMessage(override ?? text, {
            regenerate: options?.regenerate,
            skipLocalUser: true,
            skipServerUserPersist: true,
            retryAttempt: retryAttempt + 1,
            chatIdOverride: activeChatId,
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
      setMessage(preservedText);
      setFileList(preservedFiles);
      setFileUploadState({});
      setStreamError(message);
      setDraftResponse("");
      setDraftThinking("");
      setLastFailedMessage(preservedText);
    } finally {
      setActiveCollaborators([]);
      setCollaboratorPhase("idle");
      setSending(false);
      abortControllerRef.current = null;
    }
  }

  async function retryLastMessage() {
    if (!lastFailedMessage) return;
    await sendMessage(lastFailedMessage, {
      retryAttempt: 0,
      skipLocalUser: true,
      skipServerUserPersist: true,
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

  async function refreshPersonalResources() {
    const response = await fetch("/api/resources?scope=personal");
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { resources: PersonalResource[] };
    setPersonalResources(
      [...(data.resources ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    );
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

    const chatsRes = await fetch("/api/chats");
    if (chatsRes.ok) {
      const chatsData = (await chatsRes.json()) as { chats: Chat[] };
      setChats(chatsData.chats);
    }
    setSelectedChatId(branchChatId);
  }

  async function recordAssistantFeedback(modelId: string | undefined, positive: boolean) {
    if (!selectedAgentId || !modelId) return;
    await fetch("/api/agents/model-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: selectedAgentId,
        modelId,
        positive,
      }),
    });
  }

  return {
    loading,
    sending,
    role,
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
    autoEnhancePrompt,
    autoModel,
    autoThinking,
    autoSearch,
    userSpending,
    userMemorySummary,
    orgWelcomeMessage,
    orgLogoUrl,
    orgName,
    lastAutoResult,
    message,
    messages,
    draftResponse,
    draftThinking,
    activeCollaborators,
    collaboratorPhase,
    fileList,
    fileUploadState,
    streamError,
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
    setAutoEnhancePrompt,
    setAutoModel,
    setAutoThinking,
    setAutoSearch,
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
    regenerateWithModel,
    editAndResend,
    branchFromMessage,
    recordAssistantFeedback,
    refreshPersonalResources,
    deletePersonalResource,
    updateExistingChatSettings,
    stopGeneration,
    pinChat,
  };
}
