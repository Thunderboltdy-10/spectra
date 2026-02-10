"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { formatDistanceToNow } from "date-fns";
import {
  BarChart3,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  LayoutDashboard,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
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
import { ALL_MODES, getModeConfig } from "@/lib/modes";
import type { StudyMode } from "@/types";
import type { Chat, UserSpending } from "@/hooks/use-chat-state";

type GroupedChats = {
  heading: string;
  chats: Chat[];
};

type ChatSidebarProps = {
  chats: Chat[];
  selectedChatId: string;
  search: string;
  mode: StudyMode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSearchChange: (value: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onOpenSettings: () => void;
  onModeChange: (mode: StudyMode) => void;
  onPinChat?: (chatId: string) => void;
  role: "student" | "teacher" | "admin";
  userSpending: UserSpending | null;
  userMemorySummary?: string;
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

export function ChatSidebar({
  chats,
  selectedChatId,
  search,
  mode,
  collapsed,
  onToggleCollapse,
  onSearchChange,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onOpenSettings,
  onModeChange,
  onPinChat,
  role,
  userSpending,
  userMemorySummary,
}: ChatSidebarProps) {
  const pathname = usePathname();
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [pinnedChats] = useState<Set<string>>(new Set());
  const [showModeMenu, setShowModeMenu] = useState(false);

  const grouped = useMemo(() => groupChats(chats), [chats]);
  const pinned = useMemo(() => chats.filter((chat) => pinnedChats.has(chat._id)), [chats, pinnedChats]);
  const modeConfig = getModeConfig(mode);
  const spendRatio = userSpending
    ? Math.min(userSpending.totalCostCents / Math.max(userSpending.totalCostCents, 1200), 1)
    : 0;

  const navItems = [
    { href: "/", label: "Chat", icon: Sparkles },
    { href: "/agents", label: "Agents", icon: Bot },
    { href: "/models", label: "Models", icon: Compass },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ...(role === "admin" ? [{ href: "/admin", label: "Admin", icon: LayoutDashboard }] : []),
  ];

  if (collapsed) {
    return (
      <div className="chat-sidebar flex h-full flex-col border-r border-[var(--border-default)] px-2 py-3">
        <div className="mb-4 flex items-center justify-between">
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--gradient-brand)] text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Expand sidebar">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition ${
                  active
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <Icon className="h-4 w-4" />
              </Link>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col items-center gap-2">
          <Button type="button" variant="secondary" size="icon" onClick={onNewChat} aria-label="New chat">
            <Plus className="h-4 w-4" />
          </Button>
          <ThemeToggle />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-sidebar flex h-full flex-col border-r border-[var(--border-default)] p-3">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--gradient-brand)] text-white shadow-[var(--shadow-soft)]">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-none">AI School</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">studio</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onToggleCollapse} aria-label="Collapse sidebar">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-3 flex items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${
                active
                  ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Icon className="h-4 w-4" />
            </Link>
          );
        })}
      </div>

      <Button className="mb-3 w-full justify-start gap-2 rounded-xl" onClick={onNewChat}>
        <Plus className="h-4 w-4" />
        New chat
      </Button>

      <div className="mb-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2">
        <div className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowModeMenu((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-xs font-medium text-[var(--text-primary)]"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: modeConfig.color }} />
              <span>{modeConfig.label}</span>
            </button>
            {showModeMenu && (
              <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-soft)]">
                {ALL_MODES.map((item) => {
                  const config = getModeConfig(item.key);
                  const isActive = item.key === mode;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        onModeChange(item.key);
                        setShowModeMenu(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: config.color }} />
                      <span className="flex-1 truncate">{config.label}</span>
                      {isActive ? <Check className="h-3 w-3 text-[var(--accent)]" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="mb-3 relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--text-secondary)]" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search chats"
            className="h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]"
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
                const promptPreview = (chat.latestUserPrompt || chat.title || "New chat").trim();
                const chatModeConfig = getModeConfig(chat.mode);
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
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: chatModeConfig.color }} />
                      <p className="truncate text-sm font-medium">{promptPreview}</p>
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
          {grouped.map((group) => (
            <div key={group.heading}>
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-secondary)]">
                {group.heading}
              </p>
              <div className="space-y-1">
                {group.chats.map((chat) => {
                  const active = selectedChatId === chat._id;
                  const promptPreview = (chat.latestUserPrompt || chat.title || "New chat").trim();
                  const secondaryLine =
                    chat.latestUserPrompt && chat.title && chat.latestUserPrompt !== chat.title
                      ? chat.title
                      : formatDistanceToNow(chat.updatedAt, { addSuffix: true });
                  const chatModeConfig = getModeConfig(chat.mode);
                  return (
                    <div key={chat._id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onSelectChat(chat._id)}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${
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
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: chatModeConfig.color }}
                              />
                              <p className="truncate text-sm font-medium">{promptPreview}</p>
                            </div>
                            <p className="truncate pl-3.5 text-xs text-[var(--text-secondary)]">{secondaryLine}</p>
                          </>
                        )}
                      </button>
                      {editingChatId !== chat._id && (
                        <div className="pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
                          {onPinChat && (
                            <button
                              type="button"
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
                              onClick={() => onPinChat(chat._id)}
                              aria-label="Pin chat"
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
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
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
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
      </div>

      <div className="mt-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-soft)]">
        {userMemorySummary && (
          <p className="mb-3 line-clamp-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2 text-[11px] text-[var(--text-secondary)]">
            {userMemorySummary}
          </p>
        )}

        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
          <div
            className="h-full rounded-full bg-[var(--gradient-brand)] transition-all"
            style={{ width: `${Math.max(2, spendRatio * 100)}%` }}
          />
        </div>

        <div className="flex items-center gap-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-full">
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
