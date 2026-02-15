"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Agent, StudyMode } from "@/types";

export type SidebarChat = {
  _id: string;
  title: string;
  latestUserPrompt?: string;
  mode: StudyMode;
  packId?: string;
  agentId?: string;
  updatedAt: number;
};

export type SidebarModel = {
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

export type SidebarSpending = {
  totalSpentEur: number;
  totalCostCents: number;
  tier: "normal" | "cheap_only" | "free_only";
  softLimitReached: boolean;
  hardLimitReached: boolean;
};

type BootstrapResponse = {
  actor: { role: "student" | "teacher" | "admin" };
  chats: SidebarChat[];
  models: SidebarModel[];
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
  userSpending: SidebarSpending;
  userMemory: {
    summary: string;
    updatedAt: number;
    entryCount: number;
  };
};

type SidebarContextValue = {
  loading: boolean;
  role: "student" | "teacher" | "admin";
  chats: SidebarChat[];
  models: SidebarModel[];
  agents: Agent[];
  userSpending: SidebarSpending | null;
  setUserSpending: React.Dispatch<React.SetStateAction<SidebarSpending | null>>;
  userMemorySummary: string;
  orgSettings?: BootstrapResponse["orgSettings"];
  orgName: string;
  orgLogoUrl?: string;
  orgWelcomeMessage: string;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pinnedChatIds: Set<string>;
  filteredChats: SidebarChat[];
  setChats: React.Dispatch<React.SetStateAction<SidebarChat[]>>;
  addChat: (chat: SidebarChat) => void;
  deleteChat: (chatId: string) => Promise<void>;
  renameChat: (chatId: string, title: string) => Promise<void>;
  pinChat: (chatId: string) => void;
  refreshBootstrap: () => Promise<void>;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

const PINNED_KEY = "ai-school:pinned-chats";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"student" | "teacher" | "admin">("student");
  const [chats, setChats] = useState<SidebarChat[]>([]);
  const [models, setModels] = useState<SidebarModel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [userSpending, setUserSpending] = useState<SidebarSpending | null>(null);
  const [userMemorySummary, setUserMemorySummary] = useState("");
  const [orgSettings, setOrgSettings] = useState<BootstrapResponse["orgSettings"] | undefined>(undefined);
  const [orgName, setOrgName] = useState("AI School");
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | undefined>(undefined);
  const [orgWelcomeMessage, setOrgWelcomeMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set());

  const refreshBootstrap = useCallback(async () => {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = (await response.json()) as BootstrapResponse;
    setRole(data.actor?.role ?? "student");
    setChats(data.chats ?? []);
    setModels(data.models ?? []);
    setAgents(data.agents ?? []);
    setUserSpending(data.userSpending ?? null);
    setUserMemorySummary(data.userMemory?.summary ?? "");
    setOrgSettings(data.orgSettings);
    setOrgWelcomeMessage(data.orgSettings?.org?.welcomeMessage ?? "");
    setOrgName(data.orgSettings?.org?.name ?? "AI School");
    setOrgLogoUrl(data.orgSettings?.org?.logoUrl);

    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (data.orgSettings?.org?.primaryColor) {
        root.style.setProperty("--brand-primary", data.orgSettings.org.primaryColor);
      }
      if (data.orgSettings?.org?.accentColor) {
        root.style.setProperty("--brand-accent", data.orgSettings.org.accentColor);
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refreshBootstrap();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load sidebar data");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshBootstrap]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (!Array.isArray(parsed)) return;
      setPinnedChatIds(new Set(parsed.filter((id) => typeof id === "string" && id.trim().length > 0)));
    } catch {
      // Ignore invalid persisted state.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PINNED_KEY, JSON.stringify([...pinnedChatIds]));
    } catch {
      // Ignore storage errors.
    }
  }, [pinnedChatIds]);

  const filteredChats = useMemo(() => {
    const clean = search.trim().toLowerCase();
    if (!clean) return chats;
    return chats.filter((chat) =>
      `${chat.latestUserPrompt ?? ""} ${chat.title}`.toLowerCase().includes(clean),
    );
  }, [chats, search]);

  const addChat = useCallback((chat: SidebarChat) => {
    setChats((prev) => [chat, ...prev.filter((item) => item._id !== chat._id)]);
  }, []);

  const deleteChat = useCallback(async (chatId: string) => {
    const response = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    setChats((prev) => prev.filter((chat) => chat._id !== chatId));
  }, []);

  const renameChat = useCallback(async (chatId: string, title: string) => {
    const clean = title.trim();
    if (!clean) return;
    const response = await fetch(`/api/chats/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: clean }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    setChats((prev) => prev.map((chat) => (chat._id === chatId ? { ...chat, title: clean } : chat)));
  }, []);

  const pinChat = useCallback((chatId: string) => {
    setPinnedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider
      value={{
        loading,
        role,
        chats,
        models,
        agents,
        userSpending,
        setUserSpending,
        userMemorySummary,
        orgSettings,
        orgName,
        orgLogoUrl,
        orgWelcomeMessage,
        search,
        setSearch,
        sidebarOpen,
        setSidebarOpen,
        pinnedChatIds,
        filteredChats,
        setChats,
        addChat,
        deleteChat,
        renameChat,
        pinChat,
        refreshBootstrap,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return context;
}
