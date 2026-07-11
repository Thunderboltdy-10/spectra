/**
 * Drag Handle + Gutter Controls for Tiptap
 * Shows a left gutter on hover for top-level block nodes.
 */

import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const dragHandleKey = new PluginKey("dragHandle");

type TopLevelBlock = {
  pos: number;
  node: unknown & { nodeSize: number };
  dom: HTMLElement;
  index: number;
};

function createButton(label: string, icon: string, className: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  return button;
}

function createControlsElement() {
  const container = document.createElement("div");
  container.className = "editor-gutter-controls";
  container.contentEditable = "false";

  const plusButton = createButton(
    "Add block below",
    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 2.5V11.5"/><path d="M2.5 7H11.5"/>
    </svg>`,
    "editor-gutter-button",
  );
  const grip = createButton(
    "Drag block",
    `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="4.5" cy="3" r="1.1"/><circle cx="9.5" cy="3" r="1.1"/>
      <circle cx="4.5" cy="7" r="1.1"/><circle cx="9.5" cy="7" r="1.1"/>
      <circle cx="4.5" cy="11" r="1.1"/><circle cx="9.5" cy="11" r="1.1"/>
    </svg>`,
    "editor-gutter-button editor-gutter-grip",
  );

  grip.setAttribute("draggable", "true");
  grip.setAttribute("data-drag-handle", "");

  container.append(plusButton, grip);
  return { container, plusButton, grip };
}

function getTopLevelBlocks(view: EditorView): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  view.state.doc.forEach((node, offset, index) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    if (!dom || !dom.getBoundingClientRect) return;
    blocks.push({
      pos: offset,
      node: node as TopLevelBlock["node"],
      dom,
      index,
    });
  });
  return blocks;
}

function findTopLevelBlockAt(view: EditorView, y: number): TopLevelBlock | null {
  const blocks = getTopLevelBlocks(view);
  return blocks.find((block) => {
    const rect = block.dom.getBoundingClientRect();
    return y >= rect.top - 4 && y <= rect.bottom + 4;
  }) ?? null;
}

function insertSlashBelow(view: EditorView, currentPos: number) {
  const blocks = getTopLevelBlocks(view);
  const current = blocks.find((block) => block.pos === currentPos);
  const paragraph = view.state.schema.nodes.paragraph?.create(
    null,
    view.state.schema.text("/"),
  );
  if (!current || !paragraph) return;

  const insertPos = current.pos + current.node.nodeSize;
  const tr = view.state.tr
    .insert(insertPos, paragraph)
    .setSelection(TextSelection.create(view.state.tr.doc, insertPos + 2))
    .scrollIntoView();
  view.dispatch(tr);
  view.focus();
}

export const DragHandle = Extension.create({
  name: "dragHandle",

  addProseMirrorPlugins() {
    const { container, plusButton, grip } = createControlsElement();
    let currentBlock: TopLevelBlock | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const clearHideTimer = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    const showControls = (view: EditorView, block: TopLevelBlock) => {
      const wrapper = view.dom.closest(".tiptap-root") as HTMLElement | null ?? view.dom.parentElement;
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const blockRect = block.dom.getBoundingClientRect();
      currentBlock = block;

      // Determine the ProseMirror content left edge (where text starts).
      // blockRect.left is viewport-relative; wrapperRect.left is the tiptap-root left.
      // Both are viewport-relative so the difference is the offset within the wrapper.
      const contentLeft = blockRect.left - wrapperRect.left;

      // Vertically align to the rendered block, not document scroll position. Both
      // rects are viewport-relative, so this stays stable inside split panels and
      // nested scroll containers without double-counting scrollTop.
      const top = Math.max(0, blockRect.top - wrapperRect.top + 3);

      // Buttons: 2 × 22px + 4px gap = 48px. Place 4px to the left of where text starts.
      // ProseMirror has padding-left: 3.5rem (56px), so 48px + 4px gap = 52px fits in gutter.
      const left = Math.max(0, contentLeft - 52);

      container.style.top = `${top}px`;
      container.style.left = `${left}px`;
      container.style.opacity = "1";
      container.dataset.visible = "true";
    };

    const hideControls = () => {
      currentBlock = null;
      container.style.opacity = "0";
      container.dataset.visible = "false";
    };

    return [
      new Plugin({
        key: dragHandleKey,
        view(editorView) {
          container.style.opacity = "0";
          container.dataset.visible = "false";
          const wrapper = editorView.dom.closest(".tiptap-root") as HTMLElement | null ?? editorView.dom.parentElement;
          if (wrapper) {
            if (getComputedStyle(wrapper).position === "static") {
              wrapper.style.position = "relative";
            }
            wrapper.appendChild(container);
          }

          plusButton.addEventListener("click", (event) => {
            event.preventDefault();
            if (currentBlock) insertSlashBelow(editorView, currentBlock.pos);
          });

          grip.addEventListener("dragstart", (event) => {
            if (!currentBlock) return;
            const resolved = editorView.state.doc.resolve(currentBlock.pos);
            const selection = editorView.state.tr.setSelection(new NodeSelection(resolved));
            editorView.dispatch(selection);
            event.dataTransfer?.setDragImage(container, 0, 0);
          });

          container.addEventListener("mouseenter", clearHideTimer);
          container.addEventListener("mouseleave", () => {
            hideTimer = setTimeout(() => {
              if (!container.matches(":hover")) hideControls();
            }, 120);
          });

          return {
            destroy() {
              container.remove();
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              clearHideTimer();
              const block = findTopLevelBlockAt(view, event.clientY);
              if (block) {
                showControls(view, block);
              } else if (!container.matches(":hover")) {
                hideControls();
              }
              return false;
            },
            mouseleave() {
              clearHideTimer();
              hideTimer = setTimeout(() => {
                if (!container.matches(":hover")) hideControls();
              }, 120);
              return false;
            },
          },
        },
      }),
    ];
  },
});
