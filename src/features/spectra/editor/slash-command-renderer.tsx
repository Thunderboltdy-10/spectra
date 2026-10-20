import { createRoot, type Root } from "react-dom/client";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { SlashCommandItem } from "./slash-command-extension";
import { SlashCommandList, type SlashCommandListRef } from "./slash-command-list";

const GAP = 6;
const EDGE = 12;

export function createSlashCommandRenderer() {
  let portal: HTMLDivElement | null = null;
  let root: Root | null = null;
  let list: SlashCommandListRef | null = null;

  // The menu hangs under the caret and turns to open upward when the line is
  // near the bottom of the window, so it never covers the "/" being typed.
  const place = (props: SuggestionProps<SlashCommandItem>) => {
    const rect = props.clientRect?.();
    if (!portal || !rect) return;
    const { width, height } = portal.getBoundingClientRect();
    const room = window.innerHeight - rect.bottom - EDGE;
    const above = height > room && rect.top - EDGE > room;
    portal.toggleAttribute("data-above", above);
    portal.style.left = `${Math.max(EDGE, Math.min(rect.left - 10, window.innerWidth - width - EDGE))}px`;
    portal.style.top = `${above ? Math.max(EDGE, rect.top - GAP - height) : rect.bottom + GAP}px`;
  };
  const render = (props: SuggestionProps<SlashCommandItem>) => {
    root?.render(<SlashCommandList ref={(value) => { list = value; }} items={props.items} command={props.command} query={props.query} />);
    // Placed now with the last size, then again once the new rows have laid
    // out; the menu fades in over that frame, so the correction never shows.
    place(props);
    requestAnimationFrame(() => place(props));
  };
  const destroy = () => {
    portal?.remove();
    portal = null;
    const activeRoot = root;
    root = null;
    list = null;
    queueMicrotask(() => activeRoot?.unmount());
  };

  return {
    onStart(props: SuggestionProps<SlashCommandItem>) {
      portal = document.createElement("div");
      portal.className = "slash-command-portal";
      Object.assign(portal.style, { position: "fixed", zIndex: "9999" });
      document.body.appendChild(portal);
      root = createRoot(portal);
      render(props);
    },
    onUpdate: render,
    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === "Escape") { destroy(); return true; }
      return list?.onKeyDown(props) ?? false;
    },
    onExit: destroy,
  };
}
