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
    `<w:p xmlns:w="${WML_NAMESPACE}"><w:pPr><w:pStyle w:val="${safe}"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`,
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
