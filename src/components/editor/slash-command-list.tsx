"use client";

/**
 * Slash Command Dropdown — renders the filtered list of commands
 * when the user types "/" in the editor.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from "react";
import type { SlashCommandItem } from "./slash-command-extension";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  Table,
  ImageIcon,
  Info,
  AlertTriangle,
  Lightbulb,
  Bold,
  Italic,
  Underline,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  H1: Heading1,
  H2: Heading2,
  H3: Heading3,
  list: List,
  "list-ordered": ListOrdered,
  "check-square": CheckSquare,
  quote: Quote,
  code: Code,
  minus: Minus,
  table: Table,
  image: ImageIcon,
  info: Info,
  "alert-triangle": AlertTriangle,
  lightbulb: Lightbulb,
  bold: Bold,
  italic: Italic,
  underline: Underline,
};

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export const SlashCommandList = forwardRef<
  SlashCommandListRef,
  SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command(item);
    },
    [items, command],
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="slash-command-dropdown">
        <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
          No matching commands
        </div>
      </div>
    );
  }

  // Group items by section
  const sections = new Map<string, SlashCommandItem[]>();
  for (const item of items) {
    const section = item.section || "Other";
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(item);
  }

  const indexedSections = Array.from(sections.entries()).map(([section, sectionItems]) => ({
    section,
    items: sectionItems.map((item) => ({
      item,
      index: items.findIndex((candidate) => candidate.id === item.id),
    })),
  }));

  return (
    <div className="slash-command-dropdown">
      {indexedSections.map(({ section, items: indexedItems }) => (
        <div key={section}>
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            {section}
          </div>
          {indexedItems.map(({ item, index }) => {
            const Icon = ICON_MAP[item.icon];
            return (
              <button
                key={item.id}
                type="button"
                className={`slash-command-item ${index === selectedIndex ? "is-selected" : ""}`}
                onClick={() => selectItem(index)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="slash-command-icon">
                  {Icon ? <Icon className="w-4 h-4" /> : <span className="text-xs font-mono">{item.icon}</span>}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-[var(--text-primary)] leading-tight">
                    {item.label}
                  </span>
                  <span className="block text-[11px] text-[var(--text-tertiary)] leading-tight">
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});
