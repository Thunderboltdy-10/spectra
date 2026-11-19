import { describe, expect, it } from "vitest";
import * as docx from "docx";
import JSZip from "jszip";
import { docxLens } from "../lenses/docx-lens";
import { fillChrome } from "../components/document-page-chrome";
import { pageGeometry, withPreset } from "../lenses/page-geometry";

async function essay() {
  const document = new docx.Document({
    sections: [{
      properties: {
        titlePage: true,
        page: {
          size: { width: 11_906, height: 16_838 },
          margin: { top: 1_134, right: 1_134, bottom: 1_417, left: 1_701, header: 567, footer: 680 },
        },
      },
      headers: {
        default: new docx.Header({ children: [new docx.Paragraph({ alignment: docx.AlignmentType.RIGHT, children: [new docx.TextRun("Extended essay")] })] }),
        first: new docx.Header({ children: [new docx.Paragraph("Cover")] }),
      },
      footers: {
        default: new docx.Footer({
          children: [new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            children: [new docx.TextRun({ children: ["Page ", docx.PageNumber.CURRENT, " of ", docx.PageNumber.TOTAL_PAGES] })],
          })],
        }),
      },
      children: [new docx.Paragraph("Body")],
    }],
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

async function sectionXml(bytes: Uint8Array) {
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  return xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/u)?.[0] ?? "";
}

describe("Word pages keep their exact paper, margins and running heads", () => {
  it("reads exact margins and chrome templates with page fields", async () => {
    const opened = await docxLens.open(await essay());
    const setup = opened.projection.pageSetup!;
    expect(setup.page).toEqual({ width: 11_906, height: 16_838, top: 1_134, right: 1_134, bottom: 1_417, left: 1_701, header: 567, footer: 680 });
    expect(setup.size).toBe("a4");
    expect(setup.chrome?.header).toBe("\t\tExtended essay");
    expect(setup.chrome?.footer).toBe("\tPage {PAGE} of {NUMPAGES}");
    expect(setup.chrome?.firstHeader).toBe("Cover");
    expect(fillChrome(setup.chrome!.footer!, 3, 12)).toBe("\tPage 3 of 12");
  });

  it("writes exact margins and reads them back", async () => {
    const opened = await docxLens.open(await essay());
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "update-section", page: { left: 2_000, top: 900 } });
    const section = await sectionXml(output);
    expect(section).toMatch(/w:left="2000"/u);
    expect(section).toMatch(/w:top="900"/u);
    expect(section).toMatch(/w:right="1134"/u);
    const reopened = await docxLens.open(output);
    expect(reopened.projection.pageSetup?.page).toMatchObject({ left: 2_000, top: 900, right: 1_134, bottom: 1_417 });
  });

  it("presets keep the numbers they do not speak for", () => {
    const setup = { size: "a4", orientation: "portrait" as const, margins: "normal", page: { ...pageGeometry({ size: "a4" }), header: 400 } };
    const landscape = withPreset(setup, { orientation: "landscape" });
    expect(landscape.page.width).toBe(16_838);
    expect(landscape.page.height).toBe(11_906);
    expect(landscape.page.header).toBe(400);
    const narrow = withPreset(landscape, { margins: "narrow" });
    expect(narrow.page).toMatchObject({ top: 680, left: 680, width: 16_838 });
  });
});
