"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BookMarked, ImageIcon, Info, Lightbulb, Link2, Table } from "lucide-react";
import type { SlashCommandItem } from "./slash-command-extension";

/*
 * A type case, not a launcher. Each row's mark is a small specimen of what the
 * row makes — a bullet, a numeral, a quote rule, a heading set at its size — so
 * the menu reads like the page it is about to change. Objects that are not
 * type (a table, a picture) keep a quiet line icon. No tiles.
 */
const glyph = (text: string, kind?: string) => <span className="slash-command-glyph" data-kind={kind}>{text}</span>;
const rule = (kind: string) => <span className="slash-command-rule" data-kind={kind} />;
const icon = (Icon: typeof Table) => <Icon className="size-[15px]" strokeWidth={1.6} aria-hidden />;

const marks: Record<string, ReactNode> = {
  H1: glyph("H1", "heading"),
  H2: glyph("H2", "heading"),
  H3: glyph("H3", "heading"),
  text: glyph("Aa"),
  list: glyph("•", "bullet"),
  "list-ordered": glyph("1."),
  "check-square": rule("task"),
  quote: rule("quote"),
  code: glyph("{ }", "code"),
  sigma: glyph("∑", "math"),
  minus: rule("divider"),
  columns: rule("section"),
  table: icon(Table),
  image: icon(ImageIcon),
  link: icon(Link2),
  book: icon(BookMarked),
  info: icon(Info),
  "alert-triangle": icon(AlertTriangle),
  lightbulb: icon(Lightbulb),
};

export type SlashCommandListRef = { onKeyDown: (props: { event: KeyboardEvent }) => boolean };

export const SlashCommandList = forwardRef<SlashCommandListRef, { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void; query?: string }>(function SlashCommandList({ items, command, query = "" }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setSelectedIndex(Math.max(0, items.findIndex((item) => !item.disabledReason))), [items]);
  // The keyboard can walk past the fold; the chosen row follows it into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  // Arrow keys skip what cannot run. A disabled row is still listed — the
  // sentence under the list is the answer to "why can't I do this here?" — but
  // it never becomes the selection, so Enter always does something.
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

  if (!items.length) return <div className="slash-command-dropdown"><p className="slash-command-empty">Nothing by that name. Keep typing to write it as text.</p></div>;
  // Browsing shows the case in its drawers; searching shows the best answers
  // first, which a grouping would scatter.
  const sections: [string, SlashCommandItem[]][] = query.trim() ? [["Matches", items]] : Array.from(Map.groupBy(items, (item) => item.section));
  const chosen = items[selectedIndex];
  return <div className="slash-command-dropdown">
    <div ref={listRef} className="slash-command-scroll" role="listbox" aria-label="Insert a block">
      {sections.map(([section, commands]) => <div key={section} role="group" aria-label={section} className="slash-command-section">
        {query.trim() ? null : <p aria-hidden>{section}</p>}
        {commands.map((item) => {
          const index = items.indexOf(item);
          const disabled = Boolean(item.disabledReason);
          return <button key={item.id} type="button" role="option" data-index={index} data-command={item.id} aria-selected={index === selectedIndex} aria-disabled={disabled || undefined} data-disabled={disabled || undefined} title={item.disabledReason ?? undefined} className={`slash-command-item ${index === selectedIndex ? "is-selected" : ""}`} onMouseEnter={() => { if (!disabled) setSelectedIndex(index); }} onMouseDown={(event) => event.preventDefault()} onClick={() => select(index)}>
            <span className="slash-command-mark" aria-hidden>{marks[item.icon] ?? glyph(item.icon)}</span>
            <span className="slash-command-label">{item.label}</span>
            {item.markdown ? <kbd className="slash-command-markdown" aria-label={`or type ${item.markdown}`}>{item.markdown}</kbd> : null}
          </button>;
        })}
      </div>)}
    </div>
    {chosen ? <p className="slash-command-gist" data-disabled={Boolean(chosen.disabledReason) || undefined} aria-live="polite">{chosen.disabledReason ?? chosen.description}</p> : null}
  </div>;
});
