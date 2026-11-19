import { describe, expect, it } from "vitest";
import * as docx from "docx";
import JSZip from "jszip";
import { docxLens } from "../lenses/docx-lens";
import {
  docxProjectionFromContent,
  documentBlocksFromJson,
  documentContentToProseMirrorJson,
  type DocumentJsonNode,
} from "../lenses/document-projection";

const PARAGRAPH = " ";

async function worksheet() {
  const cell = (children: unknown[]) => new docx.TableCell({ children: children as never });
  const document = new docx.Document({
    sections: [{
      children: [
        new docx.Paragraph({ children: [new docx.TextRun("Worksheet")] }),
        new docx.Table({
          rows: [
            new docx.TableRow({ children: [cell([new docx.Paragraph("Task")]), cell([new docx.Paragraph("Notes")])] }),
            new docx.TableRow({
              children: [
                cell([new docx.Paragraph("Describe the method.")]),
                cell([
                  new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun("Step one")] }),
                  new docx.Paragraph({ spacing: { after: 240 }, children: [new docx.TextRun("Step two")] }),
                  new docx.Paragraph({ children: [new docx.TextRun("Step three")] }),
                ]),
              ],
            }),
          ],
        }),
      ],
    }],
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

/** The paragraphs of the last cell of the table, as Word stores them. */
async function lastCellParagraphs(bytes: Uint8Array) {
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  const cells = xml.match(/<w:tc>[\s\S]*?<\/w:tc>/gu) ?? [];
  return (cells.at(-1)?.match(/<w:p[ >][\s\S]*?<\/w:p>/gu) ?? []).map((paragraph) => ({
    text: [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/gu)].map((match) => match[1]).join(""),
    centered: paragraph.includes('<w:jc w:val="center"/>'),
    spaced: /<w:spacing [^>]*w:after="240"/u.test(paragraph),
  }));
}

function cellNode(json: DocumentJsonNode) {
  const table = json.content?.find((node) => node.type === "table");
  return table?.content?.[1]?.content?.[1];
}

describe("Word table cells keep their paragraphs", () => {
  it("opens a cell of several paragraphs as several editor paragraphs", async () => {
    const opened = await docxLens.open(await worksheet());
    const table = opened.projection.blocks.find((block) => block.type === "table")!;
    expect(table.rows?.[1]?.[1]).toBe("Step one\nStep two\nStep three");
    expect(table.richRows?.[1]?.[1]).toEqual([{ kind: "text", text: `Step one${PARAGRAPH}Step two${PARAGRAPH}Step three` }]);
    const cell = cellNode(documentContentToProseMirrorJson(opened.projection) as DocumentJsonNode);
    expect(cell?.content?.map((node) => node.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });

  it("writes an edit inside one cell paragraph back without merging the others", async () => {
    const opened = await docxLens.open(await worksheet());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    const second = cellNode(json)!.content![1]!;
    second.content = [{ type: "text", text: "Step two, revised" }];
    // Enter at the end of the cell: a fourth paragraph.
    cellNode(json)!.content!.push({ type: "paragraph", content: [{ type: "text", text: "Step four" }] });
    const blocks = documentBlocksFromJson(json);
    const { operations } = docxProjectionFromContent({ ...base, tiptap: json, blocks, nativeProjectionComplete: true }, base);
    expect(operations.map((operation) => operation.kind)).toEqual(["edit-table-cell"]);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    expect(await lastCellParagraphs(output)).toEqual([
      { text: "Step one", centered: true, spaced: false },
      { text: "Step two, revised", centered: false, spaced: true },
      { text: "Step three", centered: false, spaced: false },
      { text: "Step four", centered: false, spaced: false },
    ]);
  });

  it("removes only the paragraphs the writer deleted", async () => {
    const opened = await docxLens.open(await worksheet());
    const table = opened.projection.blocks.find((block) => block.type === "table")!;
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "edit-table-cell", regionId: table.id, row: 1, column: 1,
      text: "Step one\nStep three",
      inlineContent: [{ kind: "text", text: `Step one${PARAGRAPH}Step three` }],
    });
    expect((await lastCellParagraphs(output)).map((paragraph) => paragraph.text)).toEqual(["Step one", "Step three"]);
  });

  it("reads an older client's line breaks as the paragraphs of a cell that has no breaks", async () => {
    const opened = await docxLens.open(await worksheet());
    const table = opened.projection.blocks.find((block) => block.type === "table")!;
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "edit-table-cell", regionId: table.id, row: 1, column: 1, text: "Step one\nStep 2\nStep three",
    });
    expect(await lastCellParagraphs(output)).toEqual([
      { text: "Step one", centered: true, spaced: false },
      { text: "Step 2", centered: false, spaced: true },
      { text: "Step three", centered: false, spaced: false },
    ]);
  });

  it("sees no edit when only the base predates paragraph marks", async () => {
    const opened = await docxLens.open(await worksheet());
    const base = opened.projection;
    // A projection stored before cells marked their paragraphs.
    const legacy = {
      ...base,
      blocks: base.blocks.map((block) => {
        if (block.type !== "table") return block;
        const { richRows: _richRows, ...rest } = block;
        return rest;
      }),
    };
    const blocks = documentBlocksFromJson(documentContentToProseMirrorJson(base) as DocumentJsonNode);
    expect(docxProjectionFromContent({ ...legacy, blocks }, legacy).operations).toEqual([]);
  });
});
