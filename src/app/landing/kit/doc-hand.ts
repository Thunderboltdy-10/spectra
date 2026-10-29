import type { Editor } from "@tiptap/core";

/*
 * A collaborator's hand in a real document. The studio on the page is the app's
 * own editor; these reach it the way a peer's change would arrive, as edits to
 * the document, so what changes is the editor's content, not a picture of it.
 */

type EditorElement = HTMLElement & { editor?: Editor };

export function editorIn(root: Element | null): Editor | null {
  const element = root?.querySelector<EditorElement>(".ProseMirror");
  const editor = element?.editor;
  return editor && !editor.isDestroyed ? editor : null;
}

/** Resolves with the editor once the studio inside `root` has mounted it. */
export function waitForEditor(root: () => Element | null, signal: AbortSignal) {
  return new Promise<Editor>((resolve, reject) => {
    const check = () => {
      if (signal.aborted) return reject(new DOMException("Stopped", "AbortError"));
      const editor = editorIn(root());
      if (editor) resolve(editor);
      else window.setTimeout(check, 200);
    };
    check();
  });
}

/** Where `text` is in the document, as editor positions, and as an offset inside its block. */
export function findText(editor: Editor, text: string) {
  let found: { from: number; to: number; blockId: string | null; offset: number } | null = null;
  editor.state.doc.descendants((node, position) => {
    if (found) return false;
    if (!node.isTextblock) return true;
    const content = node.textContent;
    const index = content.indexOf(text);
    if (index < 0) return false;
    // Positions inside a textblock start one after its opening.
    let from = -1;
    let seen = 0;
    node.forEach((child, childOffset) => {
      if (from >= 0) return;
      const length = child.isText ? (child.text?.length ?? 0) : child.textContent.length;
      if (child.isText && index >= seen && index < seen + length) from = position + 1 + childOffset + (index - seen);
      seen += length;
    });
    if (from < 0) return false;
    const blockId = (node.attrs.blockId ?? node.attrs.id ?? null) as string | null;
    found = { from, to: from + text.length, blockId, offset: index };
    return false;
  });
  return found as { from: number; to: number; blockId: string | null; offset: number } | null;
}

/** Applies a mark (bold, italic, highlight) to `text` without taking the visitor's focus. */
export function markText(editor: Editor, text: string, mark: "bold" | "italic" | "highlight" | "underline") {
  const range = findText(editor, text);
  if (!range) return false;
  return editor.chain().setTextSelection(range).setMark(mark).setTextSelection(range.to).run();
}

/** Swaps `text` for `next`, as a collaborator's rewording arrives. */
export function replaceText(editor: Editor, text: string, next: string) {
  const range = findText(editor, text);
  if (!range) return false;
  return editor.chain().insertContentAt(range, next).run();
}

/** Takes a mark off `text` again, as a round of the story starts over. */
export function unmarkText(editor: Editor, text: string, mark: "bold" | "italic" | "highlight" | "underline") {
  const range = findText(editor, text);
  if (!range) return false;
  return editor.chain().setTextSelection(range).unsetMark(mark).setTextSelection(range.to).run();
}
