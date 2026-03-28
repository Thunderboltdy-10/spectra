"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { formatDistanceToNow } from "date-fns";
import {
  BarChart3,
  Bot,
  CircleHelp,
  Compass,
  FileText,
  Flame,
  Layers,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Star,
  Timer,
  Trash2,
  StickyNote,
  UserRound,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { GlobalUtilityDock } from "@/components/global-utility-dock";
import { NotificationBell } from "@/components/notification-bell";
import { SpectraLogo } from "@/components/spectra-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getModeConfig } from "@/lib/modes";
import { cn } from "@/lib/utils";
import type { Chat, UserSpending } from "@/hooks/use-chat-state";

type GroupedChats = {
  heading: string;
  chats: Chat[];
};

const EMPTY_PINNED_IDS = new Set<string>();

const BASE_PRIMARY_NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: Sparkles },
  { href: "/workspace", label: "Workspace", icon: Layers },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/agents", label: "Agents", icon: Bot },
];

type ChatSidebarProps = {
  chats: Chat[];
  selectedChatId: string;
  search: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSearchChange: (value: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onOpenSettings: () => void;
  onPinChat?: (chatId: string) => void;
  pinnedChatIds?: Set<string>;
  role: "student" | "teacher" | "admin";
  isSuperAdmin?: boolean;
  userSpending: UserSpending | null;
  userMemorySummary?: string;
  orgName?: string;
  orgLogoUrl?: string;
  activeStreamIds?: Set<string>;
  hasDraft?: (chatId: string) => boolean;
};

function toGroupHeading(ts: number) {
  const now = new Date();
  const target = new Date(ts);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const dayDiff = Math.floor((midnight - targetMidnight) / 86_400_000);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff <= 7) return "Previous 7 days";
  if (dayDiff <= 30) return "Previous 30 days";
  return "Older";
}

function groupChats(chats: Chat[]): GroupedChats[] {
  const groups: Record<string, Chat[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    "Previous 30 days": [],
    Older: [],
  };
  for (const chat of chats) {
    groups[toGroupHeading(chat.updatedAt)].push(chat);
  }
  return Object.entries(groups)
    .map(([heading, grouped]) => ({ heading, chats: grouped }))
    .filter((g) => g.chats.length > 0);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function isNavActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/");
  }
  if (href === "/super-admin") {
    return pathname === "/super-admin" || pathname.startsWith("/super-admin/");
  }
  if (href === "/super-admin/feedback") {
    return pathname === "/super-admin/feedback" || pathname.startsWith("/super-admin/feedback/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ChatSidebar({
  chats,
  selectedChatId,
  search,
  collapsed,
  onToggleCollapse,
  onSearchChange,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onOpenSettings,
  onPinChat,
  pinnedChatIds,
  role,
  isSuperAdmin = false,
  userSpending,
  orgName,
  orgLogoUrl,
  activeStreamIds,
  hasDraft,
}: ChatSidebarProps) {
  const pathname = usePathname();
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [activityCutoffTs, setActivityCutoffTs] = useState<number | null>(null);
  const [gamification, setGamification] = useState<{
    currentStreak: number;
    totalXp: number;
    longestStreak: number;
    lastActiveDate: string | null;
  }>({
    currentStreak: 0,
    totalXp: 0,
    longestStreak: 0,
    lastActiveDate: null,
  });
  const [visibleChatCount, setVisibleChatCount] = useState(20);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatListEndRef = useRef<HTMLDivElement>(null);
  const pageNavScrollRef = useRef<HTMLDivElement>(null);
  const pinnedSet = pinnedChatIds ?? EMPTY_PINNED_IDS;

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [orgLogoUrl]);

  useEffect(() => {
    setActivityCutoffTs(Date.now() - (30 * 24 * 60 * 60 * 1000));
  }, []);

  const recentChatCount = useMemo(() => {
    if (activityCutoffTs === null) return chats.length;
    return chats.filter((chat) => chat.updatedAt >= activityCutoffTs).length;
  }, [activityCutoffTs, chats]);

  const usagePercentCandidates = [
    userSpending?.activityUsagePercent,
    userSpending?.budgetUsagePercent,
    userSpending?.tokenUsagePercent,
  ].filter((value): value is number => typeof value === "number" && value >= 0);
  const usagePercentFromSpending = usagePercentCandidates.length > 0 ? Math.max(...usagePercentCandidates) : null;
  const usageRatioFromSpending = typeof usagePercentFromSpending === "number"
    ? Math.min(1, Math.max(0, usagePercentFromSpending / 100))
    : null;
  const usageRatioFromActivity = !userSpending && recentChatCount > 0
    ? Math.min(1, recentChatCount / 50)
    : null;
  const usageRatio = usageRatioFromSpending ?? usageRatioFromActivity;
  const usagePercent = typeof usageRatio === "number"
    ? Math.max(0, Math.min(100, Math.round(usageRatio * 1000) / 10))
    : null;
  const usagePercentLabel = typeof usagePercent === "number"
    ? usagePercent > 0 && usagePercent < 1
      ? "<1%"
      : `${Number.isInteger(usagePercent) ? usagePercent.toFixed(0) : usagePercent.toFixed(1)}%`
    : "No data";
  const usageStatus =
    typeof usagePercent !== "number" || (userSpending && (userSpending.monthlyEvents ?? 0) === 0 && (userSpending.monthlyTokens ?? 0) === 0)
      ? "No activity yet"
      : usagePercent >= 80
        ? "High activity"
        : usagePercent >= 40
          ? "Steady activity"
          : usagePercent > 0
            ? "Getting started"
            : "No activity yet";
  const canAccessSchoolAdmin = role === "admin" || isSuperAdmin;
  const canAccessAdminConsole = role === "admin" || isSuperAdmin;
  const primaryNavItems = BASE_PRIMARY_NAV_ITEMS;
  const secondaryNavItems = [
    { href: "/models", label: "Models", icon: Compass },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ...(canAccessAdminConsole || canAccessSchoolAdmin ? [{ href: "/admin", label: "Admin", icon: LayoutDashboard }] : []),
    ...(isSuperAdmin
      ? [
          { href: "/super-admin", label: "Super Admin", icon: Shield },
          { href: "/super-admin/feedback", label: "Feedback", icon: MessageSquare },
        ]
      : []),
  ];
  const orderedPrimaryNavItems = primaryNavItems;
  const allNavItems = [...orderedPrimaryNavItems, ...secondaryNavItems].filter(
    (item, index, all) => all.findIndex((candidate) => candidate.href === item.href) === index,
  );
  const refreshGamification = useCallback(async () => {
    try {
      const response = await fetch("/api/gamification");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        currentStreak: number;
        totalXp: number;
        longestStreak: number;
        lastActiveDate: string | null;
      };
      setGamification({
        currentStreak: payload.currentStreak ?? 0,
        totalXp: payload.totalXp ?? 0,
        longestStreak: payload.longestStreak ?? 0,
        lastActiveDate: payload.lastActiveDate ?? null,
      });
    } catch {
      // Ignore transient gamification fetch failures.
    }
  }, []);

  useEffect(() => {
    void refreshGamification();

    const handleRefresh = () => {
      void refreshGamification();
    };

    window.addEventListener("ai-school:refresh-gamification", handleRefresh);
    return () => window.removeEventListener("ai-school:refresh-gamification", handleRefresh);
  }, [refreshGamification]);

  useEffect(() => {
    const container = pageNavScrollRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-nav-active="true"]');
    if (!active) return;
    active.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  // Reset visible count when search changes or the chat list grows/shrinks significantly.
  useEffect(() => {
    if (search) {
      setVisibleChatCount(chats.length); // Show all results when filtering
    } else {
      setVisibleChatCount(20);
    }
  }, [search, chats.length]);

  // IntersectionObserver: load the next batch of chats when the sentinel is visible.
  useEffect(() => {
    const target = chatListEndRef.current;
    const root = chatScrollRef.current;
    if (!target || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && visibleChatCount < chats.length) {
          setVisibleChatCount((prev) => Math.min(prev + 20, chats.length));
        }
      },
      { root, rootMargin: "100px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [visibleChatCount, chats.length]);

  const pinned = useMemo(() => chats.filter((chat) => pinnedSet.has(chat._id)), [chats, pinnedSet]);
  const nonPinnedChats = useMemo(() => chats.filter((chat) => !pinnedSet.has(chat._id)), [chats, pinnedSet]);
  const visibleNonPinnedChats = useMemo(
    () => nonPinnedChats.slice(0, visibleChatCount),
    [nonPinnedChats, visibleChatCount],
  );
  const grouped = useMemo(() => groupChats(nonPinnedChats), [nonPinnedChats]);
  const visibleGrouped = useMemo(() => groupChats(visibleNonPinnedChats), [visibleNonPinnedChats]);
  const collapsedUtilityActions = [
    {
      id: "timer",
      title: "Focus timer",
      Icon: Timer,
      action: () => window.dispatchEvent(new CustomEvent("ai-school:open-focus-timer")),
    },
    {
      id: "feedback",
      title: "Feedback",
      Icon: MessageSquare,
      action: () => window.dispatchEvent(new CustomEvent("ai-school:open-feedback")),
    },
    {
      id: "help",
      title: "Info & tour",
      Icon: CircleHelp,
      action: () => window.dispatchEvent(new CustomEvent("ai-school:open-tour")),
    },
  ] as const;

  if (collapsed) {
    return (
      <div className="chat-sidebar flex h-full flex-col border-r border-[var(--border-default)] px-1.5 py-3">
        <div className="mb-4 flex flex-col items-center gap-2">
          {orgLogoUrl && orgLogoUrl.trim() && !logoLoadFailed ? (
            <Image
              src={orgLogoUrl}
              alt={orgName ?? "Org"}
              width={48}
              height={48}
              className="h-12 w-12 rounded-xl object-cover"
              unoptimized
              onError={() => setLogoLoadFailed(true)}
            />
          ) : (
            <SpectraLogo size={48} showTile />
          )}
          <Button type="button" variant="ghost" size="icon" className="h-8.5 w-8.5" onClick={onToggleCollapse} aria-label="Expand sidebar">
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-8.5 w-8.5" onClick={onNewChat} aria-label="New chat">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div data-tour="sidebar-pages" className="mx-auto flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto pr-0.5">
          {allNavItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(pathname, item.href);
            return (
              <div key={item.href} className="relative flex flex-col items-center">
                <Link
                  href={item.href}
                  title={item.label}
                  className={cn(
                    "inline-flex h-9.5 w-9.5 items-center justify-center rounded-xl transition-colors",
                    active
                      ? "bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </Link>
                {active && (
                  <span className="mt-0.5 h-1 w-1 rounded-full bg-[var(--accent-cyan)]" />
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex min-h-0 flex-col items-center gap-2 overflow-visible">
          <div className="mb-1 flex flex-col gap-1.5">
            <NotificationBell
              buttonClassName="h-9.5 w-9.5 rounded-xl bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              contentClassName="z-[98]"
              align="start"
              side="right"
              sideOffset={10}
            />
            {collapsedUtilityActions.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.title}
                onClick={item.action}
                className="inline-flex h-9.5 w-9.5 cursor-pointer items-center justify-center rounded-xl text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <item.Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <div className="mb-1 flex flex-col items-center gap-1 text-[10px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1" title="Current streak">
              <Flame className={cn("h-3 w-3", gamification.currentStreak > 0 ? "animate-pulse text-[#ef4444]" : "text-[var(--text-secondary)]")} />
              {gamification.currentStreak}
            </span>
            <span className="inline-flex items-center gap-1" title="Total XP">
              <Star className="h-3 w-3 text-[var(--warning)]" />
              {gamification.totalXp}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9.5 w-9.5 rounded-xl"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer rounded-full">
                <Avatar className="h-8.5 w-8.5">
                  <AvatarImage src={user?.imageUrl} alt={user?.fullName ?? "User"} />
                  <AvatarFallback>{initials(user?.fullName || user?.firstName || "User")}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right">
              <DropdownMenuItem onSelect={() => openUserProfile()}>
                <UserRound className="mr-2 h-4 w-4" />
                Manage account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => signOut()}>
                <Sparkles className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ThemeToggle className="h-9.5 w-9.5 rounded-xl bg-transparent hover:bg-[var(--bg-hover)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-sidebar flex h-full flex-col border-r border-[var(--border-default)] p-3" data-usage-percent={usagePercentLabel} data-usage-status={usageStatus}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {orgLogoUrl && orgLogoUrl.trim() && !logoLoadFailed ? (
            <Image
              src={orgLogoUrl}
              alt={orgName ?? "Org"}
              width={48}
              height={48}
              className="h-12 w-12 rounded-xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_82%,transparent)] object-cover shadow-[var(--shadow-soft)]"
              unoptimized
              onError={() => setLogoLoadFailed(true)}
            />
          ) : (
            <SpectraLogo size={48} showTile />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-lg leading-none">
              <span className="font-display">{orgName ?? "School"}</span>
            </p>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-[var(--brand-primary)]">Spectra</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Collapse sidebar">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-3" data-tour="sidebar-pages">
        <p className="mb-1 px-3 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">Navigation</p>
        <div ref={pageNavScrollRef} className="overflow-y-auto max-h-[192px] pb-4 [mask-image:linear-gradient(to_bottom,black_85%,transparent)]">
          {allNavItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                data-nav-active={active ? "true" : "false"}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <Button className="mb-3 w-full justify-start gap-2 rounded-xl" onClick={onNewChat}>
        <Plus className="h-4 w-4" />
        New chat
      </Button>

      <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="mb-2 relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--text-secondary)]" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search chats"
            data-search-input
            className="h-8 w-full rounded-lg border border-transparent bg-[var(--bg-primary)] pl-9 pr-2.5 text-xs text-[var(--text-primary)] transition placeholder:text-[var(--text-secondary)] focus:outline-none focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none"
          />
        </div>

        {pinned.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-secondary)]">
              Pinned
            </p>
            <div className="space-y-1">
              {pinned.map((chat) => {
                const active = selectedChatId === chat._id;
                // Show AI-generated title as primary, fallback to user prompt or "New chat"
                const promptPreview = chat.title || chat.latestUserPrompt || "New chat";
                const chatModeConfig = getModeConfig(chat.mode);
                const isStreaming = activeStreamIds?.has(chat._id);
                const hasDraftIndicator = hasDraft?.(chat._id);
                return (
                  <button
                    key={chat._id}
                    type="button"
                    onClick={() => onSelectChat(chat._id)}
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left transition ${
                      active
                        ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))]"
                        : "hover:bg-[var(--bg-primary)]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {isStreaming ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent-cyan)]" />
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: chatModeConfig.color }} />
                      )}
                      <p className="truncate text-sm font-medium">{promptPreview}</p>
                      {hasDraftIndicator && !isStreaming && <FileText className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />}
                    </div>
                    <p className="truncate pl-3.5 text-[11px] text-[var(--text-secondary)]">
                      {isStreaming ? <span className="text-[var(--accent-cyan)]">Generating...</span> : "Pinned"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {grouped.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--border-default)] p-4 text-center text-sm text-[var(--text-secondary)]">
            No chats yet.
          </p>
        )}
        <div className="space-y-4">
          {visibleGrouped.map((group) => (
            <div key={group.heading}>
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-secondary)]">
                {group.heading}
              </p>
              <div className="space-y-1">
                {group.chats.map((chat) => {
                  const active = selectedChatId === chat._id;
                  // Show AI-generated title as primary, fallback to user prompt or "New chat"
                  const promptPreview = chat.title || chat.latestUserPrompt || "New chat";
                  const secondaryLine = formatDistanceToNow(chat.updatedAt, { addSuffix: true });
                  const chatModeConfig = getModeConfig(chat.mode);
                  const isStreaming = activeStreamIds?.has(chat._id);
                  const hasDraftIndicator = hasDraft?.(chat._id);
                  return (
                    <div key={chat._id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onSelectChat(chat._id)}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-left transition ${
                          active
                            ? "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-primary))]"
                            : "hover:bg-[var(--bg-primary)]"
                        }`}
                      >
                        {editingChatId === chat._id ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const chatId = chat._id;
                              const newTitle = editingValue;
                              setEditingChatId(null);
                              setRenamingChatId(chatId);
                              Promise.resolve(onRenameChat(chatId, newTitle)).finally(() => {
                                setRenamingChatId((prev) => (prev === chatId ? null : prev));
                              });
                            }}
                          >
                            <input
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-[var(--accent-cyan)]"
                              autoFocus
                              onBlur={() => setEditingChatId(null)}
                            />
                          </form>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5">
                              {isStreaming || renamingChatId === chat._id ? (
                                <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${renamingChatId === chat._id ? "text-[var(--text-tertiary)]" : "text-[var(--accent-cyan)]"}`} />
                              ) : (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ background: chatModeConfig.color }}
                                />
                              )}
                              <p className="truncate text-[13px] font-medium">{promptPreview}</p>
                              {hasDraftIndicator && !isStreaming && <FileText className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />}
                            </div>
                            <p className="truncate pl-3.5 text-[11px] text-[var(--text-secondary)]">
                              {renamingChatId === chat._id ? (
                                <span className="text-[var(--text-tertiary)]">Renaming...</span>
                              ) : isStreaming ? (
                                <span className="text-[var(--accent-cyan)]">Generating...</span>
                              ) : (
                                secondaryLine
                              )}
                              {hasDraftIndicator && !isStreaming && !renamingChatId && <span className="ml-1.5 text-[var(--text-tertiary)]">Draft</span>}
                            </p>
                          </>
                        )}
                      </button>
                      {editingChatId !== chat._id && (
                        <div className="pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
                          {onPinChat && (
                            <button
                              type="button"
                              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                              onClick={() => onPinChat(chat._id)}
                              aria-label="Pin chat"
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                            onClick={() => {
                              setEditingChatId(chat._id);
                              setEditingValue(chat.title);
                            }}
                            aria-label="Rename"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                            onClick={() => onDeleteChat(chat._id)}
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {visibleChatCount < nonPinnedChats.length && (
          <div ref={chatListEndRef} className="py-2 text-center text-[10px] text-[var(--text-tertiary)]">
            Loading more...
          </div>
        )}
      </div>

      <div className="mt-auto border-t border-[var(--border-default)] pt-2">
        <GlobalUtilityDock placement="profile-bar" className="mb-2 w-full" />

        <div className="flex items-center gap-2 px-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer rounded-full">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.imageUrl} alt={user?.fullName ?? "User"} />
                  <AvatarFallback className="text-[10px]">{initials(user?.fullName || user?.firstName || "User")}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => openUserProfile()}>
                <UserRound className="mr-2 h-4 w-4" />
                Manage account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => signOut()}>
                <Sparkles className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight">{user?.fullName ?? user?.firstName ?? "User"}</p>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
              <span className="inline-flex items-center gap-0.5">
                <Flame className={cn("h-2.5 w-2.5", gamification.currentStreak > 0 ? "text-[#ef4444]" : "text-[var(--text-tertiary)]")} />
                {gamification.currentStreak}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <Star className="h-2.5 w-2.5 text-[var(--warning)]" />
                {gamification.totalXp}
              </span>
            </div>
          </div>
          <ThemeToggle className="rounded-xl bg-transparent hover:bg-[var(--bg-hover)]" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl"
            onClick={onOpenSettings}
            title="Open global settings"
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
