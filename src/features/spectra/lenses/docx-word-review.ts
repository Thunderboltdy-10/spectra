/**
 * Read-path projection of Word review markup that Spectra historically only
 * marked PRESERVED: revision marks, footnote/endnote bodies, and comments.
 *
 * These helpers never rewrite package parts — they only inventory what Word
 * already wrote so the studio can list it honestly.
 */
import type { Document } from "@ariadng/office/docx";
import { WML_NAMESPACE } from "@ariadng/office/docx";
import type { XmlElement } from "@ariadng/office/xml";
import { noteContent, relatedWordPart, storyText } from "./docx-academic";
import type { WordNoteContent } from "./docx-academic-schema";
import { nativeCommentReadOnlyReason } from "./docx-academic-review";

export type WordRevisionKind = "ins" | "del" | "moveFrom" | "moveTo";

export type WordRevisionMark = {
  id: string;
  kind: WordRevisionKind;
  author?: string;
  date?: string;
  text: string;
};

export type WordNote = {
  id: string;
  type: "footnote" | "endnote";
  text: string;
  partName?: string;
  content?: WordNoteContent;
  readOnlyReason?: string;
};

export type WordComment = {
  id: string;
  author?: string;
  date?: string;
  initials?: string;
  text: string;
  partName?: string;
  readOnlyReason?: string;
};

const REVISION_KINDS = new Set<string>(["ins", "del", "moveFrom", "moveTo"]);

function wmlAttr(element: XmlElement, localName: string) {
  return element.getAttributeNs(WML_NAMESPACE, localName) ?? undefined;
}

function descendants(element: XmlElement): XmlElement[] {
  const found: XmlElement[] = [];
  for (const child of element.elements()) {
    found.push(child, ...descendants(child));
  }
  return found;
}

function projectedWmlPlainText(element: XmlElement): string {
  const chunks: string[] = [];
  const visit = (node: XmlElement) => {
    if (node.namespaceUri() === WML_NAMESPACE) {
      if (node.localName === "t" || node.localName === "delText") {
        chunks.push(node.text());
        return;
      }
      if (node.localName === "tab") {
        chunks.push("\t");
        return;
      }
      if (node.localName === "br" || node.localName === "cr") {
        chunks.push("\n");
        return;
      }
    }
    for (const child of node.elements()) visit(child);
  };
  visit(element);
  return chunks.join("").replace(/\s+/g, " ").trim();
}

export function collectWordRevisions(root: XmlElement): WordRevisionMark[] {
  const marks: WordRevisionMark[] = [];
  const seen = new Set<string>();
  for (const element of [root, ...descendants(root)]) {
    if (element.namespaceUri() !== WML_NAMESPACE) continue;
    if (!REVISION_KINDS.has(element.localName)) continue;
    const kind = element.localName as WordRevisionKind;
    const rawId = wmlAttr(element, "id") ?? `${kind}-${marks.length + 1}`;
    const id = `docx:revision:${kind}:${rawId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const text = projectedWmlPlainText(element);
    // Empty self-closing deletions still count — Word recorded them.
    marks.push({
      id,
      kind,
      ...(wmlAttr(element, "author")
        ? { author: wmlAttr(element, "author") }
        : {}),
      ...(wmlAttr(element, "date") ? { date: wmlAttr(element, "date") } : {}),
      text,
    });
  }
  return marks;
}

async function loadNotesFromPart(
  document: Document,
  partName: string,
  type: "footnote" | "endnote",
): Promise<WordNote[]> {
  const related = await relatedWordPart(document, `${type}s`);
  const part = document.office.package.getPart(related?.partName ?? partName);
  if (!part) return [];
  const xml = await document.office.xml(part.name);
  const local = type === "footnote" ? "footnote" : "endnote";
  const notes: WordNote[] = [];
  for (const element of [xml.root, ...descendants(xml.root)]) {
    if (element.namespaceUri() !== WML_NAMESPACE || element.localName !== local)
      continue;
    const noteType = wmlAttr(element, "type");
    if (noteType === "separator" || noteType === "continuationSeparator")
      continue;
    const id = wmlAttr(element, "id");
    if (!id) continue;
    const content = noteContent(element);
    notes.push({
      id,
      type,
      text: storyText(element),
      partName: part.name,
      ...(content ? { content } : { readOnlyReason: "This note contains unmodeled native content; edit its body in Word." }),
    });
  }
  return notes;
}

export async function collectWordNotes(document: Document): Promise<WordNote[]> {
  const [footnotes, endnotes] = await Promise.all([
    loadNotesFromPart(document, "/word/footnotes.xml", "footnote"),
    loadNotesFromPart(document, "/word/endnotes.xml", "endnote"),
  ]);
  return [...footnotes, ...endnotes];
}

export async function collectWordComments(
  document: Document,
): Promise<WordComment[]> {
  const part = await relatedWordPart(document, "comments");
  if (!part) return [];
  const xml = { root: part.root };
  const comments: WordComment[] = [];
  for (const element of [xml.root, ...descendants(xml.root)]) {
    if (
      element.namespaceUri() !== WML_NAMESPACE ||
      element.localName !== "comment"
    )
      continue;
    const id = wmlAttr(element, "id");
    if (!id) continue;
    comments.push({
      id,
      partName: part.partName,
      ...(nativeCommentReadOnlyReason(document, element) ? { readOnlyReason: nativeCommentReadOnlyReason(document, element) } : {}),
      ...(wmlAttr(element, "author")
        ? { author: wmlAttr(element, "author") }
        : {}),
      ...(wmlAttr(element, "date") ? { date: wmlAttr(element, "date") } : {}),
      ...(wmlAttr(element, "initials")
        ? { initials: wmlAttr(element, "initials") }
        : {}),
      text: storyText(element),
    });
  }
  return comments;
}

export function revisionPlaceholderLabel(mark: WordRevisionMark) {
  const kindLabel =
    mark.kind === "ins"
      ? "Insertion"
      : mark.kind === "del"
        ? "Deletion"
        : mark.kind === "moveFrom"
          ? "Moved from"
          : "Moved to";
  return `Tracked change · ${kindLabel}`;
}

export function revisionPlaceholderDetail(mark: WordRevisionMark) {
  const who = mark.author?.trim() || "Word";
  const preview = mark.text.trim() || "(empty mark)";
  return `${who}: ${preview.slice(0, 180)}`;
}
