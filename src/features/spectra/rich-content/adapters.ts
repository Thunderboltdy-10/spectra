import type { JSONContent } from "@tiptap/core";
import type { PresentationParagraph } from "../presentation/model";
import type { SpectraRichContentAst } from "./ast";
import { richContentFromHtml } from "./html";
import { parseSpectraRichContent } from "./markdown";
import { richContentFromProseMirror, richContentToProseMirror } from "./prosemirror";
import { richContentToMarkdown, richContentToPlainText } from "./serialize";
import { richContentFromSlideParagraphs, richContentToSlideParagraphs } from "./slides";

/*
 * One adapter per stored format. Each artifact keeps the format its file
 * needs; these are the only ways into and out of the shared model.
 *
 *   markdown     replies, comments, board notes, plan and task descriptions
 *   html         quiz questions and answers, flashcard faces (TipTap HTML)
 *   prosemirror  documents (Yjs) and every TipTap field while it is edited
 *   slides       slide text boxes (DrawingML paragraphs and runs)
 */
export type RichContentAdapter<Stored> = {
  read(value: Stored): SpectraRichContentAst;
  write(ast: SpectraRichContentAst): Stored;
};

export const RICH_CONTENT_ADAPTERS = {
  markdown: { read: parseSpectraRichContent, write: richContentToMarkdown } satisfies RichContentAdapter<string>,
  html: { read: richContentFromHtml } satisfies Pick<RichContentAdapter<string>, "read">,
  prosemirror: { read: richContentFromProseMirror, write: richContentToProseMirror } satisfies RichContentAdapter<JSONContent>,
  slides: {
    read: richContentFromSlideParagraphs,
    write: richContentToSlideParagraphs,
  } satisfies RichContentAdapter<readonly PresentationParagraph[]>,
};

export type RichContentFormat = keyof typeof RICH_CONTENT_ADAPTERS;

const STORED_HTML = /^<(?:p|h[1-6]|ul|ol|blockquote|pre|aside|div|table|hr|figure)\b/i;

/**
 * A text field's stored value, whichever of the two string formats it was
 * written in: a TipTap field writes HTML, an import or the AI writes Markdown.
 */
export function richContentFromStored(value: string): SpectraRichContentAst {
  return isStoredHtml(value) ? richContentFromHtml(value.trim()) : parseSpectraRichContent(value);
}

/** Whether a stored field value is editor HTML rather than Markdown. */
export function isStoredHtml(value: string) {
  return STORED_HTML.test(value.trim());
}

/** A stored text field's words, for a label, a rail row or a search. */
export function plainTextFromStored(value: string): string {
  return value.trim() ? richContentToPlainText(richContentFromStored(value)) : "";
}
