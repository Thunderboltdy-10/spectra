"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import {
  CalendarCheck,
  Code2,
  FileText,
  Image,
  MessageSquare,
  Plus,
  Square,
  Wand2,
  Search,
  ArrowUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MenuItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
};

const MENU_ITEMS: MenuItem[] = [
  { id: "note", label: "Note", icon: FileText, shortcut: "N" },
  { id: "code", label: "Code", icon: Code2, shortcut: "C" },
  { id: "visual", label: "Visual", icon: Image, shortcut: "V" },
  { id: "task", label: "Task", icon: CalendarCheck, shortcut: "T" },
  { id: "thread", label: "Thread", icon: MessageSquare },
  { id: "ai", label: "Create with AI", icon: Wand2, shortcut: "A" },
];

type CommandBarProps = {
  workspaceName?: string;
  onSendMessage: (message: string) => void;
  onStopStreaming?: () => void;
  onCreateNote: () => void;
  onCreateCode: () => void;
  onCreateVisual: () => void;
  onCreateTask: () => void;
  onCreateThread: () => void;
  onCreateWithAi: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  className?: string;
};

export function CommandBar({
  workspaceName,
  onSendMessage,
  onStopStreaming,
  onCreateNote,
  onCreateCode,
  onCreateVisual,
  onCreateTask,
  onCreateThread,
  onCreateWithAi,
  isStreaming = false,
  disabled = false,
  className,
}: CommandBarProps) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleMenuAction = useCallback((id: string) => {
    setMenuOpen(false);
    setHighlightedIdx(-1);
    switch (id) {
      case "note": onCreateNote(); break;
      case "code": onCreateCode(); break;
      case "visual": onCreateVisual(); break;
      case "task": onCreateTask(); break;
      case "thread": onCreateThread(); break;
      case "ai":
        onCreateWithAi();
        inputRef.current?.focus();
        break;
    }
  }, [onCreateCode, onCreateNote, onCreateTask, onCreateThread, onCreateVisual, onCreateWithAi]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSendMessage(trimmed);
    setValue("");
  }, [disabled, onSendMessage, value]);

  // Menu keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIdx((prev) => (prev + 1) % MENU_ITEMS.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIdx((prev) => (prev - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
      } else if (e.key === "Enter" && highlightedIdx >= 0) {
        e.preventDefault();
        handleMenuAction(MENU_ITEMS[highlightedIdx].id);
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

  // Global keyboard shortcut: Cmd/Ctrl+K to focus
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  return (
    <div className={cn("fixed bottom-6 left-1/2 z-50 -translate-x-1/2", className)}>
      <div
        className={cn(
          "relative flex h-12 w-[min(560px,calc(100vw-200px))] min-w-[420px] items-center gap-2 rounded-[22px] border pl-2 pr-2.5",
          "border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/95 backdrop-blur-xl",
          "transition-all duration-200 ease-[var(--ease-standard)]",
          focused
            ? "shadow-[0_16px_44px_-14px_rgba(8,22,40,0.28),0_4px_16px_-10px_rgba(8,22,40,0.18)] border-[color-mix(in_oklab,var(--accent-cyan)_30%,var(--border-default))]"
            : "shadow-[0_10px_32px_-14px_rgba(8,22,40,0.20),0_4px_12px_-10px_rgba(8,22,40,0.14)]",
        )}
      >
        {/* Create menu button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setMenuOpen((open) => !open);
              setHighlightedIdx(-1);
            }}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
              menuOpen
                ? "rotate-45 bg-[var(--accent-cyan)]/12 text-[var(--accent-cyan)]"
                : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
            )}
          >
            <Plus className="h-4 w-4" />
          </button>

          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => { setMenuOpen(false); setHighlightedIdx(-1); }} />
              <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 flex min-w-[196px] flex-col gap-0.5 rounded-2xl border border-[var(--border-default)]/50 bg-[var(--bg-elevated)]/98 p-1.5 shadow-[0_18px_44px_-18px_rgba(8,22,40,0.30)] backdrop-blur-xl">
                {MENU_ITEMS.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleMenuAction(item.id)}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors",
                      highlightedIdx === idx
                        ? item.id === "ai"
                          ? "bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--accent-cyan)]"
                          : "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                        : item.id === "ai"
                          ? "text-[var(--accent-cyan)]/80"
                          : "text-[var(--text-secondary)]",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.shortcut && (
                      <span className="text-[10px] font-medium text-[var(--text-tertiary)]/50">
                        {item.shortcut}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* Workspace scope badge */}
        {workspaceName ? (
          <div className="flex items-center gap-1 rounded-lg border border-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_6%,var(--bg-secondary))] px-2 py-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-cyan)]">{workspaceName}</span>
          </div>
        ) : null}

        {/* Input */}
        <div className="flex flex-1 items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] opacity-40" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask AI, search, or create..."
            disabled={disabled && !isStreaming}
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
        </div>

        {/* Keyboard hint */}
        {!focused && !value && (
          <span className="mr-1 text-[10px] text-[var(--text-tertiary)]/40 font-medium">
            \u2318K
          </span>
        )}

        {/* Send / stop button */}
        {isStreaming ? (
          <button
            type="button"
            onClick={onStopStreaming}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-coral)]/12 text-[var(--accent-coral)] transition-colors hover:bg-[var(--accent-coral)]/20"
          >
            <Square className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150",
              value.trim()
                ? "bg-[var(--accent-cyan)] text-white shadow-[0_4px_10px_-6px_rgba(14,142,232,0.45)]"
                : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)]",
            )}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
