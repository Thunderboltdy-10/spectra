import { createRoot, type Root } from "react-dom/client";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import type { SlashCommandItem } from "./slash-command-extension";
import { SlashCommandList, type SlashCommandListRef } from "./slash-command-list";

export function createSlashCommandRenderer() {
  let portal: HTMLDivElement | null = null;
  let root: Root | null = null;
  let list: SlashCommandListRef | null = null;

  const place = (props: SuggestionProps<SlashCommandItem>) => {
    const rect = props.clientRect?.();
    if (!portal || !rect) return;
    portal.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
    portal.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 420)}px`;
  };
  const render = (props: SuggestionProps<SlashCommandItem>) => {
    place(props);
    root?.render(<SlashCommandList ref={(value) => { list = value; }} items={props.items} command={props.command} />);
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
