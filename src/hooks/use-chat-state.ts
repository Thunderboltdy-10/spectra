"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Agent, Citation, RouterMode, StudyMode, ThinkingLevel } from "@/types";

export type Chat = {
  _id: string;
  title: string;
  latestUserPrompt?: string;
  mode: StudyMode;
  packId?: string;
  agentId?: string;
  updatedAt: number;
};

export type Message = {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
  enhancedContent?: string;
  attachments?: string[];
  modelUsed?: string;
  modelRequested?: string;
  whyThisResponse?: string;
  citations?: Citation[];
};

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

async function uploadComposerFiles(files: File[], agentId?: string) {
  if (files.length === 0) return;

  const formData = new FormData();
  formData.set("scope", "personal");
  if (agentId) {
    formData.set("agentId", agentId);
  }

  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch(`/api/resources`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function isLocalProvider(value?: string) {
  const normalized = (value ?? "").toLowerCase();
  return normalized.includes("local") || normalized.includes("ollama");
}

function sanitizeModelName(name: string) {
  return name.replace(/:free/gi, "").trim();
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
      isFree: existing?.isFree ?? (model.id.includes(":free") || (model.pricing.prompt ?? 0) === 0),
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
  const [lastAutoResult, setLastAutoResult] = useState<{
    modelUsed?: string;
    searchEnabled: boolean;
    thinkingLevel: ThinkingLevel;
    promptEnhanced: boolean;
  } | null>(null);

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftResponse, setDraftResponse] = useState("");
  const [fileList, setFileList] = useState<File[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set());

  const abortControllerRef = useRef<AbortController | null>(null);

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
    return chats.filter((chat) =>
      `${chat.latestUserPrompt ?? ""} ${chat.title}`.toLowerCase().includes(clean),
    );
  }, [chats, search]);

  const loadBootstrap = useCallback(async () => {
    const [bootstrapRes, liveRes] = await Promise.all([
      fetch("/api/bootstrap"),
      fetch("/api/models/live").catch(() => null),
    ]);
    if (!bootstrapRes.ok) {
      throw new Error(await bootstrapRes.text());
    }

    const data = (await bootstrapRes.json()) as BootstrapResponse;
    const liveData =
      liveRes && liveRes.ok
        ? ((await liveRes.json()) as { models: LiveModel[] })
        : { models: [] as LiveModel[] };

    setRole(data.actor.role);
    setChats(data.chats);
    setModels(mergeModels(data.models, liveData.models));
    setAgents(data.agents);
    setUserSpending(data.userSpending);
    setUserMemorySummary(data.userMemory.summary);

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const modelParam = params?.get("model") ?? null;
    const modeParam = (params?.get("mode") as StudyMode | null) ?? null;

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

    const firstChat = data.chats[0];
    if (firstChat?._id) {
      setSelectedChatId(firstChat._id);
    } else {
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
    if (!selectedChatId) {
      setMessages([]);
      setDraftResponse("");
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

  const startNewChat = useCallback(
    (agentId?: string) => {
      setSelectedChatId("");
      setMessages([]);
      setMessage("");
      setDraftResponse("");
      setFileList([]);
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

  async function createChatIfNeeded() {
    if (selectedChatId) return selectedChatId;

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

  async function sendMessage(
    override?: string,
    options?: { regenerate?: boolean; skipLocalUser?: boolean; retryAttempt?: number },
  ) {
    const text = (override ?? message).trim();
    if (!text || sending) return;

    setSending(true);
    setDraftResponse("");
    setStreamError(null);

    abortControllerRef.current = new AbortController();

    try {
      const chatId = await createChatIfNeeded();
      const attachedFileNames = fileList.map((file) => file.name);
      const isRegenerate = Boolean(options?.regenerate);
      const skipLocalUser = Boolean(options?.skipLocalUser);

      if (fileList.length > 0 && !isRegenerate) {
        const uploadingToast = toast.loading("Uploading attachments...");
        await uploadComposerFiles(fileList, selectedAgentId);
        toast.success(`Uploaded ${fileList.length} attachment(s)`, { id: uploadingToast });
      }

      if (!skipLocalUser) {
        const userMessage: Message = {
          _id: `local-${Date.now()}`,
          role: "user",
          content: text,
          attachments: attachedFileNames,
        };
        setMessages((prev) => [...prev, userMessage]);
        setMessage("");
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
          routerMode,
          manualModel: routerMode === "manual" ? manualModel : undefined,
          usePersonalResources,
          regenerate: isRegenerate,
          attachmentTypes: fileList.map((file) => ext(file.name)).filter(Boolean),
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

      if (!isRegenerate) {
        setFileList([]);
      }

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to send message");
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
      } = {};
      let enhancedPrompt: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const payload = JSON.parse(line) as {
            type: "delta" | "done" | "error";
            content?: string;
            error?: string | { message?: string };
            modelUsed?: string;
            modelRequested?: string;
            whyThisResponse?: string;
            citations?: Citation[];
            spendingUpdate?: UserSpending;
            autoResult?: {
              modelUsed?: string;
              searchEnabled: boolean;
              thinkingLevel: ThinkingLevel;
              promptEnhanced: boolean;
            };
            enhancedPrompt?: string;
          };

          if (payload.type === "delta" && payload.content) {
            assistantBuffer += payload.content;
            setDraftResponse((prev) => prev + payload.content);
          }

          if (payload.type === "done") {
            finalMeta = {
              modelUsed: payload.modelUsed,
              modelRequested: payload.modelRequested,
              whyThisResponse: payload.whyThisResponse,
              citations: payload.citations,
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
          ...finalMeta,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      }

      setDraftResponse("");
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
      const message = error instanceof Error ? error.message : "Failed to send message";
      const isBusyError = /429|busy|rate/i.test(message);
      if (isBusyError && (options?.retryAttempt ?? 0) < 2) {
        toast.info("Primary model is busy. Retrying with backup route...");
        setSending(false);
        abortControllerRef.current = null;
        await new Promise((resolve) => setTimeout(resolve, 900 + (options?.retryAttempt ?? 0) * 500));
        return await sendMessage(override ?? text, {
          regenerate: options?.regenerate,
          skipLocalUser: true,
          retryAttempt: (options?.retryAttempt ?? 0) + 1,
        });
      } else {
        setStreamError(message);
        setDraftResponse("");
        setLastFailedMessage(text);
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
    }
  }

  async function retryLastMessage() {
    if (!lastFailedMessage) return;
    await sendMessage(lastFailedMessage, { retryAttempt: 1, skipLocalUser: true });
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

  return {
    loading,
    sending,
    role,
    chats,
    models,
    agents,
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
    lastAutoResult,
    message,
    messages,
    draftResponse,
    fileList,
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
    updateExistingChatSettings,
    stopGeneration,
    pinChat,
  };
}
