import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/*
 * A paragraph Word and Spectra both changed, shown where it is.
 *
 * Word's version is drawn as a slip above the paragraph, and Spectra's version
 * (the paragraph itself, still editable) is marked as yours. Three choices sit
 * on the slip: keep Word's, keep mine, keep both. The rest of the document is
 * not blocked. The document is never changed here; a choice is handed to the
 * studio, which resolves it on the server once every clash has one.
 */

export type WordConflictChoice = "word" | "spectra" | "both";

export type InPlaceConflict = {
  regionId: string;
  /** Word's paragraph as runs; plain text when it has no rich runs. */
  external: { text: string; runs?: ReadonlyArray<Record<string, unknown>> };
  /** A choice already made and on its way. */
  chosen?: WordConflictChoice;
};

export type WordConflictState = {
  conflicts: readonly InPlaceConflict[];
  application: string;
};

export const wordConflictKey = new PluginKey<{ state: WordConflictState; set: DecorationSet }>("spectraWordConflict");

const CHOICE_LABEL: Record<WordConflictChoice, string> = {
  word: "Keeping Word's version",
  spectra: "Keeping your version",
  both: "Keeping both",
};

function findBlock(doc: ProseMirrorNode, blockId: string) {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs.blockId === blockId && (node.isTextblock || node.type.name === "heading")) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found as { node: ProseMirrorNode; pos: number } | null;
}

function runElement(run: Record<string, unknown>): Node {
  const kind = run.kind;
  if (kind === "equation") {
    const span = document.createElement("span");
    span.className = "spectra-word-conflict-atom";
    span.textContent = String(run.latex ?? "");
    return span;
  }
  if (kind === "image") {
    const span = document.createElement("span");
    span.className = "spectra-word-conflict-atom";
    span.textContent = run.altText ? `[${String(run.altText)}]` : "[Image]";
    return span;
  }
  if (kind === "revision" && run.revisionKind === "del") return document.createTextNode("");
  const text = typeof run.text === "string" ? run.text : "";
  const format = (run.format ?? {}) as Record<string, unknown>;
  if (!format.bold && !format.italic && !format.underline && !format.strike && !run.href) return document.createTextNode(text);
  const span = document.createElement("span");
  span.textContent = text;
  if (format.bold) span.style.fontWeight = "700";
  if (format.italic) span.style.fontStyle = "italic";
  const lines = [format.underline || run.href ? "underline" : "", format.strike ? "line-through" : ""].filter(Boolean);
  if (lines.length) span.style.textDecoration = lines.join(" ");
  return span;
}

function slip(conflict: InPlaceConflict, application: string, choose: ChooseRef) {
  return () => {
    const root = document.createElement("div");
    root.className = "spectra-word-conflict";
    root.contentEditable = "false";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", `${application}'s version of this paragraph`);
    root.dataset.regionId = conflict.regionId;

    const label = document.createElement("p");
    label.className = "spectra-word-conflict-label";
    label.textContent = `${application}'s version`;
    root.append(label);

    const body = document.createElement("p");
    body.className = "spectra-word-conflict-text";
    if (conflict.external.runs?.length) body.append(...conflict.external.runs.map(runElement));
    else body.textContent = conflict.external.text || "Empty paragraph";
    root.append(body);

    const actions = document.createElement("div");
    actions.className = "spectra-word-conflict-actions";
    if (conflict.chosen) {
      const status = document.createElement("span");
      status.className = "spectra-word-conflict-status";
      status.setAttribute("role", "status");
      status.textContent = `${CHOICE_LABEL[conflict.chosen]}…`;
      actions.append(status);
    } else {
      const buttons: Array<[WordConflictChoice, string]> = [
        ["word", `Keep ${application}'s`],
        ["spectra", "Keep mine"],
        ["both", "Keep both"],
      ];
      for (const [choice, text] of buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "spectra-word-conflict-button";
        button.dataset.choice = choice;
        button.textContent = text;
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          choose.current?.(conflict.regionId, choice);
        });
        actions.append(button);
      }
    }
    root.append(actions);
    return root;
  };
}

type ChooseRef = { current: ((regionId: string, choice: WordConflictChoice) => void) | null };

function decorationsFor(doc: ProseMirrorNode, state: WordConflictState, choose: ChooseRef) {
  const decorations: Decoration[] = [];
  for (const conflict of state.conflicts) {
    const block = findBlock(doc, conflict.regionId);
    if (!block) continue;
    const key = `spectra-word-conflict:${conflict.regionId}:${conflict.chosen ?? "open"}:${conflict.external.text.length}`;
    decorations.push(
      Decoration.widget(block.pos, slip(conflict, state.application, choose), {
        side: -1,
        key,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
      Decoration.node(block.pos, block.pos + block.node.nodeSize, {
        class: "spectra-word-conflict-mine",
        "data-conflict-label": "Your version",
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

const EMPTY: WordConflictState = { conflicts: [], application: "Word" };

export const WordConflictDecoration = Extension.create<{ choose: ChooseRef }>({
  name: "spectraWordConflict",

  addOptions() {
    return { choose: { current: null } };
  },

  addProseMirrorPlugins() {
    const choose = this.options.choose;
    return [
      new Plugin({
        key: wordConflictKey,
        state: {
          init: (_config, editorState) => ({ state: EMPTY, set: DecorationSet.create(editorState.doc, []) }),
          apply: (tr, previous, _old, next) => {
            const incoming = tr.getMeta(wordConflictKey) as WordConflictState | undefined;
            if (incoming) return { state: incoming, set: decorationsFor(next.doc, incoming, choose) };
            if (!tr.docChanged) return previous;
            // Typing in your version moves the slip with it; a re-found block
            // keeps its place after larger changes.
            return previous.state.conflicts.length
              ? { state: previous.state, set: decorationsFor(next.doc, previous.state, choose) }
              : previous;
          },
        },
        props: {
          decorations: (editorState) => wordConflictKey.getState(editorState)?.set,
        },
      }),
    ];
  },
});
