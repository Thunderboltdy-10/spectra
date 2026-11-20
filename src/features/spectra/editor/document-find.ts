import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { documentFindPattern, type DocumentMatch, type FindOptions } from "./document-navigation";

export type EditorMatch = DocumentMatch & {
  /** The matched words, as the page shows them. */
  text: string;
  /** Inside a part Word keeps as it is, so replacing would be refused. */
  readOnly: boolean;
};

/** Stands in for a picture, equation or field, so a match never runs through one. */
const OBJECT = "￼";

/**
 * Every match in the editor's document, found in each paragraph's whole text,
 * so a word half in bold, or split by a comment mark, is still found. Matches
 * never cross a paragraph or an inline object.
 */
export function findInEditor(
  doc: ProseMirrorNode,
  query: string,
  options: FindOptions = {},
  isProtected: (node: ProseMirrorNode) => boolean = () => false,
): EditorMatch[] {
  const pattern = query ? documentFindPattern(query, options) : null;
  if (!pattern) return [];
  const matches: EditorMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    // A paragraph inside a protected table or list is protected too.
    const $position = doc.resolve(position);
    let readOnly = isProtected(node);
    for (let depth = 1; depth <= $position.depth && !readOnly; depth += 1) readOnly = isProtected($position.node(depth));
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = position + 1 + offset;
      if (child.isText && child.text) {
        for (let index = 0; index < child.text.length; index += 1) at.push(start + index);
        text += child.text;
      } else {
        at.push(start);
        text += OBJECT;
      }
    });
    if (!text) return false;
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      if (!match[0].length) {
        pattern.lastIndex += 1;
      } else if (!match[0].includes(OBJECT)) {
        const end = match.index + match[0].length;
        matches.push({
          from: at[match.index]!,
          to: at[end - 1]! + 1,
          text: match[0],
          readOnly,
          preview: text
            .slice(Math.max(0, match.index - 24), Math.min(text.length, end + 24))
            .replaceAll(OBJECT, "")
            .trim(),
        });
      }
      match = pattern.exec(text);
    }
    return false;
  });
  return matches;
}

/**
 * What one match becomes. A pattern's replacement may use $1 and $&; plain
 * text is taken as written, so a "$" typed in the box stays a "$".
 */
export function replacementFor(match: string, query: string, replace: string, options: FindOptions = {}) {
  if (!options.regex) return replace;
  const pattern = documentFindPattern(query, options);
  if (!pattern) return replace;
  return match.replace(new RegExp(pattern.source, pattern.flags.replace("g", "")), replace);
}

/**
 * Replaces matches as ranged edits, last first so earlier positions hold. The
 * new words take the look of the words they replace, so replacing a bold word
 * gives a bold word. Matches in read-only parts are left; the count of those
 * replaced is returned.
 */
export function replaceMatches(
  transaction: Transaction,
  matches: readonly EditorMatch[],
  replacement: (match: EditorMatch) => string,
) {
  let replaced = 0;
  for (const match of [...matches].sort((a, b) => b.from - a.from)) {
    if (match.readOnly) continue;
    const text = replacement(match);
    if (text) {
      const $from = transaction.doc.resolve(match.from);
      const marks = $from.marksAcross(transaction.doc.resolve(match.to)) ?? $from.marks();
      transaction.replaceWith(match.from, match.to, transaction.doc.type.schema.text(text, marks));
    } else {
      transaction.delete(match.from, match.to);
    }
    replaced += 1;
  }
  return replaced;
}
