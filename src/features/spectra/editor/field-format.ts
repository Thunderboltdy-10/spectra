import type { Editor, JSONContent } from "@tiptap/core";
import { DOMParser as SchemaParser, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import {
  isStoredHtml,
  richContentFromProseMirror,
  richContentFromStored,
  richContentToMarkdown,
  richContentToPlainText,
  richContentToProseMirror,
} from "../rich-content";

/*
 * How a text field stores what its editor holds.
 *
 * Every field edits the same ProseMirror schema; only the stored string
 * differs. Quiz questions and card faces keep the HTML their field writes;
 * plan and task descriptions and board notes keep Markdown, which the AI and
 * imports write too. Both come in through the shared model, so a field opened
 * on Markdown it did not write still shows its lists, checklists and math.
 */
export type FieldFormat = "html" | "markdown";

/** What a field opens on: its HTML as is, or Markdown read through the model. */
export function fieldContent(value: string): string | JSONContent {
  return isStoredHtml(value) ? value.trim() : richContentToProseMirror(richContentFromStored(value));
}

/** The document a stored value becomes in a field's schema. */
export function fieldDocument(schema: Schema, value: string): ProseMirrorNode {
  const content = fieldContent(value);
  if (typeof content === "string") {
    // An inert document: nothing in a stored value loads or runs while it is read.
    const body = new window.DOMParser().parseFromString(`<body>${content}</body>`, "text/html").body;
    return SchemaParser.fromSchema(schema).parse(body, { preserveWhitespace: "full" });
  }
  try {
    const node = schema.nodeFromJSON(content);
    node.check();
    return node;
  } catch {
    // A shape this schema cannot hold keeps its words.
    const text = richContentToPlainText(richContentFromStored(value));
    return schema.nodeFromJSON({
      type: "doc",
      content: text.split("\n").map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })),
    });
  }
}

/** What a field stores for what its editor holds; an empty field stores "". */
export function fieldValue(editor: Pick<Editor, "getHTML" | "getJSON">, format: FieldFormat): string {
  if (format === "markdown") {
    const markdown = richContentToMarkdown(richContentFromProseMirror(editor.getJSON()));
    return markdown.trim() ? markdown : "";
  }
  const html = editor.getHTML();
  return html === "<p></p>" ? "" : html;
}
