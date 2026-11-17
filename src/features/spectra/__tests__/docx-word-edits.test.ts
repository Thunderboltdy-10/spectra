import { describe, expect, it } from "vitest";
import * as docx from "docx";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { docxProjectionFromContent } from "../lenses/document-projection";

async function tableWithLink() {
  const cell = (children: unknown[]) => new docx.TableCell({ children: children as never });
  const text = (value: string) => new docx.Paragraph({ children: [new docx.TextRun(value)] });
  const document = new docx.Document({
    sections: [{
      children: [
        text("Before the table."),
        new docx.Table({
          rows: [
            new docx.TableRow({ children: [cell([text("Criterion")]), cell([text("Source")])] }),
            new docx.TableRow({
              children: [
                cell([text("A long piece of evidence that wraps across lines.")]),
                cell([new docx.Paragraph({ children: [new docx.ExternalHyperlink({ link: "https://example.com/a", children: [new docx.TextRun("Source A")] })] })]),
              ],
            }),
          ],
        }),
      ],
    }],
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

describe("Word tables with links", () => {
  it("stay editable and keep their links when another cell changes", async () => {
    const opened = await docxLens.open(await tableWithLink());
    const table = opened.projection.blocks.find((block) => block.type === "table")!;
    expect(table.attrs?.nativeReadOnly).toBeUndefined();
    expect(opened.fidelityMap.entries.find((entry) => entry.regionId === table.id)?.readOnly).toBeUndefined();

    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "edit-table-cell",
      regionId: table.id,
      row: 1,
      column: 0,
      text: "Shorter evidence.",
    });
    const reopened = await docxLens.open(output);
    const after = reopened.projection.blocks.find((block) => block.id === table.id)!;
    expect(after.rows?.[1]?.[0]).toBe("Shorter evidence.");
    expect(JSON.stringify(after.richRows?.[1]?.[1])).toContain("https://example.com/a");
  });
});

describe("Word equations", () => {
  it("move from the sentence onto their own line and survive Word's readback", async () => {
    const document = new docx.Document({
      sections: [{
        children: [
          new docx.Paragraph({
            children: [
              new docx.TextRun("Inline "),
              new docx.Math({ children: [new docx.MathFraction({ numerator: [new docx.MathRun("1")], denominator: [new docx.MathRun("2")] })] }),
              new docx.TextRun(" in text."),
            ],
          }),
        ],
      }],
    });
    const opened = await docxLens.open(new Uint8Array(await docx.Packer.toBuffer(document)));
    const base = opened.projection;
    const paragraph = base.blocks[0]!;
    expect(paragraph.inlineContent?.some((item) => item.kind === "equation")).toBe(true);
    const blocks = [
      { ...paragraph, text: "Inline  in text.", inlineContent: [{ kind: "text" as const, text: "Inline " }, { kind: "text" as const, text: " in text." }] },
      { id: "docx:equation:moved", type: "equation" as const, text: "\frac{1}{2}", inlineContent: [{ kind: "equation" as const, latex: "\frac{1}{2}", display: "block" as const }], attrs: { display: "block", alignment: "center" } },
    ];
    const { projection, operations } = docxProjectionFromContent({ ...base, blocks }, base);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    const reopened = await docxLens.open(output, "strict-native");
    expect(await docxProjectionReadbackDigest(reopened.projection, projection)).toBe(await docxProjectionSemanticDigest(projection));
    expect(reopened.projection.blocks[1]?.type).toBe("equation");
  });
});
