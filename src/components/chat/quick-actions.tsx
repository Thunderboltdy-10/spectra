"use client";

import {
  Ellipsis,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  Layers,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getModeConfig } from "@/lib/modes";
import { cn } from "@/lib/utils";
import type { AutoPreference } from "@/hooks/use-chat-state";
import type { StudyMode } from "@/types";

type QuickActionsProps = {
  mode: StudyMode;
  nextMode: StudyMode;
  autoSearch: AutoPreference;
  compacting: boolean;
  compactDisabled?: boolean;
  onCycleMode: () => void;
  onToggleSearch: () => void;
  onCompact: () => void;
  onNewChat: () => void;
  onToggleZen: () => void;
};

function SearchStatus({ value }: { value: AutoPreference }) {
  if (value === "off") return "Off";
  if (value === "on") return "On";
  return "Auto";
}

export function QuickActions({
  mode,
  nextMode,
  autoSearch,
  compacting,
  compactDisabled = false,
  onCycleMode,
  onToggleSearch,
  onCompact,
  onNewChat,
  onToggleZen,
}: QuickActionsProps) {
  const modeConfig = getModeConfig(mode);
  const nextModeLabel = getModeConfig(nextMode).label;
  const searchIsOn = autoSearch !== "off";
  const pillClass =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition";

  return (
    <div className="border-t border-[var(--border-default)] bg-[var(--bg-primary)]/70 px-3 py-2 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2">
        <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
          <button
            type="button"
            onClick={onCycleMode}
            className={cn(
              pillClass,
              "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
            style={{
              borderColor: `color-mix(in oklab, ${modeConfig.color} 45%, var(--border-default))`,
              background: `color-mix(in oklab, ${modeConfig.color} 12%, var(--bg-elevated))`,
            }}
            title={`Switch mode (next: ${nextModeLabel})`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Mode: {modeConfig.label}
          </button>

          <button
            type="button"
            onClick={onToggleSearch}
            className={cn(
              pillClass,
              "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
            title="Toggle web search on/off"
          >
            <Search className="h-3.5 w-3.5" />
            Search: <SearchStatus value={autoSearch} />
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                searchIsOn ? "bg-[var(--success)]" : "bg-[var(--text-tertiary)]",
              )}
            />
          </button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={onCompact}
            disabled={compactDisabled || compacting}
            title="Compact conversation context"
          >
            {compacting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
            {compacting ? "Compacting..." : "Compact"}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={onNewChat}
            title="Start a new chat"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={onToggleZen}
            title="Toggle zen mode"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Zen
          </Button>
        </div>

        <div className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-8 w-8 rounded-full"
                aria-label="Quick actions"
              >
                <Ellipsis className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={onCycleMode}>
                Switch mode ({modeConfig.label} to {nextModeLabel})
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleSearch}>
                Toggle search ({searchIsOn ? "On" : "Off"})
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onCompact} disabled={compactDisabled || compacting}>
                {compacting ? "Compacting..." : "Compact conversation"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewChat}>New chat</DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleZen}>Toggle zen mode</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p className="hidden text-[11px] text-[var(--text-secondary)] sm:block">
          Quick actions
        </p>
      </div>
    </div>
  );
}
