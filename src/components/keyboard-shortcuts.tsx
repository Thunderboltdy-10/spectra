"use client";

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const OPEN_SHORTCUTS_EVENT = "spectra:open-keyboard-shortcuts";

export type Shortcut = {
  keys: string[];
  description: string;
  context: "global" | "composer";
};

/** The help surface and registrar share this list. Unwired commands stay out. */
export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ["Mod", "K"], description: "Open command bar", context: "global" },
  {
    keys: ["Mod", "Shift", "F"],
    description: "Focus sidebar search",
    context: "global",
  },
  { keys: ["Mod", "Shift", "N"], description: "New chat", context: "global" },
  {
    keys: ["Mod", "Shift", "S"],
    description: "Open settings",
    context: "global",
  },
  {
    keys: ["Mod", "/"],
    description: "Focus Spectra composer",
    context: "global",
  },
  { keys: ["?"], description: "Show keyboard shortcuts", context: "global" },
  { keys: ["Mod", "Enter"], description: "Send message", context: "composer" },
  { keys: ["Shift", "Enter"], description: "New line", context: "composer" },
] as const;

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.isContentEditable ||
    element?.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function ShortcutKey({ children }: { children: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isMac =
    mounted &&
    typeof navigator !== "undefined" &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  const display =
    children === "Mod" ? (mounted && !isMac ? "Ctrl" : "⌘") : children;

  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 text-micro font-medium text-[var(--text-secondary)] shadow-sm">
      {display}
    </kbd>
  );
}

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
        setOpen(true);
    };
    window.addEventListener(OPEN_SHORTCUTS_EVENT, show);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, show);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[480px] gap-0 p-0">
        <DialogHeader className="border-b border-[var(--border-subtle)] px-5 py-4 pr-14">
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" aria-hidden="true" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Shortcuts available in the current Spectra interface.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] overflow-y-auto px-5 py-4">
          {(["global", "composer"] as const).map((context) => (
            <section key={context} className="mb-5 last:mb-0">
              <h3 className="mb-2 text-micro font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {context === "global" ? "Anywhere" : "When typing"}
            </h3>
              <div className="space-y-1">
                {SHORTCUTS.filter(
                  (shortcut) => shortcut.context === context,
                ).map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex min-h-9 items-center justify-between gap-4 rounded-control px-2 text-caption hover:bg-[var(--bg-hover)]"
                  >
                    <span className="text-[var(--text-primary)]">
                      {shortcut.description}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <ShortcutKey key={key}>{key}</ShortcutKey>
                    ))}
                    </span>
                </div>
              ))}
            </div>
            </section>
              ))}
            </div>
      </DialogContent>
    </Dialog>
  );
}

export function ShortcutsButton({ compact = false }: { compact?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon" : "sm"}
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts"
      onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}
      className={compact ? "size-8 border-0" : undefined}
    >
      <Keyboard className="size-4" aria-hidden="true" />
      {compact ? null : "Shortcuts"}
    </Button>
  );
}

export type KeyboardShortcutsRegistrarProps = {
  onEscape?: () => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
  onFocusComposer?: () => void;
  onFocusSearch?: () => void;
};

export function KeyboardShortcutsRegistrar({
  onEscape,
  onNewChat,
  onOpenSettings,
  onFocusComposer,
  onFocusSearch,
}: KeyboardShortcutsRegistrarProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        onEscape?.();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        onFocusSearch?.();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        onNewChat?.();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onOpenSettings?.();
        return;
      }
      if (mod && !event.shiftKey && event.key === "/") {
        event.preventDefault();
        onFocusComposer?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape, onFocusComposer, onFocusSearch, onNewChat, onOpenSettings]);

  return null;
}
