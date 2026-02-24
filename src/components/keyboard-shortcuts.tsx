"use client";

import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Shortcut {
  keys: string[];
  description: string;
  context: "global" | "composer" | "navigation";
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["⌘", "K"], description: "Open command palette", context: "global" },
  { keys: ["⌘", "Enter"], description: "Send message", context: "composer" },
  { keys: ["Shift", "Enter"], description: "New line", context: "composer" },
  { keys: ["Escape"], description: "Close modals/sidebar", context: "global" },
  { keys: ["↑"], description: "Edit last message", context: "composer" },
  { keys: ["/"], description: "Focus search", context: "global" },
];

function ShortcutKey({ children }: { children: string }) {
  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  
  let display = children;
  if (children === "⌘" && !isMac) display = "Ctrl";
  
  return (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 text-[11px] font-medium text-[var(--text-secondary)] shadow-sm">
      {display}
    </kbd>
  );
}

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 gap-1.5 text-[11px] text-[var(--text-secondary)]"
      >
        <Keyboard className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Shortcuts</span>
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)] backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Keyboard className="h-4 w-4" />
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
          {/* Global shortcuts */}
          <div className="mb-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Global
            </h3>
            <div className="space-y-2">
              {SHORTCUTS.filter(s => s.context === "global").map((shortcut) => (
                <div key={shortcut.description} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-primary)]">{shortcut.description}</span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <ShortcutKey key={key}>{key}</ShortcutKey>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Composer shortcuts */}
          <div className="mb-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              When typing
            </h3>
            <div className="space-y-2">
              {SHORTCUTS.filter(s => s.context === "composer").map((shortcut) => (
                <div key={shortcut.description} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-primary)]">{shortcut.description}</span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <ShortcutKey key={key}>{key}</ShortcutKey>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--border-default)] px-4 py-3">
          <p className="text-center text-[11px] text-[var(--text-secondary)]">
            Press <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1 py-0.5">?</kbd> anytime to show this help
          </p>
        </div>
      </div>
    </div>
  );
}

export function ShortcutsButton() {
  return <KeyboardShortcutsHelp />;
}

type KeyboardShortcutsRegistrarProps = {
  onEscape?: () => void;
};

export function KeyboardShortcutsRegistrar({ onEscape }: KeyboardShortcutsRegistrarProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onEscape?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape]);

  return null;
}
