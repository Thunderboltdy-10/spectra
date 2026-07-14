"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { AlertTriangle, CheckSquare, Code, Heading1, Heading2, Heading3, ImageIcon, Info, Lightbulb, List, ListOrdered, Minus, Quote, Sigma, Table } from "lucide-react";
import type { SlashCommandItem } from "./slash-command-extension";

const icons = { H1: Heading1, H2: Heading2, H3: Heading3, list: List, "list-ordered": ListOrdered, "check-square": CheckSquare, quote: Quote, code: Code, sigma: Sigma, minus: Minus, table: Table, image: ImageIcon, info: Info, "alert-triangle": AlertTriangle, lightbulb: Lightbulb };

export type SlashCommandListRef = { onKeyDown: (props: { event: KeyboardEvent }) => boolean };

export const SlashCommandList = forwardRef<SlashCommandListRef, { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void }>(function SlashCommandList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [items]);
  const select = useCallback((index: number) => { const item = items[index]; if (item) command(item); }, [command, items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") { setSelectedIndex((index) => items.length ? (index - 1 + items.length) % items.length : 0); return true; }
      if (event.key === "ArrowDown") { setSelectedIndex((index) => items.length ? (index + 1) % items.length : 0); return true; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); select(selectedIndex); return true; }
      return false;
    },
  }), [items.length, select, selectedIndex]);

  if (!items.length) return <div className="slash-command-dropdown"><p className="px-3 py-2 text-xs text-[var(--text-tertiary)]">No matching blocks</p></div>;
  const sections = Array.from(Map.groupBy(items, (item) => item.section));
  return <div className="slash-command-dropdown" role="listbox" aria-label="Insert a block">
    {sections.map(([section, commands]) => <div key={section}>
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{section}</p>
      {commands.map((item) => {
        const index = items.indexOf(item);
        const Icon = icons[item.icon as keyof typeof icons];
        return <button key={item.id} type="button" role="option" aria-selected={index === selectedIndex} className={`slash-command-item ${index === selectedIndex ? "is-selected" : ""}`} onMouseEnter={() => setSelectedIndex(index)} onClick={() => select(index)}>
          <span className="slash-command-icon">{Icon ? <Icon className="h-4 w-4" /> : item.icon}</span>
          <span className="min-w-0 text-left"><span className="block text-sm font-medium text-[var(--text-primary)]">{item.label}</span><span className="block truncate text-[11px] text-[var(--text-tertiary)]">{item.description}</span></span>
        </button>;
      })}
    </div>)}
  </div>;
});
