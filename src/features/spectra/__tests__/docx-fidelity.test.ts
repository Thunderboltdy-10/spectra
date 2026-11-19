import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { exportDocxCopy, importDocxPayload } from "../lenses/docx-adapter";
import { docxLens } from "../lenses/docx-lens";
import { docxProjectionFromContent, type DocumentJsonNode } from "../lenses/document-projection";
import { documentBlocksFromJson } from "../../../../shared/document-projection.mjs";

const t = (text: string, marks?: DocumentJsonNode["marks"]) => ({ type: "text", text, ...(marks ? { marks } : {}) }) as DocumentJsonNode;
const p = (...content: DocumentJsonNode[]) => ({ type: "paragraph", content }) as DocumentJsonNode;
const li = (...content: DocumentJsonNode[]) => ({ type: "listItem", content }) as DocumentJsonNode;

const blocks: DocumentJsonNode[] = [
  p(t("x"), t("2", [{ type: "superscript" }]), t(" H"), t("2", [{ type: "subscript" }]), t("O"), t(" run()", [{ type: "code" }]),
    t(" big", [{ type: "textStyle", attrs: { fontSize: "18pt" } }]), t(" caps", [{ type: "allCaps" }])),
  { type: "orderedList", content: [li(p(t("first"))), li(p(t("second")))] } as DocumentJsonNode,
  { type: "taskList", content: [
    { type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] },
    { type: "taskItem", attrs: { checked: false }, content: [p(t("open"))] },
  ] } as DocumentJsonNode,
  { type: "horizontalRule" } as DocumentJsonNode,
  { type: "table", content: [
    { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2 }, content: [p(t("Wide"))] }] },
    { type: "tableRow", content: [{ type: "tableCell", attrs: { rowspan: 2 }, content: [p(t("Tall"))] }, { type: "tableCell", content: [p(t("b1"))] }] },
    { type: "tableRow", content: [{ type: "tableCell", content: [p(t("b2"))] }] },
  ] } as DocumentJsonNode,
  { type: "pageBreak" } as DocumentJsonNode,
  p(t("After")),
];

async function documentXml(bytes: Uint8Array) {
  const JSZip = (await import("jszip")).default;
  return (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
}

const marksOf = (json: DocumentJsonNode, text: string) => {
  const found: string[] = [];
  const visit = (node: DocumentJsonNode) => {
    if (node.text === text) found.push(...(node.marks ?? []).map((mark) => mark.type));
    node.content?.forEach(visit);
  };
  visit(json);
  return found;
};

describe("Word fidelity", () => {
  it("keeps character formats, numbering, checklists, dividers, merges and page breaks in a Word copy", async () => {
    const { bytes, conversion } = await exportDocxCopy({ type: "doc", content: blocks });
    expect(conversion.notes.filter((note) => note.level === "unsupported")).toEqual([]);
    const xml = await documentXml(bytes);
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>');
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>');
    expect(xml).toContain('<w:sz w:val="36"/>');
    expect(xml).toContain("<w:caps/>");
    expect(xml).toMatch(/Consolas[^]*run\(\)/);
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain("☒ ");
    expect(xml).not.toContain("Unsupported");

    const back = (await importDocxPayload(bytes)).json;
    expect(marksOf(back, "2")).toContain("superscript");
    // The Word list opens again as one list of two items.
    const lists = (back.content ?? []).filter((node) => node.type === "orderedList");
    expect(lists.map((node) => [node.attrs?.start, node.content?.length])).toEqual([[1, 2]]);
  });

  it("syncs the same content into a linked Word file, merged table included", async () => {
    const source = Document.create();
    source.addParagraph("Intro");
    const opened = await docxLens.open(await source.save());
    const tiptap = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { blockId: opened.projection.blocks[0]!.id }, content: [t("Intro")] },
        ...blocks.map((node, index) => ({ ...node, attrs: { ...(node.attrs ?? {}), blockId: `n${index}` } })),
      ],
    } as DocumentJsonNode;
    const update = docxProjectionFromContent(
      { tiptap, blocks: documentBlocksFromJson(tiptap), nativeProjectionComplete: true },
      opened.projection,
    );
    const xml = await documentXml(await docxLens.materialize({ projection: update.projection, carry: opened.preservedCarry }));
    expect(xml).toContain("Wide");
    expect(xml).toContain("Tall");
    expect(xml).toMatch(/Consolas[^]*run\(\)/);
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toMatch(/<w:pBdr><w:bottom /);
    expect(xml).toContain("☐ open");
  });

  const wordShapes = [
    { type: "orderedList", attrs: { start: 3 }, content: [li(p(t("three"))), li(p(t("four")), { type: "bulletList", content: [li(p(t("nested a"))), li(p(t("nested b")), { type: "orderedList", content: [li(p(t("deep 1")))] } as DocumentJsonNode)] } as DocumentJsonNode)] },
    p(t("Between")),
    { type: "pageBreak" },
    p(t("After the break")),
    blocks.find((node) => node.type === "table")!,
  ] as DocumentJsonNode[];

  it("keeps a list's start, nested levels and kinds, page breaks and merged cells through Word and back", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: wordShapes });
    const JSZip = (await import("jszip")).default;
    const numbering = await (await JSZip.loadAsync(bytes)).file("word/numbering.xml")!.async("string");
    expect(numbering).toMatch(/<w:lvl w:ilvl="0"><w:start w:val="3"\/><w:numFmt w:val="decimal"\/>/);
    expect(numbering).toMatch(/<w:lvl w:ilvl="1"><w:start w:val="1"\/><w:numFmt w:val="bullet"\/>/);

    const back = (await importDocxPayload(bytes)).json.content ?? [];
    // Lists as [type, start, level, items]; items as [text, ...nested lists].
    const outline = (node: DocumentJsonNode): unknown => node.type === "listItem"
      ? [node.content?.[0]?.content?.[0]?.text, ...(node.content ?? []).slice(1).map(outline)]
      : [node.type, node.attrs?.start ?? null, node.attrs?.listLevel ?? 0, (node.content ?? []).map(outline)];
    expect(back.filter((node) => String(node.type).endsWith("List")).map(outline)).toEqual([
      ["orderedList", 3, 0, [
        ["three"],
        ["four", ["bulletList", null, 0, [
          ["nested a"],
          ["nested b", ["orderedList", 1, 0, [["deep 1"]]]],
        ]]],
      ]],
    ]);
    expect(back.map((node) => node.type)).toContain("pageBreak");
    expect(back.some((node) => node.type === "paragraph" && !node.content?.length)).toBe(false);
    const table = back.find((node) => node.type === "table")!;
    expect(table.content?.map((row) => row.content?.map((cell) => [cell.attrs?.colspan ?? 1, cell.attrs?.rowspan ?? 1]))).toEqual([
      [[2, 1]],
      [[1, 2], [1, 1]],
      [[1, 1]],
    ]);
  });

  it("reads Word's merged cells and page breaks back without a change, and edits a merged table in place", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: wordShapes });
    const opened = await docxLens.open(bytes);
    const tiptap = (await importDocxPayload(bytes)).json;
    const unchanged = docxProjectionFromContent(
      { tiptap, blocks: documentBlocksFromJson(tiptap), nativeProjectionComplete: true },
      opened.projection,
    );
    expect(unchanged.operations).toEqual([]);

    const edited = JSON.parse(JSON.stringify(tiptap).replace('"b2"', '"B two"')) as DocumentJsonNode;
    const update = docxProjectionFromContent(
      { tiptap: edited, blocks: documentBlocksFromJson(edited), nativeProjectionComplete: true },
      opened.projection,
    );
    expect(update.operations).toEqual([expect.objectContaining({ kind: "edit-table-cell", row: 2, column: 1, text: "B two" })]);
    const xml = await documentXml(await docxLens.materialize({ projection: update.projection, carry: opened.preservedCarry }));
    expect(xml).toContain("B two");
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml.match(/<w:br w:type="page"\/>/g)).toHaveLength(1);
  });
});
