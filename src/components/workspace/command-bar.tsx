"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import {
  Plus,
  Square,
  Search,
  ArrowUp,
  Zap,
  Layers,
  Sparkles,
  LayoutGrid,
  FileText,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ResultCardStack } from "@/components/workspace/result-card";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  ACTION_MENU_ITEMS,
  ActionMenuContent,
  type ActionMenuItemId,
} from "@/components/workspace/shared-action-menu";
import {
  CANONICAL_WORKSPACE_TYPE_META,
  type CanonicalWorkspaceType,
} from "@/lib/artifact-types";

/* --- Action Mode Detection --- */

type CommandMode = "action" | "search" | "create";

function detectMode(value: string): CommandMode {
  if (!value.trim()) return "action";
  if (value.startsWith("/") || value.startsWith(">")) return "create";
  if (value.startsWith("?") || value.startsWith("find ") || value.startsWith("search ")) return "search";
  return "action";
}

/* --- Mode Indicator --- */

function ModeIndicator({ mode }: { mode: CommandMode }) {
  if (mode === "action") return null;

  const config = {
    search: { icon: Search, label: "Search", color: "var(--accent-mint, #20b8b2)" },
    create: { icon: Layers, label: "Create", color: "var(--accent-orange, #f59f0a)" },
  }[mode];

  const Icon = config.icon;

  return (
    <div
      className="flex items-center gap-1 rounded-lg px-2 py-1 transition-all duration-200"
      style={{
        backgroundColor: `color-mix(in oklab, ${config.color} 8%, transparent)`,
      }}
    >
      <Icon className="h-3 w-3" style={{ color: config.color }} />
      <span
        className="text-[9px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: config.color }}
      >
        {config.label}
      </span>
    </div>
  );
}

/* --- Focus Context Tags (right side, beside send button) --- */

function FocusContextTags({ contextOverride }: { contextOverride?: { id: string; title: string; type: string } }) {
  const committedWorkspaceId = useWorkspaceStore((s) => s.committedWorkspaceId);
  const viewedWorkspaceId = useWorkspaceStore((s) => s.viewedWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);
  const deepEditTargets = useWorkspaceStore((s) => s.deepEditTargets);
  const setFocusedItem = useWorkspaceStore((s) => s.setFocusedItem);
  const closeDeepEdit = useWorkspaceStore((s) => s.closeDeepEdit);

  const effectiveWorkspaceId = committedWorkspaceId ?? viewedWorkspaceId;
  const workspace = workspaces.find((w) => w.id === effectiveWorkspaceId);
  const deepItem = deepEditTargets.length > 0 ? deepEditTargets[deepEditTargets.length - 1]?.item : null;
  const storeFocusedItem = deepItem ?? (focusedItemId ? workspaces.flatMap((w) => w.items).find((i) => i.id === focusedItemId) : null);
  
  const focusedItem = contextOverride 
    ? { id: contextOverride.id, title: contextOverride.title, itemType: contextOverride.type }
    : storeFocusedItem;

  if (!workspace && !focusedItem) return null;

  return (
    <div className="flex items-center gap-1 shrink-0">
      {workspace && (
        <div className={cn(
          "flex items-center gap-1 rounded-lg border border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/50 py-1",
          focusedItem ? "px-1.5" : "px-2 max-w-[100px]",
        )}>
          {focusedItem ? (
            <span className="text-[11px]">{workspace.emoji}</span>
          ) : (
            <>
              <LayoutGrid className="h-2.5 w-2.5 shrink-0 text-[var(--accent-cyan)]/60" />
              <span className="text-[9px] font-semibold text-[var(--text-secondary)] truncate">{workspace.emoji} {workspace.name}</span>
            </>
          )}
        </div>
      )}
      {focusedItem && (
        <button
          type="button"
          onClick={() => {
            setFocusedItem(null);
            closeDeepEdit(focusedItem.id);
          }}
          className="flex items-center gap-1 rounded-lg border border-[var(--border-default)]/25 bg-[var(--bg-secondary)]/50 px-2 py-1 max-w-[120px] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
        >
          {(() => {
            const meta = CANONICAL_WORKSPACE_TYPE_META[focusedItem.itemType as CanonicalWorkspaceType];
            const FocusIcon = meta?.icon ?? FileText;
            return <FocusIcon className="h-2.5 w-2.5 shrink-0" style={{ color: meta?.color ?? 'var(--text-tertiary)' }} />;
          })()}
          <span className="text-[9px] font-semibold text-[var(--text-secondary)] truncate">{focusedItem.title}</span>
        </button>
      )}
    </div>
  );
}

/* --- Suggestion Chips --- */

function SuggestionChips({
  workspaceName,
  hasContext,
  onSelect,
}: {
  workspaceName?: string;
  hasContext: boolean;
  onSelect: (text: string) => void;
}) {
  const suggestions = hasContext
    ? ["Summarize this", "Expand section", "Create flashcards", "Quiz me"]
    : workspaceName
      ? [`Review ${workspaceName}`, "Create a note", "Plan my study", "Search"]
      : ["Create a workspace", "Ask a question", "Plan my study"];

  return (
    <div className="flex items-center gap-1.5 px-1 overflow-x-auto scrollbar-none">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onSelect(s)}
          className="flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border-default)]/30 bg-[var(--bg-secondary)]/60 px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-all duration-150 hover:border-[color-mix(in_oklab,var(--accent-cyan)_20%,var(--border-default))] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        >
          <Sparkles className="h-2.5 w-2.5 opacity-50" />
          {s}
        </button>
      ))}
    </div>
  );
}

/* --- Command Bar Props --- */

type CommandBarProps = {
  workspaceName?: string;
  contextOverride?: { id: string; title: string; type: string };
  onSendMessage: (message: string) => void;
  onStopStreaming?: () => void;
  onCreateWorkspace?: () => void;
  onCreateNote: () => void;
  onCreateCode: () => void;
  onCreateVisual: () => void;
  onCreateTask: () => void;
  onCreateWidget?: () => void;
  onCreateThread: () => void;
  onCreateWithAi: () => void;
  onDismissResultCard?: (cardId: string) => void;
  onReopenResultCard?: (cardId: string) => void;
  isStreaming?: boolean;
  isProcessing?: boolean;
  disabled?: boolean;
  className?: string;
};

export function CommandBar({
  workspaceName,
  contextOverride,
  onSendMessage,
  onStopStreaming,
  onCreateWorkspace,
  onCreateNote,
  onCreateCode,
  onCreateVisual,
  onCreateTask,
  onCreateWidget,
  onCreateThread,
  onDismissResultCard,
  onReopenResultCard,
  onCreateWithAi,
  isStreaming = false,
  isProcessing = false,
  disabled = false,
  className,
}: CommandBarProps) {
  const resultCards = useWorkspaceStore((s) => s.resultCards);
  const storeDismissResultCard = useWorkspaceStore((s) => s.dismissResultCard);
  const storeReopenResultCard = useWorkspaceStore((s) => s.reopenResultCard);
  const dismissResultCard = onDismissResultCard ?? storeDismissResultCard;
  const reopenResultCard = onReopenResultCard ?? storeReopenResultCard;
  const focusedItemId = useWorkspaceStore((s) => s.focusedItemId);

  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mode = detectMode(value);
  const hasContextualItem = !!focusedItemId;

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setHighlightedIdx(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside, true);
    return () => document.removeEventListener("mousedown", handleClickOutside, true);
  }, [menuOpen]);

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [value, adjustTextareaHeight]);

  const handleMenuAction = useCallback((id: ActionMenuItemId) => {
    setMenuOpen(false);
    setHighlightedIdx(-1);
    switch (id) {
      case "workspace":
        onCreateWorkspace?.();
        break;
      case "note": onCreateNote(); break;
      case "code": onCreateCode(); break;
      case "visual": onCreateVisual(); break;
      case "task": onCreateTask(); break;
      case "widget": onCreateWidget?.(); break;
      case "thread": onCreateThread(); break;
      case "ai":
        onCreateWithAi();
        textareaRef.current?.focus();
        break;
    }
  }, [onCreateWorkspace, onCreateCode, onCreateNote, onCreateTask, onCreateWidget, onCreateThread, onCreateVisual, onCreateWithAi]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSendMessage(trimmed);
    setValue("");
  }, [disabled, onSendMessage, value]);

  const handleSuggestionSelect = useCallback((text: string) => {
    setValue(text);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIdx((prev) => (prev + 1) % ACTION_MENU_ITEMS.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIdx((prev) => (prev - 1 + ACTION_MENU_ITEMS.length) % ACTION_MENU_ITEMS.length);
      } else if (e.key === "Enter" && highlightedIdx >= 0) {
        e.preventDefault();
        handleMenuAction(ACTION_MENU_ITEMS[highlightedIdx].id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        setHighlightedIdx(-1);
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming && onStopStreaming) onStopStreaming();
        else handleSubmit();
      }
    }
  }, [menuOpen, highlightedIdx, handleMenuAction, isStreaming, onStopStreaming, handleSubmit]);

  // Global shortcut: Cmd+K
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  return (
    <div
      className={cn(
        "absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 transition-all duration-300",
        !focused && !value ? "w-[min(520px,calc(100vw-160px))]" : "w-[min(680px,calc(100vw-160px))]",
        className
      )}
    >
      {/* Result Card Stack */}
      <div className="w-full">
        <ResultCardStack
          cards={resultCards}
          onDismiss={dismissResultCard}
          onReopen={reopenResultCard}
          onCardClick={(card) => {
            if (card.targetId && card.targetId !== "workspace-chat") {
              window.dispatchEvent(
                new CustomEvent("workspace:open-item", { detail: { itemId: card.targetId, itemType: card.targetItemType } })
              );
            }
          }}
          maxVisible={3}
        />
      </div>

      {/* Suggestion chips */}
      {!value && focused && (
        <div className="mb-1">
          <SuggestionChips
            workspaceName={workspaceName}
            hasContext={hasContextualItem}
            onSelect={handleSuggestionSelect}
          />
        </div>
      )}

      {/* Main command input */}
      <div
        className={cn(
          "relative flex w-full min-w-[320px] items-end gap-2 rounded-[20px] border pl-2.5 pr-2.5 py-2",
          "border-[var(--border-default)]/40 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
          "transition-all duration-300 ease-[var(--ease-standard)]",
          focused
            ? "shadow-[0_18px_48px_-14px_rgba(8,22,40,0.26),0_4px_18px_-10px_rgba(8,22,40,0.16)] border-[color-mix(in_oklab,var(--accent-cyan)_25%,var(--border-default))]"
            : "shadow-[0_10px_32px_-14px_rgba(8,22,40,0.18),0_4px_12px_-10px_rgba(8,22,40,0.12)]",
          hasContextualItem && focused &&
            "border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))]",
        )}
      >
        {/* Create menu */}
        <div className="relative shrink-0 self-end" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              setMenuOpen((open) => !open);
              setHighlightedIdx(-1);
            }}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-[12px] transition-all duration-150",
              menuOpen
                ? "rotate-45 bg-[var(--accent-cyan)]/12 text-[var(--accent-cyan)]"
                : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            <Plus className="h-4.5 w-4.5" />
          </button>

          {menuOpen ? (
            <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 min-w-[200px] rounded-2xl border border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/98 p-1.5 shadow-[0_18px_44px_-18px_rgba(8,22,40,0.30)] backdrop-blur-xl">
              <ActionMenuContent
                highlightedIdx={highlightedIdx}
                onAction={handleMenuAction}
                onHover={setHighlightedIdx}
              />
            </div>
          ) : null}
        </div>

        {/* Mode indicator (left side of input) */}
        {mode !== "action" && (
          <div className="self-end mb-0.5">
            <ModeIndicator mode={mode} />
          </div>
        )}

        {/* Textarea */}
        <div className="flex min-w-0 flex-1 items-end gap-2">
          {isProcessing ? (
            <Loader2 className="mb-2.5 h-4 w-4 shrink-0 animate-spin text-[var(--accent-cyan)] opacity-70" />
          ) : !focused && !value ? (
            <Zap className="mb-2.5 h-4 w-4 shrink-0 text-[var(--accent-cyan)] opacity-40" />
          ) : (
            <Search className="mb-2.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)] opacity-40" />
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={hasContextualItem ? "Act on focused item\u2026" : "Ask AI, search, or create\u2026"}
            disabled={Boolean((disabled || isProcessing) && !isStreaming)}
            className="min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 text-[14px] leading-[1.5] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]/60"
            style={{ maxHeight: 120, minHeight: 24 }}
          />
        </div>

        {/* Right side: focus context tags + send/stop */}
        <div className="flex items-center gap-1.5 shrink-0 self-end">
          <FocusContextTags contextOverride={contextOverride} />
          {isStreaming ? (
            <button
              type="button"
              onClick={onStopStreaming}
              className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[var(--accent-coral)]/12 text-[var(--accent-coral)] transition-colors hover:bg-[var(--accent-coral)]/20"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={Boolean(!value.trim() || disabled)}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-[12px] transition-all duration-150",
                value.trim()
                  ? "bg-[var(--accent-cyan)] text-white shadow-[0_4px_12px_-6px_rgba(14,142,232,0.50)]"
                  : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)]",
              )}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
