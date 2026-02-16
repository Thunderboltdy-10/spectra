"use client";

import { Download, FileText, Menu, Plus, Settings2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

type ChatHeaderProps = {
  title: string;
  agentLabel?: string;
  lastModelUsed?: string;
  sending: boolean;
  onStop: () => void;
  onToggleMobileSidebar: () => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
  onExportMarkdown: () => void;
  onExportPdf: () => void;
};

export function ChatHeader({
  title,
  agentLabel,
  lastModelUsed,
  sending,
  onStop,
  onToggleMobileSidebar,
  onOpenSettings,
  onNewChat,
  onExportMarkdown,
  onExportPdf,
}: ChatHeaderProps) {
  const modelLabel = lastModelUsed
    ? (lastModelUsed.split("/").pop() ?? lastModelUsed)
        .replace(/:free$/i, "")
        .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
        .trim()
    : undefined;

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

          <div className="flex items-center gap-1.5">
            {sending ? (
              <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5" onClick={onStop}>
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5" onClick={onOpenSettings}>
                <Settings2 className="h-3.5 w-3.5" />
                Settings
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5" onClick={onExportMarkdown}>
              <FileText className="h-3.5 w-3.5" />
              MD
            </Button>
            <Button type="button" variant="secondary" size="sm" className="h-9 gap-1.5" onClick={onExportPdf}>
              <Download className="h-3.5 w-3.5" />
              PDF
            </Button>
            <Button type="button" variant="secondary" size="icon" onClick={onNewChat} aria-label="New chat">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
