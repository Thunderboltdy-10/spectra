import { describe, expect, it } from "vitest";
import * as docx from "docx";
import JSZip from "jszip";
import { docxLens } from "../lenses/docx-lens";

async function paged(headerLines: string[]) {
  const document = new docx.Document({
    sections: [{
      headers: {
        default: new docx.Header({
          children: headerLines.map((line, index) => new docx.Paragraph({
            alignment: index === 0 ? docx.AlignmentType.RIGHT : undefined,
            children: [new docx.TextRun({ text: line, bold: index === 0 })],
          })),
        }),
      },
      footers: {
        default: new docx.Footer({
          children: [new docx.Paragraph({ children: [new docx.TextRun("Page "), new docx.TextRun({ children: [docx.PageNumber.CURRENT] }), new docx.TextRun(" of the essay")] })],
        }),
      },
      children: [new docx.Paragraph("Body")],
    }],
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

async function part(bytes: Uint8Array, name: "header" | "footer") {
  const zip = await JSZip.loadAsync(bytes);
  const file = Object.keys(zip.files).find((path) => new RegExp(String.raw`^word/${name}\d*\.xml$`, "u").test(path))!;
  const xml = await zip.file(file)!.async("string");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/gu) ?? []).map((paragraph) => ({
    text: [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/gu)].map((match) => match[1]).join(""),
    field: /fldChar|fldSimple/u.test(paragraph),
    right: paragraph.includes('<w:jc w:val="right"/>'),
    bold: /<w:b\/>|<w:b w:val="(?:true|1|on)"/u.test(paragraph),
  }));
}

describe("Word headers and footers keep their structure through edits", () => {
  it("changes one line of a header without duplicating or merging the others", async () => {
    const opened = await docxLens.open(await paged(["Candidate 001", "Extended essay"]));
    expect(opened.projection.pageSetup?.header).toBe("Candidate 001\nExtended essay");
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "update-header-footer", slot: "header", text: "Candidate 001\nExtended essay in physics" });
    expect(await part(output, "header")).toEqual([
      { text: "Candidate 001", field: false, right: true, bold: true },
      { text: "Extended essay in physics", field: false, right: false, bold: false },
    ]);
    const reopened = await docxLens.open(output);
    expect(reopened.projection.pageSetup?.header).toBe("Candidate 001\nExtended essay in physics");
  });

  it("adds and removes header lines as paragraphs", async () => {
    const opened = await docxLens.open(await paged(["Candidate 001", "Extended essay"]));
    const added = await docxLens.mutate(opened.preservedCarry, { kind: "update-header-footer", slot: "header", text: "Candidate 001\nExtended essay\nMay 2027" });
    expect((await part(added, "header")).map((paragraph) => paragraph.text)).toEqual(["Candidate 001", "Extended essay", "May 2027"]);
    const removed = await docxLens.mutate((await docxLens.open(added)).preservedCarry, { kind: "update-header-footer", slot: "header", text: "Candidate 001" });
    expect(await part(removed, "header")).toEqual([{ text: "Candidate 001", field: false, right: true, bold: true }]);
  });

  it("edits the words around a page number and keeps the field", async () => {
    const opened = await docxLens.open(await paged(["Essay"]));
    const footer = opened.projection.pageSetup?.footer ?? "";
    expect(footer.startsWith("Page ")).toBe(true);
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "update-header-footer", slot: "footer", text: footer.replace("of the essay", "of the extended essay"),
    });
    const [paragraph] = await part(output, "footer");
    expect(paragraph?.field).toBe(true);
    expect(paragraph?.text.startsWith("Page ")).toBe(true);
    expect(paragraph?.text.endsWith(" of the extended essay")).toBe(true);
    expect(paragraph?.text.match(/Page /gu)?.length).toBe(1);
  });

  it("refuses an edit that would overwrite the page number itself", async () => {
    const opened = await docxLens.open(await paged(["Essay"]));
    await expect(docxLens.mutate(opened.preservedCarry, { kind: "update-header-footer", slot: "footer", text: "Draft" }))
      .rejects.toMatchObject({ code: "DOCX_REGION_READ_ONLY" });
  });

  it("writes a new header one paragraph per line", async () => {
    const document = new docx.Document({ sections: [{ children: [new docx.Paragraph("Body")] }] });
    const opened = await docxLens.open(new Uint8Array(await docx.Packer.toBuffer(document)));
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "update-header-footer", slot: "header", text: "Name\nSubject" });
    expect((await part(output, "header")).map((paragraph) => paragraph.text)).toEqual(["Name", "Subject"]);
  });
});
