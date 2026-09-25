import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { parseXml, XmlElement, XmlText } from "@ariadng/office/xml";
import { wordNoteIdSchema, type WordNoteContent, type WordTextAnchor } from "./docx-academic-schema";

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const CONTENT = "application/vnd.openxmlformats-officedocument.wordprocessingml.";

export function wordElements(root: XmlElement): XmlElement[] {
  return [root, ...root.elements().flatMap(wordElements)];
}

export function wordAttr(element: XmlElement, name: string) {
  return element.getAttributeNs(WML_NAMESPACE, name);
}

export function wordElement(name: string, parent?: XmlElement) {
  const element = new XmlElement(name, "w");
  if (parent) parent.appendChild(element);
  return element;
}

export function wordText(root: XmlElement): string {
  if (root.namespaceUri() !== WML_NAMESPACE) return "";
  if (root.localName === "t" || root.localName === "delText") return root.text();
  if (root.localName === "tab") return "\t";
  if (root.localName === "br" || root.localName === "cr") return "\n";
  if (["pPr", "rPr", "instrText"].includes(root.localName)) return "";
  return root.elements().map(wordText).join("");
}

export function storyText(root: XmlElement) {
  return root.elements().filter((element) => element.localName === "p").map(wordText).join("\n");
}

export function wordVisibleText(root: XmlElement): string {
  if (root.namespaceUri() === WML_NAMESPACE && root.localName === "del") return "";
  if (root.localName === "t" || ["tab", "br", "cr"].includes(root.localName)) return wordText(root);
  return root.elements().map(wordVisibleText).join("");
}

export function noteContent(root: XmlElement): WordNoteContent | undefined {
  const allowed = new Set(["footnote", "endnote", "p", "pPr", "pStyle", "r", "rPr", "rStyle", "t", "tab", "br", "cr", "b", "i", "u", "footnoteRef", "endnoteRef"]);
  if (wordElements(root).some((element) => element.namespaceUri() !== WML_NAMESPACE || !allowed.has(element.localName))) return undefined;
  if (wordElements(root).some((element) => element.localName === "u" && ![undefined, "single"].includes(wordAttr(element, "val")))) return undefined;
  if (wordElements(root).some((element) => ["b", "i"].includes(element.localName) && ["0", "false", "off"].includes(wordAttr(element, "val") ?? ""))) return undefined;
  if (wordElements(root).some((element) => element.localName === "r" && wordText(element) && element.find(WML_NAMESPACE, "rPr")?.find(WML_NAMESPACE, "rStyle"))) return undefined;
  const paragraphs = root.elements().filter((element) => element.localName === "p");
  if (!paragraphs.length) return undefined;
  return paragraphs.map((paragraph) => paragraph.elements().filter((element) => element.localName === "r").flatMap((run) => {
    const text = wordText(run);
    if (!text) return [];
    const props = run.find(WML_NAMESPACE, "rPr");
    const enabled = (name: string) => {
      const item = props?.find(WML_NAMESPACE, name);
      return Boolean(item && !["0", "false", "off", "none"].includes(wordAttr(item, "val") ?? ""));
    };
    return [{ text, ...(enabled("b") ? { bold: true } : {}), ...(enabled("i") ? { italic: true } : {}), ...(enabled("u") ? { underline: true } : {}) }];
  }));
}

export function noteContentText(content: WordNoteContent) {
  return content.map((paragraph) => paragraph.map((run) => run.text).join("")).join("\n");
}

export async function relatedWordPart(document: Document, type: string) {
  const relationships = document.office.mainPart.relationships().byType(`${REL}${type}`);
  if (relationships.length > 1) throw new Error(`DOCX_IDENTITY_AMBIGUOUS: Multiple ${type} relationships.`);
  if (!relationships.length) return undefined;
  const part = document.office.package.relatedPart(document.office.mainPart, relationships[0]!.id);
  if (!part) throw new Error(`DOCX_UNSUPPORTED_EDIT: The ${type} relationship is missing its part.`);
  return { partName: part.name, root: (await document.office.xml(part.name)).root };
}

async function notesPart(document: Document, type: "footnote" | "endnote", create: boolean) {
  const found = await relatedWordPart(document, `${type}s`);
  if (found || !create) return found;
  const name = `/word/${type}s.xml`;
  if (document.office.package.getPart(name)) throw new Error(`DOCX_IDENTITY_AMBIGUOUS: An unrelated part owns ${name}.`);
  const xml = parseXml(`<w:${type}s xmlns:w="${WML_NAMESPACE}"/>`);
  for (const [id, kind] of [["-1", "separator"], ["0", "continuationSeparator"]]) {
    const note = wordElement(type, xml.root);
    note.setAttributeNs(WML_NAMESPACE, "id", id!);
    note.setAttributeNs(WML_NAMESPACE, "type", kind!);
    wordElement(kind!, wordElement("r", wordElement("p", note)));
  }
  const added = document._internal().addXmlPart(name, `${CONTENT}${type}s+xml`, `${REL}${type}s`, xml);
  document._internal().markDirty(added.pd);
  return { partName: name, root: xml.root };
}

export async function nativeNote(document: Document, type: "footnote" | "endnote", id: string) {
  const part = await notesPart(document, type, false);
  const notes = part?.root.elements().filter((element) => element.localName === type && wordAttr(element, "id") === id) ?? [];
  if (notes.length > 1) throw new Error("DOCX_IDENTITY_AMBIGUOUS: This note ID occurs more than once.");
  return notes[0] && part ? { ...part, note: notes[0] } : undefined;
}

/** Keep native boundaries in unchanged prefixes/suffixes. Replacement text
 * inherits the formatting spans it replaces, including invisible attributes. */
function remapTextBoundary(before: string, after: string) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return (offset: number) => {
    let mapped = offset <= prefix ? offset : offset >= before.length - suffix
      ? after.length - (before.length - offset)
      : prefix + Math.round((offset - prefix) * (after.length - prefix - suffix) / (before.length - prefix - suffix));
    if (mapped > 0 && /[\uD800-\uDBFF]/u.test(after[mapped - 1]!) && /[\uDC00-\uDFFF]/u.test(after[mapped] ?? "")) mapped++;
    return mapped;
  };
}

function writeRunText(run: XmlElement, text: string) {
  if (wordText(run) === text) return;
  const nodes = run.elements().filter((node) => ["t", "delText", "tab", "br", "cr"].includes(node.localName));
  const before = nodes.map(wordText).join("");
  const boundary = remapTextBoundary(before, text);
  let position = 0;
  const pieces = nodes.length ? nodes : [undefined];
  for (const [index, previous] of pieces.entries()) {
    const start = index === 0 ? 0 : boundary(position);
    position += previous ? wordText(previous).length : 0;
    const end = index === pieces.length - 1 ? text.length : boundary(position);
    const value = text.slice(start, end);
    if (previous && wordText(previous) === value) continue;
    for (const chunk of value.split(/([\t\n])/).filter(Boolean)) {
      const name = chunk === "\t" ? "tab" : chunk === "\n" ? "br" : "t";
      const node = previous && (previous.localName === name || name === "t" && previous.localName === "delText") ? previous.clone() : wordElement(name);
      for (const child of [...node.children]) node.removeChild(child);
      if (name === "t") { node.setAttribute("xml:space", "preserve"); node.appendChild(new XmlText(chunk)); }
      run.insertBefore(node, previous ?? null);
    }
    if (previous) run.removeChild(previous);
  }
}

function writeRunFormat(run: XmlElement, item: WordNoteContent[number][number]) {
  for (const [key, name] of [["bold", "b"], ["italic", "i"], ["underline", "u"]] as const) {
    let props = run.find(WML_NAMESPACE, "rPr");
    const existing = props?.findAll(WML_NAMESPACE, name) ?? [];
    if (item[key]) {
      if (!props) { props = wordElement("rPr"); run.insertBefore(props, run.children[0] ?? null); }
      if (!existing.length) {
        const node = wordElement(name, props);
        if (name === "u") node.setAttributeNs(WML_NAMESPACE, "val", "single");
      }
    } else for (const node of existing) props!.removeChild(node);
  }
}

export function writeStoryContent(root: XmlElement, content: WordNoteContent, noteType?: "footnote" | "endnote", preserveFormatting = false) {
  const paragraphs = root.elements().filter((node) => node.localName === "p");
  content.forEach((items, index) => {
    const paragraph = paragraphs[index] ?? wordElement("p", root);
    if (!paragraphs[index]) {
      const properties = paragraphs.at(-1)?.find(WML_NAMESPACE, "pPr");
      if (properties) paragraph.appendChild(properties.clone());
    }
    const nativeRuns = paragraph.elements().filter((node) => node.localName === "r" && wordText(node));
    const before = nativeRuns.map(wordText).join("");
    const after = items.map((item) => item.text).join("");
    const boundary = remapTextBoundary(before, after);
    let nativePosition = 0;
    const spans = nativeRuns.map((run, runIndex) => {
      const start = runIndex ? boundary(nativePosition) : 0;
      nativePosition += wordText(run).length;
      return { run, start, end: runIndex === nativeRuns.length - 1 ? after.length : boundary(nativePosition), used: false };
    });
    const anchor = nativeRuns[0] ?? null;
    let position = 0;
    for (const item of items) {
      const end = position + item.text.length;
      const overlaps = spans.filter((span) => span.start < end && span.end > position);
      for (const span of overlaps.length ? overlaps : [spans[0]]) {
        const start = span ? Math.max(position, span.start) : position;
        const stop = span ? Math.min(end, span.end) : end;
        const run = span?.run.clone() ?? wordElement("r");
        paragraph.insertBefore(run, anchor);
        // A split run may carry a native reference marker only once.
        if (span?.used) for (const node of run.elements().filter((node) => ["footnoteRef", "endnoteRef", "annotationRef"].includes(node.localName))) run.removeChild(node);
        if (span) span.used = true;
        writeRunText(run, after.slice(start, stop));
        if (!preserveFormatting) writeRunFormat(run, item);
      }
      position = end;
    }
    for (const run of nativeRuns) paragraph.removeChild(run);
    if (noteType && index === 0 && !wordElements(paragraph).some((node) => node.localName === `${noteType}Ref`)) {
      const run = wordElement("r"); wordElement(`${noteType}Ref`, run);
      paragraph.insertBefore(run, paragraph.elements().find((node) => node.localName !== "pPr") ?? null);
    }
  });
  for (const paragraph of paragraphs.slice(content.length)) root.removeChild(paragraph);
}

/** Exact unchanged rich stories remain untouched, including vendor extensions. */
export async function upsertNativeNote(document: Document, item: { noteType: "footnote" | "endnote"; noteId: string; text: string; content?: WordNoteContent }) {
  wordNoteIdSchema.parse(item.noteId);
  const existing = await nativeNote(document, item.noteType, item.noteId);
  const content = item.content ?? item.text.split("\n").map((text) => [{ text }]);
  if (noteContentText(content) !== item.text) throw new Error("DOCX_UNSUPPORTED_EDIT: Note text and rich content disagree.");
  if (existing && storyText(existing.note) === item.text && (!item.content || JSON.stringify(noteContent(existing.note)) === JSON.stringify(content))) return;
  if (existing && !noteContent(existing.note)) throw new Error("DOCX_REGION_READ_ONLY: This note has a table, field, drawing, revision, or unmodeled formatting. Edit its body in Word; its reference and neighboring text remain separate.");
  const part = existing ?? (await notesPart(document, item.noteType, true))!;
  const note = existing?.note ?? wordElement(item.noteType, part.root);
  note.setAttributeNs(WML_NAMESPACE, "id", item.noteId);
  writeStoryContent(note, content, item.noteType);
  document.office.markDirty(part.partName);
}

export function noteReferences(document: Document, type: "footnote" | "endnote", id: string) {
  return wordElements(document.body()).filter((element) => element.namespaceUri() === WML_NAMESPACE && element.localName === `${type}Reference` && wordAttr(element, "id") === id);
}

export async function removeNativeNote(document: Document, type: "footnote" | "endnote", id: string) {
  const found = await nativeNote(document, type, id);
  if (!found) throw new Error("DOCX_IDENTITY_AMBIGUOUS: The note no longer exists.");
  if (noteReferences(document, type, id).length) throw new Error("DOCX_UNSUPPORTED_EDIT: This note still owns a reference.");
  found.root.removeChild(found.note);
  document.office.markDirty(found.partName);
  // Keep separator IDs, numbering and relationships. Empty reserved stories are valid Word parts.
}

export function appendNoteReference(parent: XmlElement, type: "footnote" | "endnote", id: string) {
  const run = wordElement("r", parent);
  wordElement(`${type}Reference`, run).setAttributeNs(WML_NAMESPACE, "id", id);
  return run;
}

/** A text-only range can split runs while retaining their exact run properties. */
export function fencedTextBoundary(paragraph: XmlElement, anchor: WordTextAnchor, offset: number): XmlElement | null {
  const text = wordVisibleText(paragraph);
  if (text !== anchor.expectedText || anchor.end > text.length) throw new Error("DOCX_ANCHOR_CONFLICT: The paragraph changed. Reload it and select the range again.");
  if (offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(text[offset]!)) throw new Error("DOCX_ANCHOR_CONFLICT: A range cannot split a Unicode character.");
  let position = 0;
  for (const child of paragraph.elements()) {
    if (child.localName === "pPr") continue;
    if (position === offset) return child;
    const length = wordVisibleText(child).length;
    if (position + length > offset) {
      if (child.localName !== "r" || child.elements().some((item) => !["rPr", "t"].includes(item.localName))) throw new Error("DOCX_REGION_READ_ONLY: Select a boundary outside this field, annotation, or embedded object.");
      const runText = wordText(child);
      const right = child.clone();
      for (const [run, value] of [[child, runText.slice(0, offset - position)], [right, runText.slice(offset - position)]] as const) {
        for (const node of [...run.elements()]) if (node.localName !== "rPr") run.removeChild(node);
        const node = wordElement("t", run);
        node.setAttribute("xml:space", "preserve");
        node.appendChild(new XmlText(value));
      }
      paragraph.insertBefore(right, paragraph.elements()[paragraph.elements().indexOf(child) + 1] ?? null);
      return right;
    }
    position += length;
  }
  if (position !== offset) throw new Error("DOCX_ANCHOR_CONFLICT: The selected range is outside the paragraph.");
  return null;
}
