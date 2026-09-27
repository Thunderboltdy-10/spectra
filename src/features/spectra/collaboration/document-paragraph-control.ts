"use client";

import type { Editor } from "@tiptap/core";
import type { DocumentParagraphTarget } from "../actions/protocol/semantic-action";
import { isAppControlRectVisible } from "./app-choreography-host";
import type { SettingsToggleActionPoint } from "./settings-toggle-control";

type MountedEditor = Pick<Editor, "state" | "view" | "isDestroyed">;
type Registration = { artifactId: string; editor: MountedEditor };
const editors = new Set<Registration>();

/** Register the real editor, never a selector-only stand-in or a second writer. */
export function registerDocumentParagraphEditor(artifactId: string, editor: MountedEditor): () => void {
  const entry = { artifactId, editor };
  editors.add(entry);
  return () => { editors.delete(entry); };
}

function locate(entry: Registration, target: DocumentParagraphTarget) {
  const { editor } = entry;
  if (!editors.has(entry) || editor.isDestroyed || !editor.view.dom.isConnected) return null;
  let position: number | undefined;
  let matches = 0;
  let valid = false;
  editor.state.doc.forEach((node, offset) => {
    if (node.attrs.blockId !== target.blockId) return;
    matches++;
    valid = node.type.name === "paragraph" && node.attrs.nativeReadOnly !== true &&
      node.textContent === target.expectedText && target.index >= 0 && target.index <= node.content.size;
    node.forEach(child => { if (!child.isText || child.marks.length) valid = false; });
    position = offset + 1 + target.index;
  });
  if (matches !== 1 || !valid || position === undefined) return null;
  const resolved = editor.state.doc.resolve(position);
  const element = editor.view.nodeDOM(resolved.before(1));
  if (!(element instanceof HTMLElement)) return null;
  const coords = editor.view.coordsAtPos(position);
  const rect = new DOMRect(coords.left, coords.top, Math.max(1, coords.right - coords.left), Math.max(1, coords.bottom - coords.top));
  return { element, rect };
}

export function documentParagraphControls(target: DocumentParagraphTarget) {
  return [...editors].filter(entry => entry.artifactId === target.artifactId).flatMap(entry => {
    const current = locate(entry, target);
    if (!current) return [];
    return [{
      element: current.element,
      anchor: () => locate(entry, target)?.rect ?? null,
      visible: () => {
        const next = locate(entry, target);
        return Boolean(next && isAppControlRectVisible(next.element, next.rect));
      },
      reveal: () => {
        // Only the Follow caller may invoke this. Do not select or focus text.
        const next = locate(entry, target);
        next?.element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      },
      async perform(action: SettingsToggleActionPoint) {
        if (action.signal.aborted || !locate(entry, target)) throw new Error("DOCUMENT_PARAGRAPH_NOT_READY");
        await action.reachActionPoint();
        // The sole accepted Yjs delta arrives through the existing binding.
      },
    }];
  });
}
