"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bookmark,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileText,
  Flame,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  School,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  UserRound,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getModeConfig } from "@/lib/modes";
import type { Chat, UserSpending } from "@/hooks/use-chat-state";

type GroupedChats = {
  heading: string;
  chats: Chat[];
};

const EMPTY_PINNED_IDS = new Set<string>();
const CHAT_ROW_ESTIMATE_PX = 46;
const CHAT_LIST_CHROME_PX = 360;
const PRIMARY_NAV_ORDER_KEY = "ai-school-primary-nav-order";

const BASE_PRIMARY_NAV_ITEMS = [
  { href: "/", label: "Chat", icon: Sparkles },
  { href: "/flashcards", label: "Flashcards", icon: BookOpen },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
  { href: "/achievements", label: "Achievements", icon: Trophy },
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

function estimateVisibleChatCount(viewportHeight: number) {
  const available = Math.max(300, viewportHeight - CHAT_LIST_CHROME_PX);
  return Math.max(8, Math.ceil(available / CHAT_ROW_ESTIMATE_PX));
}

function estimatePrimaryNavCount(viewportHeight: number) {
  return viewportHeight < 860 ? 4 : 5;
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
    return pathname === "/admin" || pathname === "/admin/branding" || pathname === "/admin/soul";
  }
  if (href === "/admin/school") {
    return pathname.startsWith("/admin/school");
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
  userMemorySummary,
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
  const [navExpandedByHover, setNavExpandedByHover] = useState(false);
  const [reorderPrimaryNav, setReorderPrimaryNav] = useState(false);
  const [primaryNavOrder, setPrimaryNavOrder] = useState<string[]>([]);
  const [primaryVisibleCount, setPrimaryVisibleCount] = useState(() =>
    typeof window === "undefined" ? 5 : estimatePrimaryNavCount(window.innerHeight),
  );
  const [visibleChatCount, setVisibleChatCount] = useState(() =>
    typeof window === "undefined" ? 10 : estimateVisibleChatCount(window.innerHeight),
  );
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
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatLoadSentinelRef = useRef<HTMLDivElement>(null);
  const pinnedSet = pinnedChatIds ?? EMPTY_PINNED_IDS;

  const usageRatio = userSpending
    ? Math.min(
        Math.max(
          typeof userSpending.budgetUsagePercent === "number"
            ? userSpending.budgetUsagePercent / 100
            : (userSpending.totalCostCents ?? 0) / Math.max(1, userSpending.hardLimitCents ?? 1),
          0,
        ),
        1,
      )
    : Math.min(chats.length / 40, 1);
  const usagePercent = Math.max(0, Math.min(100, Math.round(usageRatio * 100)));
  const usageStatus =
    usagePercent >= 80
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
    { href: "/images", label: "Images", icon: ImagePlus },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ...(canAccessAdminConsole ? [{ href: "/admin", label: "Admin", icon: LayoutDashboard }] : []),
    ...(canAccessSchoolAdmin ? [{ href: "/admin/school", label: "School Admin", icon: School }] : []),
    ...(isSuperAdmin
      ? [
          { href: "/super-admin", label: "Super Admin", icon: Shield },
          { href: "/super-admin/feedback", label: "Feedback", icon: MessageSquare },
        ]
      : []),
  ];
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRIMARY_NAV_ORDER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter((href) =>
        primaryNavItems.some((item) => item.href === href),
      );
      if (valid.length > 0) {
        setPrimaryNavOrder(valid);
      }
    } catch {
      // Ignore invalid nav order persistence.
    }
  }, [primaryNavItems]);

  useEffect(() => {
    if (primaryNavOrder.length > 0) return;
    setPrimaryNavOrder(primaryNavItems.map((item) => item.href));
  }, [primaryNavItems, primaryNavOrder.length]);

  useEffect(() => {
    if (primaryNavOrder.length === 0) return;
    try {
      window.localStorage.setItem(PRIMARY_NAV_ORDER_KEY, JSON.stringify(primaryNavOrder));
    } catch {
      // Ignore storage errors.
    }
  }, [primaryNavOrder]);

  const orderedPrimaryNavItems = useMemo(() => {
    const rank = new Map(primaryNavOrder.map((href, index) => [href, index]));
    return [...primaryNavItems].sort((a, b) => {
      const aRank = rank.get(a.href) ?? Number.MAX_SAFE_INTEGER;
      const bRank = rank.get(b.href) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    });
  }, [primaryNavItems, primaryNavOrder]);

  const movePrimaryNavItem = useCallback((href: string, direction: "up" | "down") => {
    setPrimaryNavOrder((prev) => {
      const order = prev.length > 0 ? [...prev] : primaryNavItems.map((item) => item.href);
      const index = order.indexOf(href);
      if (index < 0) return order;
      const nextIndex = direction === "up" ? Math.max(0, index - 1) : Math.min(order.length - 1, index + 1);
      if (nextIndex === index) return order;
      const [item] = order.splice(index, 1);
      if (!item) return order;
      order.splice(nextIndex, 0, item);
      return order;
    });
  }, [primaryNavItems]);

  const secondaryActive = secondaryNavItems.some((item) => isNavActive(pathname, item.href));
  const primaryOverflowActive = orderedPrimaryNavItems
    .slice(primaryVisibleCount)
    .some((item) => isNavActive(pathname, item.href));
  const showPrimaryNav = navExpandedByHover || primaryOverflowActive || reorderPrimaryNav;
  const showSecondaryNav = secondaryActive || navExpandedByHover || reorderPrimaryNav;
  const primaryNavVisibleItems = showPrimaryNav
    ? orderedPrimaryNavItems
    : orderedPrimaryNavItems.slice(0, primaryVisibleCount);
  const hiddenPrimaryCount = Math.max(0, orderedPrimaryNavItems.length - primaryVisibleCount);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setVisibleChatCount(estimateVisibleChatCount(window.innerHeight));
    setPrimaryVisibleCount(estimatePrimaryNavCount(window.innerHeight));
  }, [search]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const next = estimateVisibleChatCount(window.innerHeight);
      setVisibleChatCount((prev) => Math.max(prev, next));
      setPrimaryVisibleCount(estimatePrimaryNavCount(window.innerHeight));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  const pinned = useMemo(() => chats.filter((chat) => pinnedSet.has(chat._id)), [chats, pinnedSet]);
  const nonPinnedChats = useMemo(() => chats.filter((chat) => !pinnedSet.has(chat._id)), [chats, pinnedSet]);
  const selectedNonPinnedIndex = useMemo(
    () => nonPinnedChats.findIndex((chat) => chat._id === selectedChatId),
    [nonPinnedChats, selectedChatId],
  );
  const effectiveVisibleCount = selectedNonPinnedIndex >= 0
    ? Math.max(visibleChatCount, selectedNonPinnedIndex + 1)
    : visibleChatCount;
  const grouped = useMemo(() => groupChats(nonPinnedChats), [nonPinnedChats]);
  const visibleGrouped = useMemo(() => {
    let remaining = effectiveVisibleCount;
    const limited: GroupedChats[] = [];
    for (const group of grouped) {
      if (remaining <= 0) break;
      const chatsForGroup = group.chats.slice(0, remaining);
      if (chatsForGroup.length > 0) {
        limited.push({
          heading: group.heading,
          chats: chatsForGroup,
        });
        remaining -= chatsForGroup.length;
      }
    }
    return limited;
  }, [effectiveVisibleCount, grouped]);
  const totalUnpinnedChats = nonPinnedChats.length;
  const hasMoreChats = effectiveVisibleCount < totalUnpinnedChats;

  useEffect(() => {
    if (!hasMoreChats) return;
    const root = chatScrollRef.current;
    const target = chatLoadSentinelRef.current;
    if (!root || !target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleChatCount((prev) => Math.min(totalUnpinnedChats, prev + 10));
      },
      {
        root,
        rootMargin: "180px 0px",
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreChats, totalUnpinnedChats]);

  if (collapsed) {
    return (
      <div className="chat-sidebar flex h-full flex-col border-r border-[var(--border-default)] px-2.5 py-3">
        <div className="mb-4 flex items-center justify-between gap-1">
          {orgLogoUrl && orgLogoUrl.trim() ? (
            <Image src={orgLogoUrl} alt={orgName ?? "Org"} width={34} height={34} className="h-8.5 w-8.5 rounded-xl object-cover" />
          ) : (
            <div className="inline-flex h-8.5 w-8.5 items-center justify-center rounded-xl bg-[var(--gradient-brand)] text-white">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-8.5 w-8.5" onClick={onToggleCollapse} aria-label="Expand sidebar">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div
          className="mx-auto flex w-full flex-col items-center gap-1"
          onMouseEnter={() => setNavExpandedByHover(true)}
          onMouseLeave={() => setNavExpandedByHover(false)}
        >
          {primaryNavVisibleItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`inline-flex h-9.5 w-9.5 items-center justify-center rounded-xl transition ${
                  active
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
          {hiddenPrimaryCount > 0 && !showPrimaryNav ? (
            <span
              aria-hidden
              className="inline-flex h-9.5 w-9.5 items-center justify-center rounded-xl text-[var(--text-secondary)]"
              title={`Hover to show ${hiddenPrimaryCount} more pages`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          ) : null}
          {secondaryNavItems.length > 0 ? (
            <>
              <span
                aria-hidden
                className={`inline-flex h-9.5 w-9.5 items-center justify-center rounded-xl transition ${
                  showSecondaryNav
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </span>
              {showSecondaryNav &&
                secondaryNavItems.map((item) => {
                  const Icon = item.icon;
                  const active = isNavActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      className={`inline-flex h-9.5 w-9.5 items-center justify-center rounded-xl transition ${
                        active
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                  );
                })}
            </>
          ) : null}
        </div>

        <div className="mt-auto flex flex-col items-center gap-2">
          <div className="mb-1 flex flex-col items-center gap-1 text-[10px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1" title="Current streak">
              <Flame className="h-3 w-3 text-[var(--accent-coral)]" />
              {gamification.currentStreak}
            </span>
            <span className="inline-flex items-center gap-1" title="Total XP">
              <Star className="h-3 w-3 text-[var(--warning)]" />
              {gamification.totalXp}
            </span>
          </div>
          <Button type="button" variant="secondary" size="icon" className="h-9.5 w-9.5" onClick={onNewChat} aria-label="New chat">
            <Plus className="h-4 w-4" />
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
          <ThemeToggle />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-sidebar flex h-full flex-col border-r border-[var(--border-default)] p-3">
      <div className="mb-3 flex items-center gap-2.5">
        {orgLogoUrl && orgLogoUrl.trim() ? (
          <Image
            src={orgLogoUrl}
            alt={orgName ?? "Org"}
            width={32}
            height={32}
            className="h-8 w-8 rounded-xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_82%,transparent)] object-cover shadow-[var(--shadow-soft)]"
          />
        ) : (
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--gradient-brand)] text-white shadow-[var(--shadow-soft)]">
            <Sparkles className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-none">{orgName ?? "AI School"}</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">studio</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Collapse sidebar">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <div
        className="mb-3 space-y-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5"
        onMouseEnter={() => setNavExpandedByHover(true)}
        onMouseLeave={() => setNavExpandedByHover(false)}
      >
        <div className="mb-1 flex items-center justify-between px-2.5 pt-0.5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">Pages</p>
          <button
            type="button"
            onClick={() => setReorderPrimaryNav((prev) => !prev)}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${
              reorderPrimaryNav
                ? "border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--text-primary)]"
                : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            }`}
            title="Reorder visible pages"
            aria-label={reorderPrimaryNav ? "Finish page reorder" : "Reorder pages"}
          >
            {reorderPrimaryNav ? "Done" : "Reorder"}
          </button>
        </div>

        {primaryNavVisibleItems.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(pathname, item.href);
          const index = orderedPrimaryNavItems.findIndex((navItem) => navItem.href === item.href);
          return (
            <div key={item.href} className="flex items-center gap-1">
              <Link
                href={item.href}
                title={item.label}
                onClick={() => {
                  // navigation handled by Link
                }}
                className={`flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
                  active
                    ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
              {reorderPrimaryNav ? (
                <div className="mr-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => movePrimaryNavItem(item.href, "up")}
                    disabled={index <= 0}
                    aria-label={`Move ${item.label} up`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={() => movePrimaryNavItem(item.href, "down")}
                    disabled={index === -1 || index >= orderedPrimaryNavItems.length - 1}
                    aria-label={`Move ${item.label} down`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {hiddenPrimaryCount > 0 && !showPrimaryNav ? (
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Hover for {hiddenPrimaryCount} more page{hiddenPrimaryCount === 1 ? "" : "s"}
          </div>
        ) : null}
        {secondaryNavItems.length > 0 ? (
          <div className="mt-1 border-t border-[var(--border-default)] pt-1">
            <div className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              {showSecondaryNav ? "More pages" : "Hover for more pages"}
            </div>
            {showSecondaryNav &&
              secondaryNavItems.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    className={`ml-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
                      active
                        ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
          </div>
        ) : null}
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
            className="h-8 w-full rounded-lg border border-transparent bg-[var(--bg-primary)] pl-8 pr-2.5 text-xs text-[var(--text-primary)] transition placeholder:text-[var(--text-secondary)] focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0"
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
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      active
                        ? "border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[var(--bg-primary)]"
                        : "border-transparent hover:border-[var(--border-default)] hover:bg-[var(--bg-primary)]"
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
                        className={`w-full rounded-xl border px-2.5 py-1.5 text-left transition ${
                          active
                            ? "border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[var(--bg-primary)]"
                            : "border-transparent hover:border-[var(--border-default)] hover:bg-[var(--bg-primary)]"
                        }`}
                      >
                        {editingChatId === chat._id ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              onRenameChat(chat._id, editingValue);
                              setEditingChatId(null);
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
                              {isStreaming ? (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent-cyan)]" />
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
                              {isStreaming ? (
                                <span className="text-[var(--accent-cyan)]">Generating...</span>
                              ) : (
                                secondaryLine
                              )}
                              {hasDraftIndicator && !isStreaming && <span className="ml-1.5 text-[var(--text-tertiary)]">Draft</span>}
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
        {hasMoreChats ? <div ref={chatLoadSentinelRef} className="h-8" aria-hidden /> : null}
      </div>

      <div className="mt-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-soft)]">
        {userMemorySummary && (
          <p className="mb-3 line-clamp-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2 text-[11px] text-[var(--text-secondary)]">
            {userMemorySummary}
          </p>
        )}

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2">
            <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              <Flame className="h-3.5 w-3.5 text-[var(--accent-coral)]" />
              Streak
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
              {gamification.currentStreak.toLocaleString()} day{gamification.currentStreak === 1 ? "" : "s"}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-2">
            <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              <Star className="h-3.5 w-3.5 text-[var(--warning)]" />
              XP
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
              {gamification.totalXp.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          <span>Usage</span>
          <span>{usagePercent}%</span>
        </div>
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
          <div
            className="h-full min-w-[3px] rounded-full transition-all"
            style={{
              width: `${Math.max(usagePercent > 0 ? 3 : 0, usagePercent)}%`,
              background: "var(--gradient-brand)",
            }}
          />
        </div>
        <p className="mb-3 text-[11px] text-[var(--text-secondary)]">
          {usageStatus}
        </p>

        <div className="flex items-center gap-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer rounded-full">
                <Avatar>
                  <AvatarImage src={user?.imageUrl} alt={user?.fullName ?? "User"} />
                  <AvatarFallback>{initials(user?.fullName || user?.firstName || "User")}</AvatarFallback>
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
            <p className="truncate text-sm font-medium">{user?.fullName ?? user?.firstName ?? "Signed in user"}</p>
            <p className="truncate text-xs text-[var(--text-secondary)]">{role}</p>
          </div>
          <ThemeToggle />
          <Button type="button" variant="secondary" size="icon" onClick={onOpenSettings}>
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
