import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { parseXml, serializeNode, XmlElement, XmlText } from "@ariadng/office/xml";
import { wordElements, wordAttr, wordElement, wordText } from "./docx-academic";
import { wordSourceSchema, wordSourceReferenceSchema, type WordSource, type WordCitationInline } from "./docx-citation-schema";
import type { DocxRichInline } from "./projection-contracts";

const BIB = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const META = "urn:spectra:academic:v1";
const FIELDS = { title: "Title", year: "Year", city: "City", publisher: "Publisher", journal: "JournalName", volume: "Volume", issue: "Issue", pages: "Pages", url: "URL", doi: "DOI" } as const;

function sourceValue(element: XmlElement, name: string) {
  const node = element.find(BIB, name);
  return node ? mappingText(node) : undefined;
}

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
  const node = new XmlElement(name, parent.lookupPrefix(BIB) ?? null);
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
  const previousSource = readSource(element);
  const replace = (parent: XmlElement, name: string, value?: string) => {
    const previous = parent.findAll(BIB, name);
    if (previous.length > 1) throw new Error("DOCX_IDENTITY_AMBIGUOUS: A Word source field is duplicated.");
    if (value === undefined) { if (previous[0]) parent.removeChild(previous[0]); return; }
    const node = previous[0] ?? bibElement(parent, name);
    if (mappingText(node) === value) return;
    writeMappingText(node, value);
  };
  replace(element, "Tag", source.tag); replace(element, "SourceType", source.sourceType);
  for (const [key, name] of Object.entries(FIELDS)) replace(element, name, source[key as keyof typeof FIELDS]);
  if (JSON.stringify(previousSource?.authors) !== JSON.stringify(source.authors) || previousSource?.corporate !== source.corporate) {
    const authorContainer = element.find(BIB, "Author") ?? bibElement(element, "Author");
    const author = authorContainer.find(BIB, "Author") ?? bibElement(authorContainer, "Author");
    replace(author, "Corporate", source.corporate);
    const names = author.find(BIB, "NameList") ?? (source.authors?.length ? bibElement(author, "NameList") : undefined);
    if (names) {
      const people = names.findAll(BIB, "Person");
      for (const [index, person] of (source.authors ?? []).entries()) {
        const node = people[index] ?? bibElement(names, "Person");
        replace(node, "Last", person.last); replace(node, "First", person.first); replace(node, "Middle", person.middle);
      }
      for (const person of people.slice(source.authors?.length ?? 0)) names.removeChild(person);
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
  const result = new Map<string, WordCitationInline["sourceRef"]>();
  const entries = (await academicMappingParts(document)).flatMap(({ root }) => mappingEntries(root));
  const counts = new Map<string, number>();
  for (const item of entries) counts.set(item.getAttribute("id")!, (counts.get(item.getAttribute("id")!) ?? 0) + 1);
  for (const item of entries) {
    const id = item.getAttribute("id")!;
    // A damaged identity must not attach someone else's evidence or prevent
    // the document and its unambiguous neighboring citations from opening.
    if (counts.get(id) !== 1) continue;
    try { const value = wordSourceReferenceSchema.safeParse(JSON.parse(mappingText(item))); if (value.success) result.set(id, value.data); } catch { /* Unknown extension entries remain carried. */ }
  }
  return result;
}

export async function academicMappingParts(document: Document) {
  const found = new Map<string, { partName: string; root: XmlElement }>();
  for (const relationship of document.office.mainPart.relationships().byType(`${REL}customXml`)) {
    const part = document.office.package.relatedPart(document.office.mainPart, relationship.id);
    if (!part || found.has(part.name)) continue;
    try {
      const root = (await document.office.xml(part.name)).root;
      if (root.namespaceUri() === META && root.localName === "academic") found.set(part.name, { partName: part.name, root });
    } catch { /* An unrelated unreadable custom part remains opaque carry. */ }
  }
  return [...found.values()];
}

function mappingEntries(root: XmlElement) {
  return root.elements().filter((node) => node.namespaceUri() === META && node.localName === "citation" && node.getAttribute("id"));
}

function mappingText(node: XmlElement) {
  return node.children.filter((child) => child.kind === "text" || child.kind === "cdata").map((child) => child.text).join("");
}

function writeMappingText(node: XmlElement, value: string) {
  const textNodes = node.children.filter((child) => child.kind === "text" || child.kind === "cdata");
  if (textNodes[0]) textNodes[0].text = value;
  else node.insertBefore(new XmlText(value), node.children[0] ?? null);
  for (const text of textNodes.slice(1)) node.removeChild(text);
}

export async function writeCitationMapping(document: Document, item: WordCitationInline) {
  const parts = await academicMappingParts(document);
  const matches = parts.flatMap((part) => mappingEntries(part.root).filter((node) => node.getAttribute("id") === item.citationId).map((node) => ({ ...part, node })));
  if (matches.length > 1) throw new Error("DOCX_IDENTITY_AMBIGUOUS: This citation mapping ID is duplicated.");
  let part = matches[0] ?? parts[0];
  if (!matches.length && !item.sourceRef) return;
  if (!part) {
    const xml = parseXml(`<s:academic xmlns:s="${META}"/>`);
    const name = document.office.package.getPart("/customXml/spectraAcademic.xml")
      ? document._internal().freePartName("/customXml/item", "xml") : "/customXml/spectraAcademic.xml";
    document.office.package.addPart(name, "application/xml", new TextEncoder().encode(serializeNode(xml.root)));
    document.office._primeXml(name, xml);
    document.office.mainPart.relationships().add({ type: `${REL}customXml`, target: `..${name}` });
    part = { partName: name, root: xml.root };
  }
  const { root, partName } = part;
  const existing = matches[0]?.node;
  if (existing) {
    let supported = false;
    try { supported = wordSourceReferenceSchema.safeParse(JSON.parse(mappingText(existing))).success; } catch { /* Opaque extension payload. */ }
    if (!supported) {
      // Absence in a projection cannot delete a payload that it could not read.
      if (!item.sourceRef) return;
      throw new Error("DOCX_REGION_READ_ONLY: This citation mapping has an unmodeled payload. Its native XML remains preserved.");
    }
  }
  if (!item.sourceRef) {
    if (existing) { root.removeChild(existing); document.office.markDirty(partName); }
    return;
  }
  if (existing && mappingText(existing) === JSON.stringify(item.sourceRef)) return;
  const node = existing ?? new XmlElement("citation", root.lookupPrefix(META) ?? null);
  if (!existing) root.appendChild(node);
  node.setAttribute("id", item.citationId);
  // The JSON text is ours; attributes, extension children and their ordering
  // belong to the native author and survive updates of this record.
  writeMappingText(node, JSON.stringify(item.sourceRef));
  document.office.markDirty(partName);
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
