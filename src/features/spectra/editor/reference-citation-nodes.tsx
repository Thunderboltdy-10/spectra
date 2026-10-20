import { Node, mergeAttributes } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import { useState } from "react";
import { ArtifactEmbedById } from "../components/artifact-embed-host";
import { EmbedStackTabs } from "../components/embed-stack-tabs";
import { spectraBus } from "../events";
import { entryOf, stackOf, stackedEmbedIds, withStacked, withoutStacked } from "./reference-stack";

export const WordCommentBoundary = Node.create({
  name: "wordCommentBoundary", group: "inline", inline: true, atom: true,
  selectable: false,
  addAttributes() { return { native: { default: null } }; },
  parseHTML() { return [{ tag: "span[data-word-comment]" }]; },
  renderHTML({ node }) {
    const item = node.attrs.native;
    return ["span", { "data-word-comment": item?.commentId, "aria-hidden": item?.boundary === "reference" ? undefined : "true", contenteditable: "false" }, item?.boundary === "reference" ? ["sup", { title: "Native Word comment" }, "Comment"] : ""];
  },
});

export const WordRevision = Node.create({
  name: "wordRevision", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return { native: { default: null } }; },
  parseHTML() { return [{ tag: "span[data-word-revision]" }]; },
  renderHTML({ node }) {
    const item = node.attrs.native;
    const deleted = item?.revisionKind === "del";
    const runs: Array<DOMOutputSpec | string> = (item?.content ?? [{ text: item?.text ?? "" }]).map((run: { text: string; bold?: boolean; italic?: boolean; underline?: boolean }) => {
      let content: DOMOutputSpec | string = run.text;
      if (run.bold) content = ["strong", {}, content];
      if (run.italic) content = ["em", {}, content];
      if (run.underline) content = ["u", {}, content];
      return content;
    });
    return ["span", { "data-word-revision": item?.revisionId, contenteditable: "false", "aria-label": `${deleted ? "Deleted" : "Inserted"} by ${item?.author || "Word"}`, title: `${deleted ? "Deletion" : "Insertion"}: ${item?.author || "Word"}` }, [deleted ? "del" : "ins", {}, ...runs]];
  },
});

function ReferenceNodeView({ node, selected, editor, getPos }: NodeViewProps) {
  const embedId =
    typeof node.attrs.embedId === "string" ? node.attrs.embedId : "";
  const ids = stackedEmbedIds(node.attrs);
  const [shownId, setShownId] = useState(embedId);
  const active = ids.includes(shownId) ? shownId : embedId;

  /** Rewrites this node in one step: new attributes, or gone when null, and anything to set after it. */
  const rewrite = (next: Record<string, unknown> | null, after?: Record<string, unknown>) => {
    const position = getPos();
    if (typeof position !== "number") return;
    editor
      .chain()
      .command(({ tr }) => {
        const current = tr.doc.nodeAt(position);
        if (!current) return false;
        if (after) tr.insert(position + current.nodeSize, current.type.create(after));
        if (next) tr.setNodeMarkup(position, undefined, next);
        else tr.delete(position, position + current.nodeSize);
        return true;
      })
      .run();
  };

  const addAnother = (anchor: Element | null) => {
    const box = anchor?.getBoundingClientRect();
    const hostWorkId = typeof node.attrs.containerId === "string" ? node.attrs.containerId : "";
    if (!hostWorkId) return;
    spectraBus.command("reference.add", {
      hostWorkId,
      at: box ? { x: box.right - 360, y: box.bottom } : undefined,
      stackOnto: embedId,
    });
  };
  const takeOut = () => {
    const entry = active === embedId ? entryOf(node.attrs) : stackOf(node.attrs).find((item) => item.embedId === active);
    const rest = withoutStacked(node.attrs, active);
    if (!entry || !rest) return;
    setShownId(String(rest.embedId));
    rewrite(rest, { ...node.attrs, ...entry, stack: null });
  };

  return (
    <NodeViewWrapper
      className="my-3"
      data-spectra-reference=""
      data-selected={selected || undefined}
      data-reference-id={embedId || undefined}
      data-stacked={ids.length > 1 || undefined}
      contentEditable={false}
    >
      {embedId ? (
        <ArtifactEmbedById
          key={active}
          embedId={active}
          onRemove={() => rewrite(withoutStacked(node.attrs, active))}
          editInPlace={editor.isEditable}
          tabs={ids.length > 1 ? <EmbedStackTabs embedIds={ids} active={active} onChoose={setShownId} /> : undefined}
          onStackAnother={editor.isEditable ? addAnother : undefined}
          onUnstack={editor.isEditable && ids.length > 1 ? takeOut : undefined}
        />
      ) : (
        <div className="rounded-card border border-dashed border-[var(--border-strong)] bg-[var(--bg-secondary)] px-4 py-3 text-micro text-[var(--text-secondary)]">
          This older reference is no longer linked to a live source. Add it
          again to restore live updates.
        </div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * One reference dropped on another joins it as a tab: the dragged card's
 * works ride on the card it was let go on, and the dragged node leaves.
 */
const stackOnDrop = new Plugin({
  props: {
    handleDrop(view, event, slice, moved) {
      const dragged = slice.content.childCount === 1 ? slice.content.firstChild : null;
      if (!moved || dragged?.type.name !== "spectraReference") return false;
      const targetId = (event.target as Element | null)?.closest?.("[data-spectra-reference]")?.getAttribute("data-reference-id");
      if (!targetId || targetId === dragged.attrs.embedId) return false;
      const positions = new Map<string, number>();
      view.state.doc.descendants((child, position) => {
        if (child.type.name === "spectraReference" && typeof child.attrs.embedId === "string")
          positions.set(child.attrs.embedId, position);
        return true;
      });
      const targetPos = positions.get(targetId);
      const draggedPos = positions.get(String(dragged.attrs.embedId));
      const target = targetPos === undefined ? null : view.state.doc.nodeAt(targetPos);
      const source = draggedPos === undefined ? null : view.state.doc.nodeAt(draggedPos);
      const first = entryOf(dragged.attrs);
      if (targetPos === undefined || draggedPos === undefined || !target || !source || !first) return false;
      const tr = view.state.tr.setNodeMarkup(targetPos, undefined, withStacked(target.attrs, [first, ...stackOf(dragged.attrs)]));
      tr.delete(tr.mapping.map(draggedPos), tr.mapping.map(draggedPos + source.nodeSize));
      view.dispatch(tr);
      event.preventDefault();
      return true;
    },
  },
});

export const SpectraReferenceNode = Node.create({
  name: "spectraReference",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      embedId: { default: null },
      placementOperationId: { default: null },
      containerType: { default: "artifact" },
      containerId: { default: null },
      containerRegionId: { default: "artifact:structure" },
      sourceArtifactId: { default: null },
      mode: { default: "compact" },
      interaction: { default: "read" },
      versionPolicy: { default: "live" },
      pinnedVersionId: { default: null },
      contextPolicy: { default: "summary" },
      displayPreferences: { default: null },
      state: { default: "ready" },
      // The other works on this card, each a tab (reference-stack.ts).
      stack: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          try {
            const value = JSON.parse(element.getAttribute("data-stack") ?? "null");
            return Array.isArray(value) ? value : null;
          } catch {
            return null;
          }
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          Array.isArray(attributes.stack) && attributes.stack.length ? { "data-stack": JSON.stringify(attributes.stack) } : {},
      },
      createdAt: { default: null },
      updatedAt: { default: null },
      blockId: { default: null },
      // Read-only migration input. New insertions never write these forked v2
      // attributes, but existing documents still open with an honest fallback.
      id: { default: null },
      workId: { default: null },
      workType: { default: null },
      anchor: { default: null },
      view: { default: null },
      width: { default: null },
      height: { default: null },
      status: { default: null },
      label: { default: null },
      protocolVersion: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-spectra-reference]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-spectra-reference": "",
        "data-reference-id": HTMLAttributes.embedId,
        role: "group",
        "aria-label": "Live reference",
        contenteditable: "false",
      }),
      "Live reference",
    ];
  },
  addProseMirrorPlugins() {
    return [stackOnDrop];
  },
  addNodeView() {
    const render = ReactNodeViewRenderer(ReferenceNodeView);
    const EMBED_OWN_EVENTS =
      "[data-embed-editor], .work-embed-more, .work-embed-stack-tabs, [data-embed-preview] :is(button, input, textarea, select, a, label, [role='button'], [role='combobox'])";
    return (props) => {
      const view = render(props);
      // A work edited in place inside the reference is its own editor, and the
      // work's own controls (an answer, a card to turn, the embed's menu) are
      // the reader's: their presses, keys and clipboard never reach this document.
      const own = view.stopEvent?.bind(view);
      view.stopEvent = (event: Event) => {
        if (!(event.target instanceof Element)) return Boolean(own?.(event));
        // A block dropped on the card is the page's to place (it stacks), except inside a work being edited here.
        if (event.type.startsWith("drag") || event.type === "drop")
          return Boolean(event.target.closest("[data-embed-editor]"));
        return Boolean(event.target.closest(EMBED_OWN_EVENTS)) || Boolean(own?.(event));
      };
      return view;
    };
  },
});

export const SpectraCitationNode = Node.create({
  name: "spectraCitation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null },
      sourceId: { default: null },
      evidenceSpanId: { default: null },
      native: { default: null },
      label: { default: "Citation" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-spectra-citation]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-spectra-citation": "",
        contenteditable: "false",
      }),
      String(HTMLAttributes.label ?? "Citation"),
    ];
  },
});
