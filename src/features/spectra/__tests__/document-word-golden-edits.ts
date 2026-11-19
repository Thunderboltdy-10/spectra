/** The edits a writer makes, applied to editor JSON by the Document ↔ Word golden harness. */
export type J = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: J[];
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const readOnly = (node: J) => node.attrs?.nativeReadOnly === true;
function find(node: J, test: (candidate: J) => boolean): J | undefined {
  if (test(node)) return node;
  for (const child of node.content ?? []) {
    const hit = find(child, test);
    if (hit) return hit;
  }
  return undefined;
}
const withoutIds = (node: J): J => ({
  ...node,
  ...(node.attrs ? { attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== "blockId")) } : {}),
  ...(node.content ? { content: node.content.map(withoutIds) } : {}),
});

/** Each edit returns the edited document, or null when the file has nothing to edit that way. */
export const GOLDEN_EDITS: Record<string, (doc: J) => J | null> = {
  appendPlain(doc) {
    const target = doc.content!.find((node) => node.type === "paragraph" && !readOnly(node) &&
      (node.content ?? []).some((child) => (child.text ?? "").length > 20));
    if (!target) return null;
    target.content!.push({ type: "text", text: " Added by Spectra." });
    return doc;
  },
  appendTyped(doc) {
    // Typing at the end carries the last run's marks.
    const target = doc.content!.find((node) => (node.type === "paragraph" || node.type === "heading") && !readOnly(node) &&
      (node.content ?? []).at(-1)?.type === "text");
    if (!target) return null;
    const last = target.content!.at(-1)!;
    target.content!.push({ type: "text", text: " typed", ...(last.marks ? { marks: clone(last.marks) } : {}) });
    return doc;
  },
  newParagraphAfterHeading(doc) {
    const index = doc.content!.findIndex((node) => node.type === "heading" && !readOnly(node));
    if (index < 0) return null;
    doc.content!.splice(index + 1, 0, { type: "paragraph", content: [{ type: "text", text: "A brand new paragraph." }] });
    return doc;
  },
  editEquation(doc) {
    const equation = find(doc, (node) => (node.type === "inlineEquation" || node.type === "equation") && !readOnly(node) &&
      typeof node.attrs?.latex === "string");
    if (!equation) return null;
    equation.attrs!.latex = `${String(equation.attrs!.latex)}+1`;
    return doc;
  },
  editTableCell(doc) {
    const table = doc.content!.find((node) => node.type === "table" && !readOnly(node));
    if (!table) return null;
    const paragraph = find(table, (node) => node.type === "paragraph" && (node.content ?? []).some((child) => child.type === "text"));
    if (!paragraph) return null;
    paragraph.content!.push({ type: "text", text: " (edited)" });
    return doc;
  },
  newListItem(doc) {
    // Enter at the end of a list item: a second item in the same list node.
    const list = doc.content!.find((node) => (node.type === "bulletList" || node.type === "orderedList") && !readOnly(node));
    if (!list) return null;
    const item = withoutIds(clone(list.content![0]!));
    const paragraph = find(item, (node) => node.type === "paragraph");
    if (!paragraph) return null;
    paragraph.content = [{ type: "text", text: "New list item" }];
    item.content = [paragraph];
    list.content!.push(item);
    return doc;
  },
  deleteParagraph(doc) {
    const index = doc.content!.findIndex((node, position) => position > 2 && node.type === "paragraph" && !readOnly(node) &&
      (node.content ?? []).length > 0 && (node.content ?? []).every((child) => child.type === "text"));
    if (index < 0) return null;
    doc.content!.splice(index, 1);
    return doc;
  },
};

