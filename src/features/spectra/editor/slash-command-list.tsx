"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { AlertTriangle, BookMarked, CheckSquare, Code, Columns3, Heading1, Heading2, Heading3, ImageIcon, Info, Lightbulb, Link2, List, ListOrdered, Minus, Quote, Sigma, Table, Text } from "lucide-react";
import type { SlashCommandItem } from "./slash-command-extension";

const icons = { H1: Heading1, H2: Heading2, H3: Heading3, text: Text, list: List, "list-ordered": ListOrdered, "check-square": CheckSquare, quote: Quote, code: Code, sigma: Sigma, minus: Minus, columns: Columns3, table: Table, image: ImageIcon, link: Link2, book: BookMarked, info: Info, "alert-triangle": AlertTriangle, lightbulb: Lightbulb };

export type SlashCommandListRef = { onKeyDown: (props: { event: KeyboardEvent }) => boolean };

export const SlashCommandList = forwardRef<SlashCommandListRef, { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void }>(function SlashCommandList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [items]);
  // Arrow keys skip what cannot run. A disabled row is still listed — the
  // sentence on it is the answer to "why can't I do this here?" — but it never
  // becomes the selection, so Enter always does something.
  const select = useCallback((index: number) => { const item = items[index]; if (item && !item.disabledReason) command(item); }, [command, items]);
  const step = useCallback((direction: number) => {
    setSelectedIndex((index) => {
      if (!items.length) return 0;
      for (let offset = 1; offset <= items.length; offset += 1) {
        const next = (index + direction * offset + items.length * offset) % items.length;
        if (!items[next]?.disabledReason) return next;
      }
      return index;
    });
  }, [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") { step(-1); return true; }
      if (event.key === "ArrowDown") { step(1); return true; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); select(selectedIndex); return true; }
      return false;
    },
  }), [select, selectedIndex, step]);

  if (!items.length) return <div className="slash-command-dropdown"><p className="px-3 py-2 text-xs text-[var(--text-tertiary)]">No matching blocks</p></div>;
  const sections = Array.from(Map.groupBy(items, (item) => item.section));
  return <div className="slash-command-dropdown" role="listbox" aria-label="Insert a block">
    {sections.map(([section, commands]) => <div key={section}>
      <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{section}</p>
      {commands.map((item) => {
        const index = items.indexOf(item);
        const Icon = icons[item.icon as keyof typeof icons];
        return <button key={item.id} type="button" role="option" aria-selected={index === selectedIndex} aria-disabled={Boolean(item.disabledReason) || undefined} data-disabled={Boolean(item.disabledReason) || undefined} title={item.disabledReason ?? undefined} className={`slash-command-item ${index === selectedIndex ? "is-selected" : ""}`} onMouseEnter={() => { if (!item.disabledReason) setSelectedIndex(index); }} onClick={() => select(index)}>
          <span className="slash-command-icon">{Icon ? <Icon className="h-4 w-4" /> : item.icon}</span>
          <span className="min-w-0 text-left"><span className="block text-sm font-medium text-[var(--text-primary)]">{item.label}</span><span className="block truncate text-[11px] text-[var(--text-tertiary)]">{item.disabledReason ?? item.description}</span></span>
        </button>;
      })}
    </div>)}
  </div>;
});
