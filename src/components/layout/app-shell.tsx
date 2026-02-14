"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import type { Chat, UserSpending } from "@/hooks/use-chat-state";

type Role = "student" | "teacher" | "admin";

type BootstrapResponse = {
  actor?: { role?: Role };
  chats?: Chat[];
  orgSettings?: {
    org?: {
      name?: string;
      logoUrl?: string;
      primaryColor?: string;
      accentColor?: string;
    };
  };
  userSpending?: UserSpending;
  userMemory?: {
    summary?: string;
  };
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [chats, setChats] = useState<Chat[]>([]);
  const [role, setRole] = useState<Role>("student");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userSpending, setUserSpending] = useState<UserSpending | null>(null);
  const [userMemorySummary, setUserMemorySummary] = useState("");
  const [orgName, setOrgName] = useState("AI School");
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | undefined>(undefined);
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set());

  const selectedChatId = "";

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/bootstrap");
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as BootstrapResponse;
        setRole(data.actor?.role ?? "student");
        setChats(data.chats ?? []);
        setUserSpending(data.userSpending ?? null);
        setUserMemorySummary(data.userMemory?.summary ?? "");
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
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load sidebar data");
      }
    })();
  }, []);

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
    try {
      window.localStorage.setItem("ai-school:pinned-chats", JSON.stringify([...pinnedChatIds]));
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

  async function handleDeleteChat(chatId: string) {
    const response = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Failed to delete chat");
      return;
    }
    setChats((prev) => prev.filter((chat) => chat._id !== chatId));
  }

  async function handleRenameChat(chatId: string, title: string) {
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

  function handlePinChat(chatId: string) {
    setPinnedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <aside className={`hidden h-full transition-all duration-300 md:block ${sidebarOpen ? "w-[320px]" : "w-[76px]"}`}>
        <ChatSidebar
          chats={filteredChats}
          selectedChatId={selectedChatId}
          search={search}
          collapsed={!sidebarOpen}
          onToggleCollapse={() => setSidebarOpen((prev) => !prev)}
          onSearchChange={setSearch}
          onSelectChat={(chatId) => router.push(`/?chatId=${encodeURIComponent(chatId)}`)}
          onNewChat={() => router.push("/")}
          onDeleteChat={(chatId) => void handleDeleteChat(chatId)}
          onRenameChat={(chatId, title) => void handleRenameChat(chatId, title)}
          onOpenSettings={() => {
            if (pathname !== "/") {
              router.push("/");
              return;
            }
            window.dispatchEvent(new Event("ai-school:toggle-settings"));
          }}
          onPinChat={handlePinChat}
          pinnedChatIds={pinnedChatIds}
          role={role}
          userSpending={userSpending}
          userMemorySummary={userMemorySummary}
          orgName={orgName}
          orgLogoUrl={orgLogoUrl}
        />
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
