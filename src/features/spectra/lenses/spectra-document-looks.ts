import type { DocxStyleCatalogue, DocxStyleEntry } from "./projection-contracts";

/*
 * The looks a document made in Spectra can start from, as Word style
 * catalogues. The page draws a document from its catalogue, the style menu
 * offers its styles, and the Word copy writes them as real Word styles, so a
 * document made here opens in Word with Title, Heading 1 and Caption in the
 * styles gallery rather than as loose bold text.
 *
 * Every typeface is one Word ships and Spectra serves a metric twin for
 * (Times New Roman → Tinos, Calibri → Carlito, Arial → Arimo), so the page
 * and Word break lines in the same places.
 */

export type SpectraDocumentLook = "essay" | "notes" | "worksheet";

const heading = (
  level: number,
  look: Omit<DocxStyleEntry, "name" | "role">,
): DocxStyleEntry => ({ name: `heading ${level}`, role: `heading${level}` as DocxStyleEntry["role"], next: "Normal", bold: true, ...look });

const ESSAY: DocxStyleCatalogue = {
  defaultStyleId: "Normal",
  paragraph: {
    // An essay as schools ask for it: a 12-point serif at one and a half lines.
    Normal: { name: "Normal", role: "normal", fontFamily: "Times New Roman", fontSizePoints: 12, lineSpacing: 1.5, spacingAfterPoints: 8 },
    Title: { name: "Title", role: "title", next: "Normal", fontFamily: "Times New Roman", fontSizePoints: 22, bold: true, alignment: "center", lineSpacing: 1, spacingAfterPoints: 6 },
    Subtitle: { name: "Subtitle", role: "subtitle", next: "Normal", fontFamily: "Times New Roman", fontSizePoints: 13, italic: true, alignment: "center", lineSpacing: 1, spacingAfterPoints: 18 },
    Heading1: heading(1, { fontFamily: "Times New Roman", fontSizePoints: 16, lineSpacing: 1, spacingBeforePoints: 18, spacingAfterPoints: 8 }),
    Heading2: heading(2, { fontFamily: "Times New Roman", fontSizePoints: 13, lineSpacing: 1, spacingBeforePoints: 14, spacingAfterPoints: 6 }),
    Heading3: heading(3, { fontFamily: "Times New Roman", fontSizePoints: 12, italic: true, lineSpacing: 1, spacingBeforePoints: 12, spacingAfterPoints: 4 }),
    Quote: { name: "Quote", role: "quote", next: "Normal", fontFamily: "Times New Roman", fontSizePoints: 12, italic: true, lineSpacing: 1, indentLeftPoints: 36, spacingAfterPoints: 8 },
    Caption: { name: "caption", role: "caption", next: "Normal", fontFamily: "Times New Roman", fontSizePoints: 10, italic: true, lineSpacing: 1, spacingAfterPoints: 10 },
  },
};

const NOTES: DocxStyleCatalogue = {
  defaultStyleId: "Normal",
  paragraph: {
    Normal: { name: "Normal", role: "normal", fontFamily: "Calibri", fontSizePoints: 11, lineSpacing: 1.15, spacingAfterPoints: 6 },
    Title: { name: "Title", role: "title", next: "Normal", fontFamily: "Calibri", fontSizePoints: 24, bold: true, color: "1F3A5F", lineSpacing: 1, spacingAfterPoints: 4 },
    Subtitle: { name: "Subtitle", role: "subtitle", next: "Normal", fontFamily: "Calibri", fontSizePoints: 12, color: "5A6B7D", lineSpacing: 1, spacingAfterPoints: 14 },
    Heading1: heading(1, { fontFamily: "Calibri", fontSizePoints: 15, color: "1F3A5F", lineSpacing: 1, spacingBeforePoints: 16, spacingAfterPoints: 4 }),
    Heading2: heading(2, { fontFamily: "Calibri", fontSizePoints: 12.5, color: "2E5A88", lineSpacing: 1, spacingBeforePoints: 12, spacingAfterPoints: 3 }),
    Heading3: heading(3, { fontFamily: "Calibri", fontSizePoints: 11, color: "2E5A88", lineSpacing: 1, spacingBeforePoints: 10, spacingAfterPoints: 2 }),
    Quote: { name: "Quote", role: "quote", next: "Normal", fontFamily: "Calibri", fontSizePoints: 11, italic: true, color: "404040", lineSpacing: 1.15, indentLeftPoints: 28, spacingAfterPoints: 8 },
    Caption: { name: "caption", role: "caption", next: "Normal", fontFamily: "Calibri", fontSizePoints: 9, italic: true, color: "5A6B7D", lineSpacing: 1, spacingAfterPoints: 8 },
  },
};

const WORKSHEET: DocxStyleCatalogue = {
  defaultStyleId: "Normal",
  paragraph: {
    // Plain, large and evenly spaced: a sheet to write on and photocopy.
    Normal: { name: "Normal", role: "normal", fontFamily: "Arial", fontSizePoints: 11, lineSpacing: 1.3, spacingAfterPoints: 6 },
    Title: { name: "Title", role: "title", next: "Normal", fontFamily: "Arial", fontSizePoints: 18, bold: true, lineSpacing: 1, spacingAfterPoints: 4 },
    Subtitle: { name: "Subtitle", role: "subtitle", next: "Normal", fontFamily: "Arial", fontSizePoints: 11, color: "595959", lineSpacing: 1, spacingAfterPoints: 12 },
    Heading1: heading(1, { fontFamily: "Arial", fontSizePoints: 13, lineSpacing: 1, spacingBeforePoints: 14, spacingAfterPoints: 6 }),
    Heading2: heading(2, { fontFamily: "Arial", fontSizePoints: 11.5, lineSpacing: 1, spacingBeforePoints: 10, spacingAfterPoints: 4 }),
    Heading3: heading(3, { fontFamily: "Arial", fontSizePoints: 11, lineSpacing: 1, spacingBeforePoints: 8, spacingAfterPoints: 2 }),
    Quote: { name: "Quote", role: "quote", next: "Normal", fontFamily: "Arial", fontSizePoints: 11, italic: true, lineSpacing: 1.15, indentLeftPoints: 24, spacingAfterPoints: 6 },
    Caption: { name: "caption", role: "caption", next: "Normal", fontFamily: "Arial", fontSizePoints: 9, bold: true, lineSpacing: 1, spacingAfterPoints: 8 },
  },
};

export const SPECTRA_DOCUMENT_LOOKS: Record<SpectraDocumentLook, DocxStyleCatalogue> = {
  essay: ESSAY,
  notes: NOTES,
  worksheet: WORKSHEET,
};

export function spectraLookCatalogue(look: unknown): DocxStyleCatalogue | undefined {
  return typeof look === "string" && look in SPECTRA_DOCUMENT_LOOKS
    ? structuredClone(SPECTRA_DOCUMENT_LOOKS[look as SpectraDocumentLook])
    : undefined;
}
