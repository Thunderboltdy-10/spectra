"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, Clock3, Download, Layers, LoaderCircle, Maximize2, Menu, Minimize2, Plus, Search, Settings2, Square } from "lucide-react";
import { useKBar } from "kbar";
import { NotificationBell } from "@/components/notification-bell";
import { ContextualTip } from "@/components/ui/contextual-tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const StudyTimer = dynamic(
  () => import("@/components/study-timer").then((module) => module.StudyTimer),
  { ssr: false },
);

type ChatHeaderProps = {
  title: string;
  chatId?: string;
  agentLabel?: string;
  lastModelUsed?: string;
  sending: boolean;
  messageCount: number;
  compacting?: boolean;
  isZenMode?: boolean;
  onStop: () => void;
  onCompact?: () => void;
  onToggleMobileSidebar: () => void;
  onToggleZen?: () => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
  onExport: (format: "markdown" | "pdf" | "text") => void;
};

export function ChatHeader({
  title,
  chatId,
  agentLabel,
  lastModelUsed,
  sending,
  messageCount,
  compacting = false,
  isZenMode = false,
  onStop,
  onCompact,
  onToggleMobileSidebar,
  onToggleZen,
  onOpenSettings,
  onNewChat,
  onExport,
}: ChatHeaderProps) {
  const { query } = useKBar();
  const [studyTimerOpen, setStudyTimerOpen] = useState(false);
  const modelLabel = lastModelUsed
    ? (lastModelUsed.split("/").pop() ?? lastModelUsed)
        .replace(/:free$/i, "")
        .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
        .trim()
    : undefined;
  const showCompactTip = messageCount > 20;

  if (isZenMode) {
    return (
      <header className="sticky top-0 z-20 border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_94%,transparent)] backdrop-blur-xl">
        <div className="px-3 py-2.5 sm:px-6 lg:px-10">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2">
            <h1
              title={title}
              className="line-clamp-1 min-w-0 flex-1 text-pretty font-display text-lg leading-tight sm:text-xl"
            >
              {title}
            </h1>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onToggleZen}
              className="h-9 gap-1.5"
              aria-label="Exit zen mode"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              Exit Zen
            </Button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_92%,transparent)] backdrop-blur-xl">
      <div className="px-3 py-2.5 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="md:hidden"
            onClick={onToggleMobileSidebar}
            aria-label="Open sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>

          <div className="min-w-0 flex-1">
            <h1
              title={title}
              className="line-clamp-2 text-pretty font-display text-lg leading-tight sm:text-xl"
            >
              {title}
            </h1>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              {agentLabel && <span className="truncate">{agentLabel}</span>}
              {lastModelUsed && (
                <>
                  <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
                  <span className="truncate">{modelLabel}</span>
                </>
              )}
            </div>
          </div>

          <div className="relative flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => query.toggle()}
              aria-label="Open command palette (Cmd+K or Ctrl+K)"
              title="Open command palette (Cmd+K / Ctrl+K)"
            >
              <Search className="h-4 w-4" />
            </Button>
            <NotificationBell />
            {sending ? (
              <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5" onClick={onStop}>
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 gap-1.5"
                onClick={onOpenSettings}
                data-tour="settings-trigger"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Settings
              </Button>
            )}
            {!sending && messageCount > 15 && onCompact ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 gap-1.5"
                onClick={onCompact}
                disabled={compacting}
              >
                {compacting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                {compacting ? "Compacting..." : "Compact"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setStudyTimerOpen((prev) => !prev)}
              aria-label="Toggle study timer"
              title="Pomodoro study timer"
            >
              <Clock3 className="h-3.5 w-3.5" />
              Timer
            </Button>
            {onToggleZen ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 gap-1.5"
                onClick={onToggleZen}
                aria-label="Toggle zen mode"
                title="Toggle zen mode (Ctrl/Cmd+Shift+Z)"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Zen
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  Export conversation
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onExport("markdown")}>Markdown (.md)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExport("pdf")}>PDF</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExport("text")}>Plain text (.txt)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="secondary" size="icon" onClick={onNewChat} aria-label="New chat">
              <Plus className="h-4 w-4" />
            </Button>

            {studyTimerOpen ? (
              <StudyTimer
                chatId={chatId}
                className="absolute right-0 top-12 z-40"
                onClose={() => setStudyTimerOpen(false)}
              />
            ) : null}
          </div>
        </div>

        {showCompactTip ? (
          <div className="mx-auto mt-2 w-full max-w-6xl">
            <ContextualTip
              tipId="chat-header-compact-tip"
              message="Use Compact to reduce context length."
              actionLabel={!sending && onCompact && !compacting ? "Compact now" : undefined}
              onAction={!sending && onCompact && !compacting ? onCompact : undefined}
            />
          </div>
        ) : null}
      </div>
    </header>
  );
}
