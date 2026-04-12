"use client";

import {
  CalendarCheck,
  Code2,
  FileText,
  Image,
  Layers,
  MessageSquare,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionMenuItemId =
  | "workspace"
  | "ai"
  | "note"
  | "code"
  | "visual"
  | "task"
  | "thread";

export type ActionMenuItem = {
  id: ActionMenuItemId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  secondary?: boolean;
};

/**
 * Single source of truth for create/action menu items.
 * Used by both the command bar + button and canvas right-click menu.
 */
export const ACTION_MENU_ITEMS: ActionMenuItem[] = [
  { id: "workspace", label: "New Workspace", icon: Layers, shortcut: "W" },
  { id: "ai", label: "Ask AI", icon: Wand2, shortcut: "A" },
  { id: "note", label: "Note", icon: FileText, shortcut: "N" },
  { id: "code", label: "Code", icon: Code2, shortcut: "C" },
  { id: "visual", label: "Visual", icon: Image, shortcut: "V" },
  { id: "task", label: "Task", icon: CalendarCheck, shortcut: "T" },
  { id: "thread", label: "Thread", icon: MessageSquare, secondary: true },
];

type ActionMenuProps = {
  items?: ActionMenuItem[];
  highlightedIdx?: number;
  onAction: (id: ActionMenuItemId) => void;
  onHover?: (idx: number) => void;
  className?: string;
};

/**
 * Shared action menu content rendered inside context menus and command bar.
 * Provides a consistent look and behavior for creation actions.
 */
export function ActionMenuContent({
  items = ACTION_MENU_ITEMS,
  highlightedIdx = -1,
  onAction,
  onHover,
  className,
}: ActionMenuProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        Create new
      </div>
      {items.map((item, idx) => {
        const showDivider =
          item.secondary && idx > 0 && !items[idx - 1].secondary;
        return (
          <div key={item.id}>
            {showDivider && (
              <div className="my-0.5 h-px bg-[var(--border-default)]/25" />
            )}
            <button
              type="button"
              onClick={() => onAction(item.id)}
              onMouseEnter={() => onHover?.(idx)}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors w-full text-left",
                highlightedIdx === idx
                  ? item.id === "ai"
                    ? "bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--accent-cyan)]"
                    : "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                  : item.id === "ai"
                    ? "text-[var(--accent-cyan)]/80"
                    : item.secondary
                      ? "text-[var(--text-tertiary)]"
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
          </div>
        );
      })}
    </div>
  );
}
