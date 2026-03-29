/**
 * Drag Handle ProseMirror Plugin for Tiptap
 * Shows a grip icon on hover near top-level block nodes for drag-to-reorder.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const dragHandleKey = new PluginKey("dragHandle");

function createDragHandleElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "editor-drag-handle";
  el.setAttribute("draggable", "true");
  el.setAttribute("data-drag-handle", "");
  el.contentEditable = "false";
  // 6-dot grip icon via SVG
  el.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <circle cx="4.5" cy="3" r="1.2"/><circle cx="9.5" cy="3" r="1.2"/>
    <circle cx="4.5" cy="7" r="1.2"/><circle cx="9.5" cy="7" r="1.2"/>
    <circle cx="4.5" cy="11" r="1.2"/><circle cx="9.5" cy="11" r="1.2"/>
  </svg>`;
  return el;
}

function findTopLevelBlockAt(view: EditorView, y: number): { pos: number; node: Node; dom: HTMLElement } | null {
  const doc = view.state.doc;
  let result: { pos: number; node: Node; dom: HTMLElement } | null = null;

  doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    if (!dom || !dom.getBoundingClientRect) return;
    const rect = dom.getBoundingClientRect();
    if (y >= rect.top - 4 && y <= rect.bottom + 4) {
      result = { pos: offset, node: node as unknown as Node, dom };
    }
  });

  return result;
}

export const DragHandle = Extension.create({
  name: "dragHandle",

  addProseMirrorPlugins() {
    const handle = createDragHandleElement();
    let currentPos: number | null = null;
    let visible = false;

    const showHandle = (view: EditorView, dom: HTMLElement) => {
      const editorRect = view.dom.getBoundingClientRect();
      const blockRect = dom.getBoundingClientRect();
      handle.style.top = `${blockRect.top - editorRect.top + view.dom.scrollTop + 2}px`;
      handle.style.left = "-28px";
      handle.style.opacity = "1";
      visible = true;
    };

    const hideHandle = () => {
      handle.style.opacity = "0";
      visible = false;
      currentPos = null;
    };

    return [
      new Plugin({
        key: dragHandleKey,
        view(editorView) {
          handle.style.opacity = "0";
          // Attach to the editor's parent wrapper (for relative positioning)
          const wrapper = editorView.dom.parentElement;
          if (wrapper) {
            wrapper.style.position = "relative";
            wrapper.appendChild(handle);
          }

          handle.addEventListener("dragstart", (e) => {
            if (currentPos === null) return;
            const { state } = editorView;
            const resolved = state.doc.resolve(currentPos);
            const selection = state.tr.setSelection(
              // Use NodeSelection for dragging
              new (require("@tiptap/pm/state").NodeSelection)(resolved),
            );
            editorView.dispatch(selection);
            // Set drag data
            e.dataTransfer?.setDragImage(handle, 0, 0);
          });

          return {
            destroy() {
              handle.remove();
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              const block = findTopLevelBlockAt(view, event.clientY);
              if (block) {
                currentPos = block.pos;
                showHandle(view, block.dom);
              } else {
                hideHandle();
              }
              return false;
            },
            mouseleave() {
              // Delay hide so user can reach the handle
              setTimeout(() => {
                if (!handle.matches(":hover")) hideHandle();
              }, 200);
              return false;
            },
          },
        },
      }),
    ];
  },
});
