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

export function writeStoryContent(root: XmlElement, content: WordNoteContent, noteType?: "footnote" | "endnote") {
  const paragraphProperties = root.elements().filter((node) => node.localName === "p").map((node) => node.find(WML_NAMESPACE, "pPr")?.clone());
  for (const child of [...root.children]) root.removeChild(child);
  content.forEach((runs, index) => {
    const paragraph = wordElement("p", root);
    const properties = paragraphProperties[index] ?? paragraphProperties.at(-1)?.clone();
    if (properties) paragraph.appendChild(properties);
    if (noteType && index === 0) wordElement(`${noteType}Ref`, wordElement("r", paragraph));
    for (const item of runs) {
      const run = wordElement("r", paragraph);
      if (item.bold || item.italic || item.underline) {
        const props = wordElement("rPr", run);
        if (item.bold) wordElement("b", props);
        if (item.italic) wordElement("i", props);
        if (item.underline) wordElement("u", props).setAttributeNs(WML_NAMESPACE, "val", "single");
      }
      item.text.split(/([\t\n])/).forEach((text) => {
        if (text === "\t" || text === "\n") wordElement(text === "\t" ? "tab" : "br", run);
        else if (text) {
          const node = wordElement("t", run);
          node.setAttribute("xml:space", "preserve");
          node.appendChild(new XmlText(text));
        }
      });
    }
  });
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
