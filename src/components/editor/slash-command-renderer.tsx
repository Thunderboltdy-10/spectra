/**
 * Suggestion renderer for slash commands — bridges @tiptap/suggestion with React.
 * Uses DOM portal approach (no tippy dependency needed).
 */

import { createRoot } from "react-dom/client";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import type { SlashCommandItem } from "./slash-command-extension";
import { SlashCommandList, type SlashCommandListRef } from "./slash-command-list";

export function createSlashCommandRenderer() {
  let popup: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;
  let componentRef: SlashCommandListRef | null = null;

  return {
    onStart(props: SuggestionProps<SlashCommandItem>) {
      popup = document.createElement("div");
      popup.className = "slash-command-portal";
      document.body.appendChild(popup);

      root = createRoot(popup);

      const rect = props.clientRect?.();
      if (rect && popup) {
        popup.style.position = "fixed";
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
        popup.style.zIndex = "9999";
      }

      root.render(
        <SlashCommandList
          items={props.items}
          command={props.command}
          ref={(ref) => {
            componentRef = ref;
          }}
        />,
      );
    },

    onUpdate(props: SuggestionProps<SlashCommandItem>) {
      if (!root || !popup) return;

      const rect = props.clientRect?.();
      if (rect) {
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
      }

      root.render(
        <SlashCommandList
          items={props.items}
          command={props.command}
          ref={(ref) => {
            componentRef = ref;
          }}
        />,
      );
    },

    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === "Escape") {
        popup?.remove();
        popup = null;
        const currentRoot = root;
        root = null;
        componentRef = null;
        queueMicrotask(() => currentRoot?.unmount());
        return true;
      }
      return componentRef?.onKeyDown(props) ?? false;
    },

    onExit() {
      popup?.remove();
      popup = null;
      const currentRoot = root;
      root = null;
      componentRef = null;
      queueMicrotask(() => currentRoot?.unmount());
    },
  };
}
