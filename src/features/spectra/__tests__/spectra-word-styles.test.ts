import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { docxLens } from "../lenses/docx-lens";
import { SPECTRA_DOCUMENT_LOOKS, spectraLookCatalogue } from "../lenses/spectra-word-styles";
import { wordStyleOptions } from "../editor/word-style-options";

const essay = {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { styleId: "Title" }, content: [{ type: "text", text: "Light and leaves" }] },
    { type: "paragraph", attrs: { styleId: "Subtitle" }, content: [{ type: "text", text: "A biology essay" }] },
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Introduction" }] },
    { type: "paragraph", content: [{ type: "text", text: "Plants make sugar from light." }] },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Light is life." }] }] },
    { type: "paragraph", attrs: { styleId: "Caption" }, content: [{ type: "text", text: "Figure 1: a leaf" }] },
  ],
};

describe("a document made in Spectra, in Word", () => {
  it("writes its look as real Word styles that reopen as the same look", async () => {
    const { bytes } = await exportDocxCopy(essay, { styles: spectraLookCatalogue("essay") });
    const reopened = await docxLens.open(bytes);
    const styles = reopened.projection.styles!;
    expect(reopened.projection.blocks.map((block) => block.attrs?.styleId ?? null)).toEqual(["Title", "Subtitle", "Heading1", null, "Quote", "Caption"]);
    for (const id of ["Normal", "Title", "Heading1", "Caption"] as const) {
      const wanted = SPECTRA_DOCUMENT_LOOKS.essay.paragraph[id]!;
      expect(styles.paragraph[id]).toMatchObject({ fontFamily: wanted.fontFamily, fontSizePoints: wanted.fontSizePoints });
    }
    expect(styles.paragraph.Title).toMatchObject({ role: "title", bold: true, alignment: "center" });
    expect(styles.paragraph.Heading1?.role).toBe("heading1");
    expect(styles.paragraph.Quote).toMatchObject({ role: "quote", italic: true, indentLeftPoints: 36 });
    const xml = await (await JSZip.loadAsync(bytes)).file("word/styles.xml")!.async("string");
    expect(xml.match(/w:default="1"/g)).toHaveLength(1);
    // The menu of the reopened file offers the same styles in the same order.
    expect(wordStyleOptions(styles).slice(0, 6).map((option) => option.label)).toEqual(["Normal", "Title", "Subtitle", "Heading 1", "Heading 2", "Heading 3"]);
  });

  it("keeps the plain copy unchanged when the document has no look", async () => {
    const { bytes } = await exportDocxCopy(essay);
    const reopened = await docxLens.open(bytes);
    expect(reopened.projection.blocks[0]!.attrs?.styleId ?? null).toBe(null);
    expect(reopened.projection.blocks[2]!.attrs?.styleId).toBe("Heading1");
  });

  it("knows only its own looks", () => {
    expect(spectraLookCatalogue("brochure")).toBeUndefined();
    expect(spectraLookCatalogue("notes")).not.toBe(SPECTRA_DOCUMENT_LOOKS.notes);
  });
});
