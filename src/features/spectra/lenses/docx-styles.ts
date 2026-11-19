import { Paragraph, WML_NAMESPACE, type Document } from "@ariadng/office/docx";
import { parseXml, type XmlElement } from "@ariadng/office/xml";
import type { DocxStyleCatalogue, DocxStyleEntry } from "./projection-contracts";

/**
 * Word's look as data: the default paragraph style and every paragraph style
 * the body uses, each resolved through basedOn, docDefaults and the theme
 * fonts. The editor draws unmarked text from it, so text a writer types reads
 * exactly as Word would show it.
 */

const ROLE_BY_NAME: Record<string, DocxStyleEntry["role"]> = {
  normal: "normal",
  title: "title",
  subtitle: "subtitle",
  quote: "quote",
  "intense quote": "quote",
  caption: "caption",
  "list paragraph": "listParagraph",
};

/** The role a style plays, from Word's built-in English name first: a localised "heading 1" id is still heading 1. */
export function docxStyleRole(name: string | undefined, outlineLevel: number | undefined): DocxStyleEntry["role"] | undefined {
  const lower = name?.trim().toLocaleLowerCase();
  const heading = lower?.match(/^heading ([1-9])$/u)?.[1];
  if (heading) return `heading${Math.min(6, Number(heading))}` as DocxStyleEntry["role"];
  if (lower && ROLE_BY_NAME[lower]) return ROLE_BY_NAME[lower];
  if (outlineLevel !== undefined && outlineLevel >= 0 && outlineLevel < 6)
    return `heading${outlineLevel + 1}` as DocxStyleEntry["role"];
  return undefined;
}

function attr(element: XmlElement | undefined, name: string) {
  return element?.getAttributeNs(WML_NAMESPACE, name) ?? undefined;
}

const points = (twips: number | null) => (twips === null ? undefined : Math.round((twips / 20) * 10) / 10);

/** Resolve one style the way Word would for a paragraph that has only that style. */
function resolveStyle(document: Document, styleId: string): Omit<DocxStyleEntry, "name"> {
  const safe = styleId.replace(/[^\p{L}\p{N}_ .-]/gu, "");
  const probe = parseXml(
    `<w:p xmlns:w="${WML_NAMESPACE}"><w:pPr><w:pStyle w:val="${safe}"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`,
  );
  const paragraph = Paragraph._wrap(document, probe.root);
  const format = paragraph.format();
  const run = paragraph.runs()[0]?.format();
  const before = points(format.spacingBeforeTwips);
  const after = points(format.spacingAfterTwips);
  const indent = points(format.indentLeftTwips);
  const firstLine = points(format.indentFirstLineTwips);
  return {
    ...(run?.font ? { fontFamily: run.font } : {}),
    ...(run?.sizePt ? { fontSizePoints: run.sizePt } : {}),
    ...(run?.color ? { color: run.color } : {}),
    ...(run?.bold ? { bold: true } : {}),
    ...(run?.italic ? { italic: true } : {}),
    ...(run?.caps ? { allCaps: true } : {}),
    ...(run?.smallCaps ? { smallCaps: true } : {}),
    ...(format.alignment && format.alignment !== "left"
      ? { alignment: format.alignment as NonNullable<DocxStyleEntry["alignment"]> }
      : {}),
    ...(format.lineSpacing
      ? format.lineSpacing.rule === "auto"
        ? { lineSpacing: Math.round((format.lineSpacing.value / 240) * 100) / 100 }
        : { lineHeightPoints: format.lineSpacing.value / 20 }
      : {}),
    ...(before !== undefined ? { spacingBeforePoints: Math.max(0, before) } : {}),
    ...(after !== undefined ? { spacingAfterPoints: Math.max(0, after) } : {}),
    ...(indent ? { indentLeftPoints: indent } : {}),
    ...(firstLine ? { firstLineIndentPoints: firstLine } : {}),
  };
}

/** The catalogue for the styles the body uses plus the built-in roles the editor can apply. */
export function docxStyleCatalogue(document: Document, usedStyleIds: Iterable<string>): DocxStyleCatalogue | undefined {
  const styles = document._internal().styles()?.doc.root;
  if (!styles) return undefined;
  const definitions = styles
    .elements()
    .filter((element) => element.namespaceUri() === WML_NAMESPACE && element.localName === "style" && attr(element, "type") === "paragraph");
  const byId = new Map(
    definitions.flatMap((element) => {
      const id = attr(element, "styleId");
      return id ? [[id, element] as const] : [];
    }),
  );
  const outlineOf = (element: XmlElement) => {
    const value = attr(element.find(WML_NAMESPACE, "pPr")?.find(WML_NAMESPACE, "outlineLvl"), "val");
    return value === undefined ? undefined : Number(value);
  };
  const nameOf = (element: XmlElement) => attr(element.find(WML_NAMESPACE, "name"), "val");
  // A file without a default paragraph style still has docDefaults: its text
  // resolves from them, which is what a "Normal" that is not written means.
  const defaultId =
    attr(definitions.find((element) => ["1", "true", "on"].includes(attr(element, "default") ?? "")), "styleId") ?? "Normal";
  const wanted = new Set<string>([defaultId, ...usedStyleIds]);
  for (const [id, element] of byId) if (docxStyleRole(nameOf(element), outlineOf(element))) wanted.add(id);
  const paragraph: Record<string, DocxStyleEntry> = {};
  for (const id of wanted) {
    const element = byId.get(id);
    if (!element) {
      if (id === defaultId) paragraph[id] = { name: "Normal", role: "normal", ...resolveStyle(document, id) };
      continue;
    }
    const name = nameOf(element) ?? id;
    const role = docxStyleRole(name, outlineOf(element));
    const next = attr(element.find(WML_NAMESPACE, "next"), "val");
    paragraph[id] = {
      name: name.slice(0, 200),
      ...(role ? { role } : {}),
      ...(next && (byId.has(next) || next === defaultId) ? { next } : {}),
      ...resolveStyle(document, id),
    };
    if (Object.keys(paragraph).length >= 200) break;
  }
  return { defaultStyleId: defaultId, paragraph };
}

/** Each paragraph style's role, by Word's built-in name first and then by its outline level through basedOn. */
export function paragraphStyleRoles(document: Document) {
  const roles = new Map<string, NonNullable<DocxStyleEntry["role"]>>();
  const styles = document._internal().styles()?.doc.root;
  if (!styles) return roles;
  const byId = new Map(
    styles.elements().flatMap((element) => {
      const id = attr(element, "styleId");
      return element.localName === "style" && attr(element, "type") === "paragraph" && id ? [[id, element] as const] : [];
    }),
  );
  const outline = (id: string, seen = new Set<string>()): number | undefined => {
    const element = byId.get(id);
    if (!element || seen.has(id)) return undefined;
    seen.add(id);
    const own = attr(element.find(WML_NAMESPACE, "pPr")?.find(WML_NAMESPACE, "outlineLvl"), "val");
    if (own !== undefined) return Number(own);
    const basedOn = attr(element.find(WML_NAMESPACE, "basedOn"), "val");
    return basedOn ? outline(basedOn, seen) : undefined;
  };
  for (const [id, element] of byId) {
    const role = docxStyleRole(attr(element.find(WML_NAMESPACE, "name"), "val"), outline(id));
    if (role) roles.set(id, role);
  }
  return roles;
}

const ROMAN: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];

function formatListCounter(value: number, format: string) {
  if (format === "lowerLetter" || format === "upperLetter") {
    let text = "";
    for (let rest = value; rest > 0; rest = Math.floor((rest - 1) / 26)) text = String.fromCharCode(97 + ((rest - 1) % 26)) + text;
    return format === "upperLetter" ? text.toUpperCase() : text;
  }
  if (format === "lowerRoman" || format === "upperRoman") {
    let text = "";
    let rest = value;
    for (const [size, letters] of ROMAN) while (rest >= size) { text += letters; rest -= size; }
    return format === "upperRoman" ? text.toUpperCase() : text;
  }
  if (format === "decimalZero") return String(value).padStart(2, "0");
  return String(value);
}

/**
 * Word's list counters through the body, so an outline-numbered heading can
 * show the number Word prints beside it ("2.1"). Counters run per list and
 * reset the levels below the one that advanced.
 */
export function wordListCounter() {
  const counters = new Map<string, number[]>();
  const formats = new Map<string, string>();
  return (list: { numId: string; level: number; format: string; text: string; start: number }) => {
    const levels = counters.get(list.numId) ?? [];
    levels[list.level] = levels[list.level] === undefined ? list.start : levels[list.level]! + 1;
    levels.length = list.level + 1;
    counters.set(list.numId, levels);
    formats.set(`${list.numId}:${list.level}`, list.format);
    if (list.format === "bullet" || list.format === "none" || !list.text) return undefined;
    const number = list.text.replace(/%([1-9])/gu, (_, digit: string) => {
      const index = Number(digit) - 1;
      return formatListCounter(levels[index] ?? 1, formats.get(`${list.numId}:${index}`) ?? "decimal");
    });
    return number.trim() || undefined;
  };
}
