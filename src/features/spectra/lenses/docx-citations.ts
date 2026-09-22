import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { parseXml, serializeNode, XmlElement, XmlText } from "@ariadng/office/xml";
import { wordElements, wordAttr, wordElement, wordText } from "./docx-academic";
import { wordSourceSchema, wordSourceReferenceSchema, type WordSource, type WordCitationInline } from "./docx-citation-schema";
import type { DocxRichInline } from "./projection-contracts";

const BIB = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const META = "urn:spectra:academic:v1";
const FIELDS = { title: "Title", year: "Year", city: "City", publisher: "Publisher", journal: "JournalName", volume: "Volume", issue: "Issue", pages: "Pages", url: "URL", doi: "DOI" } as const;

function sourceValue(element: XmlElement, name: string) { return element.find(BIB, name)?.text(); }

function readSource(element: XmlElement) {
  const author = element.find(BIB, "Author")?.find(BIB, "Author");
  const people = author ? wordElements(author).filter((node) => node.namespaceUri() === BIB && node.localName === "Person") : [];
  const corporate = author?.find(BIB, "Corporate")?.text();
  const result = wordSourceSchema.safeParse({ tag: sourceValue(element, "Tag"), sourceType: sourceValue(element, "SourceType"), title: sourceValue(element, "Title") ?? "", ...Object.fromEntries(Object.entries(FIELDS).flatMap(([key, name]) => sourceValue(element, name) === undefined ? [] : [[key, sourceValue(element, name)]])), ...(people.length ? { authors: people.map((person) => ({ last: sourceValue(person, "Last") ?? "", ...(sourceValue(person, "First") ? { first: sourceValue(person, "First") } : {}), ...(sourceValue(person, "Middle") ? { middle: sourceValue(person, "Middle") } : {}) })) } : {}), ...(corporate ? { corporate } : {}) });
  return result.success ? result.data : undefined;
}

export async function wordSourceParts(document: Document) {
  const found: Array<{ partName: string; root: XmlElement }> = [];
  for (const relationship of document.office.mainPart.relationships().byType(`${REL}customXml`)) {
    const part = document.office.package.relatedPart(document.office.mainPart, relationship.id);
    if (!part || !part.name.endsWith(".xml")) continue;
    const root = (await document.office.xml(part.name)).root;
    if (root.namespaceUri() === BIB && root.localName === "Sources") found.push({ partName: part.name, root });
  }
  return found;
}

export async function collectWordSources(document: Document) {
  return (await wordSourceParts(document)).flatMap(({ root }) => root.elements().flatMap((element) => { const source = readSource(element); return source ? [source] : []; }));
}

function bibElement(parent: XmlElement, name: string, text?: string) {
  const node = new XmlElement(name, "b");
  parent.appendChild(node);
  if (text !== undefined) node.appendChild(new XmlText(text));
  return node;
}

export async function upsertWordSource(document: Document, source: WordSource) {
  const parts = await wordSourceParts(document);
  const matches = parts.flatMap((part) => part.root.elements().filter((element) => sourceValue(element, "Tag") === source.tag).map((element) => ({ ...part, element })));
  if (matches.length > 1) throw new Error("DOCX_IDENTITY_AMBIGUOUS: The Word source tag is duplicated.");
  if (matches[0] && JSON.stringify(readSource(matches[0].element)) === JSON.stringify(source)) return;
  const part = matches[0] ?? parts[0] ?? (() => {
    const name = document._internal().freePartName("/customXml/item", "xml");
    const xml = parseXml(`<b:Sources xmlns:b="${BIB}"/>`);
    const added = document.office.package.addPart(name, "application/xml", new TextEncoder().encode(serializeNode(xml.root)));
    document.office._primeXml(name, xml);
    document.office.mainPart.relationships().add({ type: `${REL}customXml`, target: `..${name}` });
    const propsName = document._internal().freePartName("/customXml/itemProps", "xml");
    const props = document.office.package.addPart(propsName, "application/vnd.openxmlformats-officedocument.customXmlProperties+xml", new TextEncoder().encode(`<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{${crypto.randomUUID().toUpperCase()}}"><ds:schemaRefs><ds:schemaRef ds:uri="${BIB}"/></ds:schemaRefs></ds:datastoreItem>`));
    added.relationships().add({ type: `${REL}customXmlProps`, target: props.name.split("/").at(-1)! });
    return { partName: name, root: xml.root };
  })();
  const element = matches[0]?.element ?? bibElement(part.root, "Source");
  const replace = (name: string, value?: string) => {
    for (const previous of element.findAll(BIB, name)) element.removeChild(previous);
    if (value !== undefined) bibElement(element, name, value);
  };
  replace("Tag", source.tag); replace("SourceType", source.sourceType);
  for (const [key, name] of Object.entries(FIELDS)) replace(name, source[key as keyof typeof FIELDS]);
  const authorContainer = element.find(BIB, "Author");
  const oldAuthor = authorContainer?.find(BIB, "Author");
  if (oldAuthor) authorContainer!.removeChild(oldAuthor);
  if (source.authors?.length || source.corporate) {
    const author = bibElement(authorContainer ?? bibElement(element, "Author"), "Author");
    if (source.corporate) bibElement(author, "Corporate", source.corporate);
    else {
      const names = bibElement(author, "NameList");
      for (const person of source.authors ?? []) {
        const node = bibElement(names, "Person");
        bibElement(node, "Last", person.last);
        if (person.first) bibElement(node, "First", person.first);
        if (person.middle) bibElement(node, "Middle", person.middle);
      }
    }
  }
  document.office.markDirty(part.partName);
}

export function bibliographyContainer(element: XmlElement): XmlElement | undefined {
  let ancestor: XmlElement | null = element;
  while (ancestor) {
    if (ancestor.localName === "sdt" && ancestor.find(WML_NAMESPACE, "sdtPr")?.find(WML_NAMESPACE, "bibliography")) return ancestor;
    ancestor = ancestor.parent;
  }
  return undefined;
}

function citationIdentity(element: XmlElement, fallback: string) {
  let ancestor: XmlElement | null = element;
  while (ancestor && ancestor.localName !== "p") {
    if (ancestor.localName === "sdt") {
      const props = ancestor.find(WML_NAMESPACE, "sdtPr");
      const tag = props?.find(WML_NAMESPACE, "tag");
      if (tag && wordAttr(tag, "val")?.startsWith("spectra:citation:")) return wordAttr(tag, "val")!.slice(17);
      const id = props?.find(WML_NAMESPACE, "id");
      if (id) return `word-sdt-${wordAttr(id, "val")}`;
    }
    ancestor = ancestor.parent;
  }
  return fallback;
}

export async function citationMappings(document: Document) {
  const part = document.office.package.getPart("/customXml/spectraAcademic.xml");
  const result = new Map<string, WordCitationInline["sourceRef"]>();
  if (!part) return result;
  const root = (await document.office.xml(part.name)).root;
  if (root.namespaceUri() !== META) return result;
  for (const item of root.elements()) {
    try { const value = wordSourceReferenceSchema.safeParse(JSON.parse(item.text())); if (value.success && item.getAttribute("id")) result.set(item.getAttribute("id")!, value.data); } catch { /* Unknown extension entries remain carried. */ }
  }
  return result;
}

export async function writeCitationMapping(document: Document, item: WordCitationInline) {
  let part = document.office.package.getPart("/customXml/spectraAcademic.xml");
  if (!part && !item.sourceRef) return;
  if (!part) {
    const xml = parseXml(`<s:academic xmlns:s="${META}"/>`);
    part = document.office.package.addPart("/customXml/spectraAcademic.xml", "application/xml", new TextEncoder().encode(serializeNode(xml.root)));
    document.office._primeXml(part.name, xml);
    document.office.mainPart.relationships().add({ type: `${REL}customXml`, target: `..${part.name}` });
  }
  const root = (await document.office.xml(part.name)).root;
  if (root.namespaceUri() !== META) throw new Error("DOCX_IDENTITY_AMBIGUOUS: An unrelated custom XML part owns the academic mapping path.");
  const existing = root.elements().find((node) => node.getAttribute("id") === item.citationId);
  if (!item.sourceRef) {
    if (existing) { root.removeChild(existing); document.office.markDirty(part.name); }
    return;
  }
  if (existing?.text() === JSON.stringify(item.sourceRef)) return;
  if (existing) root.removeChild(existing);
  const node = new XmlElement("citation", "s"); root.appendChild(node);
  node.setAttribute("id", item.citationId); node.appendChild(new XmlText(JSON.stringify(item.sourceRef)));
  document.office.markDirty(part.name);
}

export function projectAcademicFields(root: XmlElement, regionId: string, sources: WordSource[], mappings: Map<string, WordCitationInline["sourceRef"]>, bibliographySources = sources) {
  const fields = new Map<XmlElement, DocxRichInline>();
  const skipped = new Set<XmlElement>();
  let index = 0;
  const project = (element: XmlElement, instruction: string, text: string) => {
    const match = /^\s*CITATION\s+(?:"([^"\\]+)"|([^\s\\]+))((?:\s+\\[lp]\s+(?:"[^"]*"|[^\s\\]+))*\s*)$/i.exec(instruction);
    if (/^\s*BIBLIOGRAPHY\s*$/i.test(instruction)) return { kind: "bibliography" as const, sources: bibliographySources, text };
    if (!match) return undefined;
    const source = sources.find((candidate) => candidate.tag === (match[1] ?? match[2]));
    if (!source) return undefined;
    const pagesMatch = /\\p\s+(?:"([^"]*)"|([^\s\\]+))/i.exec(instruction);
    const pages = pagesMatch?.[1] ?? pagesMatch?.[2];
    const citationId = citationIdentity(element, `${regionId}-citation-${index++}`);
    return { kind: "citation" as const, citationId, source, text, instruction, ...(pages ? { pages } : {}), ...(mappings.has(citationId) ? { sourceRef: mappings.get(citationId)! } : {}) };
  };
  for (const parent of wordElements(root)) {
    if (parent.localName === "fldSimple") {
      const item = project(parent, wordAttr(parent, "instr") ?? "", wordText(parent));
      if (item) fields.set(parent, item);
      continue;
    }
    const children = parent.elements();
    for (let start = 0; start < children.length; start++) {
      if (wordAttr(children[start]!.find(WML_NAMESPACE, "fldChar") ?? wordElement("none"), "fldCharType") !== "begin") continue;
      let end = start + 1; let separated = false; let instruction = ""; let text = "";
      for (; end < children.length; end++) {
        const node = children[end]!;
        const type = node.find(WML_NAMESPACE, "fldChar");
        const val = type && wordAttr(type, "fldCharType");
        if (val === "begin") break;
        if (val === "end") {
          const item = project(children[start]!, instruction, text);
          if (item) { fields.set(children[start]!, item); children.slice(start + 1, end + 1).forEach((child) => skipped.add(child)); }
          break;
        }
        if (val === "separate") separated = true;
        else if (separated) text += wordText(node);
        else instruction += wordElements(node).filter((child) => child.localName === "instrText").map((child) => child.text()).join("");
      }
    }
  }
  return { fields, skipped };
}

export async function appendWordCitation(document: Document, parent: XmlElement, item: WordCitationInline) {
  await upsertWordSource(document, item.source);
  await writeCitationMapping(document, item);
  const sdt = wordElement("sdt", parent);
  const props = wordElement("sdtPr", sdt);
  wordElement("tag", props).setAttributeNs(WML_NAMESPACE, "val", `spectra:citation:${item.citationId}`);
  wordElement("citation", props);
  const field = wordElement("fldSimple", wordElement("sdtContent", sdt));
  field.setAttributeNs(WML_NAMESPACE, "instr", item.instruction ?? ` CITATION "${item.source.tag}"${item.pages ? ` \\p "${item.pages.replace(/["\\]/g, "")}"` : ""} `);
  const text = wordElement("t", wordElement("r", field)); text.setAttribute("xml:space", "preserve"); text.appendChild(new XmlText(item.text));
}

export async function appendWordBibliography(document: Document, parent: XmlElement, item: Extract<DocxRichInline, { kind: "bibliography" }>) {
  for (const source of item.sources) await upsertWordSource(document, source);
  const field = wordElement("fldSimple", parent); field.setAttributeNs(WML_NAMESPACE, "instr", " BIBLIOGRAPHY ");
  item.text.split("\n").forEach((line, index) => {
    const run = wordElement("r", field);
    if (index) wordElement("br", run);
    const text = wordElement("t", run); text.appendChild(new XmlText(line));
  });
}
