import { WML_NAMESPACE } from "@ariadng/office/docx";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * A Word caption's number: a real `SEQ` field, so Word keeps counting the
 * figures itself, written with the number it has where it is inserted.
 */

export type WordCaptionLabel = "Figure" | "Table" | "Equation";

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function seqInstruction(label: WordCaptionLabel) {
  return `SEQ ${label} \\* ARABIC`;
}

/** The field Spectra carries for a new caption number, in the shape the Word lens writes back. */
export function wordSeqField(label: WordCaptionLabel, number: number, fieldId: string) {
  const instruction = seqInstruction(label);
  const text = String(number);
  return {
    kind: "field" as const,
    fieldId,
    instruction,
    text,
    xml:
      `<w:fieldRuns xmlns:w="${WML_NAMESPACE}">` +
      `<w:fldSimple w:instr=" ${escapeXml(instruction)} "><w:r><w:rPr><w:noProof/></w:rPr><w:t>${text}</w:t></w:r></w:fldSimple>` +
      `</w:fieldRuns>`,
  };
}

export const TOC_INSTRUCTION = String.raw`TOC \o "1-3" \h \z \u`;

/**
 * Word's own table of contents. Until Word lays the pages out it shows the
 * headings as they stand, one to a line; the field is marked out of date, so
 * Word rebuilds it with links and page numbers the next time it opens.
 */
export function wordTocField(headings: ReadonlyArray<{ title: string; level: number }>, fieldId: string) {
  const lines = headings.filter((heading) => heading.level <= 3 && heading.title.trim()).map((heading) => heading.title.trim());
  const shown = lines.length ? lines : ["Word fills in the contents when it next opens this document."];
  const runs = shown
    .map((line, index) => `<w:r>${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`)
    .join("");
  return {
    kind: "field" as const,
    fieldId,
    instruction: TOC_INSTRUCTION,
    text: shown.join("\n"),
    xml: `<w:fieldRuns xmlns:w="${WML_NAMESPACE}"><w:fldSimple w:instr=" ${escapeXml(TOC_INSTRUCTION)} " w:dirty="true">${runs}</w:fldSimple></w:fieldRuns>`,
  };
}

/** Whether a field code numbers captions of this label (`SEQ Figure \* ARABIC`). */
export function isSeqFor(instruction: unknown, label: string) {
  if (typeof instruction !== "string") return false;
  const [code, identifier] = instruction.trim().split(/\s+/u);
  return code?.toUpperCase() === "SEQ" && identifier?.toLowerCase() === label.toLowerCase();
}

/** The number the next caption of this label takes at `position`: one more than those before it. */
export function nextCaptionNumber(doc: ProseMirrorNode, position: number, label: WordCaptionLabel) {
  let count = 0;
  doc.nodesBetween(0, Math.min(position, doc.content.size), (node) => {
    if (node.type.name === "wordField" && isSeqFor((node.attrs.native as { instruction?: unknown } | null)?.instruction, label)) count += 1;
    return true;
  });
  return count + 1;
}

/** A table nearest above the cursor is captioned as a table; anything else as a figure. */
export function captionLabelAt(doc: ProseMirrorNode, position: number): WordCaptionLabel {
  const $position = doc.resolve(Math.min(position, doc.content.size));
  for (let depth = $position.depth; depth >= 0; depth -= 1)
    if ($position.node(depth).type.name === "table") return "Table";
  const index = $position.index(0);
  const before = index > 0 ? doc.child(index - 1) : undefined;
  return before?.type.name === "table" ? "Table" : "Figure";
}

/** In a Spectra document: one more than the captions of this label written before `position`. */
export function nextSpectraCaptionNumber(doc: ProseMirrorNode, position: number, label: WordCaptionLabel, captionStyleId?: string) {
  const numbered = new RegExp(String.raw`^${label}\s+\d`, "u");
  let count = 0;
  doc.nodesBetween(0, Math.min(position, doc.content.size), (node) => {
    if (node.type.name !== "paragraph") return true;
    const isCaption = node.attrs.blockStyle === "caption" || (captionStyleId !== undefined && node.attrs.styleId === captionStyleId);
    if (isCaption && numbered.test(node.textContent)) count += 1;
    return false;
  });
  return count + 1;
}

/** The document's headings in order, as a table of contents lists them. */
export function documentHeadings(doc: ProseMirrorNode) {
  const headings: Array<{ title: string; level: number }> = [];
  doc.descendants((node) => {
    if (node.type.name !== "heading") return true;
    const title = node.textContent.trim();
    if (title) headings.push({ title, level: Number(node.attrs.level) || 1 });
    return false;
  });
  return headings;
}
