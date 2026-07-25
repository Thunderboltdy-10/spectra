import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

type Block = { pos: number; size: number; element: HTMLElement };

const GUTTER_GAP = 8;
const CONTROL_WIDTH = 48;

function blocks(view: EditorView): Block[] {
  const result: Block[] = [];
  view.state.doc.forEach((node, pos) => {
    const element = view.nodeDOM(pos) as HTMLElement | null;
    if (element?.getBoundingClientRect) result.push({ pos, size: node.nodeSize, element });
  });
  return result;
}

function firstLineTop(element: HTMLElement, fallbackTop: number) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = [...range.getClientRects()].filter((rect) => rect.height > 0 && rect.width > 0);
  if (rects.length === 0) return fallbackTop;
  return Math.min(...rects.map((rect) => rect.top));
}

function controls() {
  const root = document.createElement("div");
  root.className = "editor-gutter-controls";
  root.contentEditable = "false";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "editor-gutter-button";
  add.setAttribute("aria-label", "Add block below");
  add.textContent = "+";
  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "editor-gutter-button editor-gutter-grip";
  grip.setAttribute("aria-label", "Drag block");
  grip.setAttribute("draggable", "true");
  grip.textContent = "⠿";
  root.append(add, grip);
  return { root, add, grip };
}

export const DragHandle = Extension.create({
  name: "spectraDragHandle",
  addProseMirrorPlugins() {
    const ui = controls();
    let active: Block | null = null;
    const hide = () => {
      ui.root.dataset.visible = "false";
      ui.root.style.opacity = "0";
      active = null;
    };
    return [
      new Plugin({
        key: new PluginKey("spectraDragHandle"),
        view: (view) => {
          const wrapper =
            (view.dom.closest(".tiptap-root") as HTMLElement | null) ??
            view.dom.parentElement;
          wrapper?.appendChild(ui.root);
          hide();
          const add = () => {
            if (!active) return;
            const paragraph = view.state.schema.nodes.paragraph?.create(
              null,
              view.state.schema.text("/"),
            );
            if (!paragraph) return;
            const position = active.pos + active.size;
            const transaction = view.state.tr.insert(position, paragraph);
            transaction.setSelection(
              TextSelection.create(transaction.doc, position + 2),
            );
            view.dispatch(transaction.scrollIntoView());
            view.focus();
          };
          const drag = (event: DragEvent) => {
            if (!active) return;
            view.dispatch(
              view.state.tr.setSelection(
                NodeSelection.create(view.state.doc, active.pos),
              ),
            );
            event.dataTransfer?.setData("text/plain", "spectra-block");
          };
          ui.add.addEventListener("click", add);
          ui.grip.addEventListener("dragstart", drag);
          const positionForBlock = (block: Block) => {
            const wrapper =
              (view.dom.closest(".tiptap-root") as HTMLElement | null) ??
              view.dom.parentElement;
            if (!wrapper) return;
            const outer = wrapper.getBoundingClientRect();
            const rect = block.element.getBoundingClientRect();
            const lineTop = firstLineTop(block.element, rect.top);
            const controlHeight = ui.root.offsetHeight || 22;
            const top = lineTop - outer.top - (controlHeight - 22) / 2;
            const left = rect.left - outer.left - CONTROL_WIDTH - GUTTER_GAP;
            ui.root.style.top = `${Math.max(0, top)}px`;
            ui.root.style.left = `${Math.max(0, left)}px`;
            ui.root.style.opacity = "1";
            ui.root.dataset.visible = "true";
          };
          const onScroll = () => {
            if (!active) return;
            positionForBlock(active);
          };
          view.dom.addEventListener("scroll", onScroll, { passive: true });
          const scrollParent = view.dom.closest(
            ".spectra-document-editor, .tiptap-root, [data-document-scroll]",
          );
          scrollParent?.addEventListener("scroll", onScroll, { passive: true });
          return {
            destroy: () => {
              ui.add.removeEventListener("click", add);
              ui.grip.removeEventListener("dragstart", drag);
              view.dom.removeEventListener("scroll", onScroll);
              scrollParent?.removeEventListener("scroll", onScroll);
              ui.root.remove();
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              const wrapper =
                (view.dom.closest(".tiptap-root") as HTMLElement | null) ??
                view.dom.parentElement;
              const block = blocks(view).find(({ element }) => {
                const rect = element.getBoundingClientRect();
                return event.clientY >= rect.top && event.clientY <= rect.bottom;
              });
              if (!block || !wrapper) {
                if (!ui.root.matches(":hover")) hide();
                return false;
              }
              active = block;
              const outer = wrapper.getBoundingClientRect();
              const rect = block.element.getBoundingClientRect();
              const lineTop = firstLineTop(block.element, rect.top);
              const controlHeight = ui.root.offsetHeight || 22;
              const top = lineTop - outer.top - (controlHeight - 22) / 2;
              const left = rect.left - outer.left - CONTROL_WIDTH - GUTTER_GAP;
              ui.root.style.top = `${Math.max(0, top)}px`;
              ui.root.style.left = `${Math.max(0, left)}px`;
              ui.root.style.opacity = "1";
              ui.root.dataset.visible = "true";
              return false;
            },
            mouseleave() {
              if (!ui.root.matches(":hover")) hide();
              return false;
            },
            scroll(view) {
              if (!active) return false;
              const wrapper =
                (view.dom.closest(".tiptap-root") as HTMLElement | null) ??
                view.dom.parentElement;
              if (!wrapper) return false;
              const outer = wrapper.getBoundingClientRect();
              const rect = active.element.getBoundingClientRect();
              const lineTop = firstLineTop(active.element, rect.top);
              const controlHeight = ui.root.offsetHeight || 22;
              const top = lineTop - outer.top - (controlHeight - 22) / 2;
              const left = rect.left - outer.left - CONTROL_WIDTH - GUTTER_GAP;
              ui.root.style.top = `${Math.max(0, top)}px`;
              ui.root.style.left = `${Math.max(0, left)}px`;
              return false;
            },
          },
        },
      }),
    ];
  },
});
