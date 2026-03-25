"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Bot, Download, Layers, LoaderCircle, Menu, MoreHorizontal, Search, Settings2, Square, WifiOff } from "lucide-react";
import { useKBar } from "kbar";
import { ContextualTip } from "@/components/ui/contextual-tip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type ChatHeaderProps = {
  title: string;
  agentLabel?: string;
  lastResponseAt?: number;
  sending: boolean;
  messageCount: number;
  compacting?: boolean;
  streamPhase?: string;
  onStop: () => void;
  onCompact?: () => void;
  onCompactWithDepth?: (keepLatestMessages: number) => void;
  onToggleMobileSidebar: () => void;
  onOpenSettings: () => void;
  onOpenOrchestration?: () => void;
  onNewChat: () => void;
  onExport: (format: "markdown" | "pdf" | "text") => void;
  showOrchestrationButton?: boolean;
  orchestrationActive?: boolean;
  settingsActive?: boolean;
  mobileUtilitySlot?: ReactNode;
  isOffline?: boolean;
};

const PHASE_CONFIG: Record<string, { label: string; color: string }> = {
  compacting:   { label: "compacting...",   color: "var(--text-tertiary)" },
  routing:      { label: "routing...",      color: "var(--accent-cyan)" },
  searching:    { label: "searching...",    color: "var(--accent-mint)" },
  thinking:     { label: "thinking...",     color: "var(--warning)" },
  generating:   { label: "generating...",   color: "var(--success)" },
  synthesizing: { label: "synthesizing...", color: "var(--accent-orange)" },
};

function StreamingIndicator({ phase, sending }: { phase?: string; sending: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [showDone, setShowDone] = useState(false);
  const startTimeRef = useRef<number>(0);
  const prevSendingRef = useRef(false);

  // Detect sending start/stop transitions
  useEffect(() => {
    if (sending && !prevSendingRef.current) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      setShowDone(false);
    }
    if (!sending && prevSendingRef.current) {
      setShowDone(true);
      const timer = setTimeout(() => setShowDone(false), 2000);
      prevSendingRef.current = sending;
      return () => clearTimeout(timer);
    }
    prevSendingRef.current = sending;
  }, [sending]);

  // Tick elapsed every second while active
  useEffect(() => {
    if (!sending) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sending]);

  if (!sending && !showDone) return null;

  if (showDone && !sending) {
    return (
      <div className="flex items-center gap-2 transition-opacity duration-500">
        <div className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
        <span className="text-xs text-[var(--success)]">done</span>
        {elapsed > 0 && <span className="text-[10px] text-[var(--text-tertiary)]">{elapsed}s</span>}
      </div>
    );
  }

  const config = PHASE_CONFIG[phase ?? ""] ?? { label: "generating...", color: "var(--success)" };

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: config.color }} />
      <span className="text-xs" style={{ color: config.color }}>{config.label}</span>
      {elapsed > 0 && <span className="text-[10px] text-[var(--text-tertiary)]">{elapsed}s</span>}
    </div>
  );
}

function formatRelativeTime(timestamp: number) {
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ChatHeader({
  title,
  agentLabel,
  lastResponseAt,
  sending,
  messageCount,
  compacting = false,
  streamPhase,
  onStop,
  onCompact,
  onToggleMobileSidebar,
  onOpenSettings,
  onOpenOrchestration,
  onNewChat,
  onExport,
  showOrchestrationButton = false,
  orchestrationActive = false,
  settingsActive = false,
  mobileUtilitySlot,
  isOffline = false,
}: ChatHeaderProps) {
  const { query } = useKBar();
  const responseAgo = lastResponseAt
    ? formatRelativeTime(lastResponseAt)
    : undefined;
  const showCompactTip = messageCount > 8;

  return (
    <header className="sticky top-0 z-20 relative after:content-[''] after:absolute after:top-[56px] after:left-0 after:right-0 after:h-px after:bg-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-primary)_92%,transparent)] backdrop-blur-xl min-h-[var(--header-height,56px)]">
      <div className="flex h-[var(--header-height,56px)] items-center px-3 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-[680px] xl:max-w-[780px] 2xl:max-w-[860px] items-center gap-2">
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
              <StreamingIndicator phase={streamPhase} sending={sending} />
              {!sending && (
                <>
                  {agentLabel && <span className="truncate">{agentLabel}</span>}
                  {responseAgo && (
                    <>
                      <span className="h-1 w-1 rounded-full bg-[var(--border-default)]" />
                      <span className="truncate">Updated {responseAgo}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="relative flex items-center gap-1.5">
            {isOffline && (
              <div className="flex items-center gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--warning)_15%,var(--bg-secondary))] px-2 py-0.5 text-[10px] text-[var(--warning)]">
                <WifiOff size={12} />
                <span>Offline</span>
              </div>
            )}
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
            {showOrchestrationButton && onOpenOrchestration ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-9 w-9"
                onClick={onOpenOrchestration}
                aria-label="Open orchestration panel"
                title="Open orchestration panel"
              >
                <Bot className={`h-3.5 w-3.5 ${orchestrationActive ? "text-[var(--brand-primary)]" : ""}`} />
              </Button>
            ) : null}
            <div className="flex items-center gap-1.5">
              {sending && (
                <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5" onClick={onStop}>
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-9 w-9"
                onClick={onOpenSettings}
                data-tour="settings-trigger"
                aria-label="Open settings"
                title="Open settings"
              >
                <Settings2 className={`h-3.5 w-3.5 ${settingsActive ? "text-[var(--brand-primary)]" : ""}`} />
              </Button>
            </div>
            {!sending && messageCount > 8 && onCompact ? (
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
            {mobileUtilitySlot ? (
              <div className="md:hidden">
                {mobileUtilitySlot}
              </div>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="icon" className="h-9 w-9" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!sending ? (
                  <DropdownMenuItem onSelect={onNewChat}>
                    New chat
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => onExport("markdown")}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExport("pdf")}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export PDF
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExport("text")}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Export Plain text (.txt)
                </DropdownMenuItem>
                {!sending && onCompact ? (
                  <DropdownMenuItem onSelect={onCompact} disabled={compacting}>
                    <Layers className="mr-2 h-3.5 w-3.5" />
                    Compact now
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {showCompactTip ? (
          <div className="mx-auto mt-2 w-full max-w-5xl">
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
