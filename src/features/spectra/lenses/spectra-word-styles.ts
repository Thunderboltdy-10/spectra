import { WML_NAMESPACE, type Document } from "@ariadng/office/docx";
import { parseXml, type XmlElement } from "@ariadng/office/xml";
import type { DocxStyleCatalogue, DocxStyleEntry } from "./projection-contracts";

export { SPECTRA_DOCUMENT_LOOKS, spectraLookCatalogue, type SpectraDocumentLook } from "./spectra-document-looks";

/* Writes a style catalogue into a Word package as real paragraph styles. */

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const twips = (points: number) => Math.round(points * 20);
const SAFE_ID = /^[\p{L}\p{N}_ .-]{1,200}$/u;
const HEX = /^[0-9A-Fa-f]{6}$/;

function runProperties(style: DocxStyleEntry) {
  const font = style.fontFamily ? escape(style.fontFamily) : undefined;
  const size = style.fontSizePoints ? Math.round(style.fontSizePoints * 2) : undefined;
  return [
    font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>` : "",
    style.bold ? "<w:b/><w:bCs/>" : "",
    style.italic ? "<w:i/><w:iCs/>" : "",
    style.allCaps ? "<w:caps/>" : "",
    style.smallCaps ? "<w:smallCaps/>" : "",
    style.color && HEX.test(style.color) ? `<w:color w:val="${style.color.toUpperCase()}"/>` : "",
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : "",
  ].join("");
}

function paragraphProperties(style: DocxStyleEntry, level: number | undefined) {
  const spacing = [
    style.spacingBeforePoints !== undefined ? `w:before="${twips(style.spacingBeforePoints)}"` : "",
    style.spacingAfterPoints !== undefined ? `w:after="${twips(style.spacingAfterPoints)}"` : "",
    style.lineHeightPoints
      ? `w:line="${twips(style.lineHeightPoints)}" w:lineRule="atLeast"`
      : style.lineSpacing
        ? `w:line="${Math.round(style.lineSpacing * 240)}" w:lineRule="auto"`
        : "",
  ].filter(Boolean).join(" ");
  const first = style.firstLineIndentPoints;
  const indent = [
    style.indentLeftPoints ? `w:left="${twips(style.indentLeftPoints)}"` : "",
    first ? (first > 0 ? `w:firstLine="${twips(first)}"` : `w:hanging="${twips(-first)}"`) : "",
  ].filter(Boolean).join(" ");
  const alignment = style.alignment === "justify" ? "both" : style.alignment;
  return [
    level ? "<w:keepNext/><w:keepLines/>" : "",
    spacing ? `<w:spacing ${spacing}/>` : "",
    indent ? `<w:ind ${indent}/>` : "",
    alignment && alignment !== "left" ? `<w:jc w:val="${alignment}"/>` : "",
    level ? `<w:outlineLvl w:val="${level - 1}"/>` : "",
  ].join("");
}

function styleXml(id: string, style: DocxStyleEntry, isDefault: boolean) {
  const level = Number(style.role?.match(/^heading([1-6])$/u)?.[1] ?? 0) || undefined;
  const pPr = paragraphProperties(style, level);
  const rPr = runProperties(style);
  return (
    `<w:style xmlns:w="${WML_NAMESPACE}" w:type="paragraph"${isDefault ? ' w:default="1"' : ""} w:styleId="${escape(id)}">` +
    `<w:name w:val="${escape(style.name)}"/>` +
    (isDefault ? "" : '<w:basedOn w:val="Normal"/>') +
    (style.next && style.next !== id ? `<w:next w:val="${escape(style.next)}"/>` : "") +
    (level ? '<w:uiPriority w:val="9"/>' : "") +
    "<w:qFormat/>" +
    (pPr ? `<w:pPr>${pPr}</w:pPr>` : "") +
    (rPr ? `<w:rPr>${rPr}</w:rPr>` : "") +
    "</w:style>"
  );
}

/**
 * Writes a catalogue into a fresh package's styles: its body style becomes
 * Normal and the document defaults, and every other style is a Word paragraph
 * style based on Normal, written with the values it resolves to.
 */
export async function writeStyleCatalogue(document: Document, catalogue: DocxStyleCatalogue) {
  const part = document.office.package.getPart("/word/styles.xml");
  if (!part) return;
  const styles = await document.office.xml(part.name);
  const root = styles.root;
  const body = catalogue.paragraph[catalogue.defaultStyleId];
  const ofType = (name: string) => root.elements().filter((element: XmlElement) => element.localName === name);
  if (body) {
    const defaults = ofType("docDefaults")[0];
    const rPr = runProperties({ ...body, bold: false, italic: false });
    if (defaults && rPr) {
      for (const child of [...defaults.elements()]) if (child.localName === "rPrDefault") defaults.removeChild(child);
      defaults.insertBefore(
        parseXml(`<w:rPrDefault xmlns:w="${WML_NAMESPACE}"><w:rPr>${rPr}</w:rPr></w:rPrDefault>`).root,
        defaults.children[0] ?? null,
      );
    }
  }
  const written = new Set<string>();
  for (const [id, style] of Object.entries(catalogue.paragraph)) {
    if (!SAFE_ID.test(id)) continue;
    const isDefault = id === catalogue.defaultStyleId;
    if (!isDefault && id === "Normal") continue;
    // The body style is Normal itself: a Word file has exactly one default.
    const styleId = isDefault ? "Normal" : id;
    for (const existing of ofType("style"))
      if (existing.getAttributeNs(WML_NAMESPACE, "styleId") === styleId) root.removeChild(existing);
    const next = style.next === catalogue.defaultStyleId ? "Normal" : style.next;
    const entry = { ...style, ...(isDefault ? { name: "Normal" } : {}), ...(next ? { next } : {}) };
    root.appendChild(parseXml(styleXml(styleId, entry, isDefault)).root);
    written.add(styleId);
  }
  document.office.markDirty(part.name);
  return written;
}
