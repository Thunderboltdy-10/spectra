import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { exportDocxCopy, importDocxPayload } from "../lenses/docx-adapter";
import { docxLens, type DocxProjection } from "../lenses/docx-lens";
import { docxOperationsBetween } from "../lenses/document-projection";
import { latexToEquation } from "../lenses/equation-interchange";
import type { DocumentJsonNode } from "../lenses/document-projection";

const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const fixture = (name: string) =>
  readFile(join(process.cwd(), "fixtures", "office", "docx", name)).then(
    (bytes) => new Uint8Array(bytes),
  );

function richDocument(): DocumentJsonNode {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, blockId: "heading-1" },
        content: [{ type: "text", text: "Water cycle" }],
      },
      {
        type: "paragraph",
        attrs: { blockId: "paragraph-1" },
        content: [
          {
            type: "text",
            text: "English 日本語 العربية",
            marks: [
              { type: "bold" },
              { type: "italic" },
              { type: "textStyle", attrs: { fontFamily: "游ゴシック", fontSize: "13pt", color: "1F3A2E" } },
              { type: "highlight", attrs: { color: "FEF0C7" } },
            ],
          },
          {
            type: "text",
            text: " source",
            marks: [{ type: "link", attrs: { href: "https://example.edu/water" } }],
          },
        ],
      },
      {
        type: "bulletList",
        attrs: { blockId: "list-1" },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Evaporation" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Condensation" }] }] },
        ],
      },
      {
        type: "table",
        attrs: { blockId: "table-1" },
        content: [
          { type: "tableRow", content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Stage" }] }] },
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Evidence" }] }] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Rain" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Clouds" }] }] },
          ] },
        ],
      },
      { type: "image", attrs: { src: onePixelPng, alt: "Water cycle diagram", widthPercent: 50 } },
    ],
  };
}

describe("shared DOCX adapter", () => {
  it("creates a native rich package with mixed runs, links, lists, tables, and media", async () => {
    const { bytes, conversion } = await exportDocxCopy(richDocument());
    expect(conversion.notes.some((note) => note.level === "unsupported")).toBe(false);
    const opened = await docxLens.open(bytes);
    const rich = opened.projection.blocks.find((block) => block.text.includes("English 日本語 العربية"));
    expect(rich?.inlineContent).toEqual([
      expect.objectContaining({
        kind: "text",
        text: "English 日本語 العربية",
        format: expect.objectContaining({ bold: true, italic: true, fontFamily: "游ゴシック" }),
      }),
      expect.objectContaining({ kind: "text", href: "https://example.edu/water" }),
    ]);
    expect(opened.projection.blocks.some((block) => block.type === "list")).toBe(true);
    expect(opened.projection.blocks.find((block) => block.type === "table")?.rows).toEqual([
      ["Stage", "Evidence"],
      ["Rain", "Clouds"],
    ]);
    const document = await Document.open(bytes);
    expect(document.images()).toHaveLength(1);
    expect(document.office.mainPart.relationships().byType(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
    )).toHaveLength(1);
  });

  it("carries the existing document page controls into a new Word copy", async () => {
    const { bytes } = await exportDocxCopy(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Page setup" }] }] },
      {
        pageSetup: {
          size: "letter",
          orientation: "landscape",
          margins: "narrow",
          columns: 2,
          header: "Science 101",
          footer: "Page note",
        },
      },
    );
    const document = await Document.open(bytes);
    expect(document.headers()[0]?.text()).toBe("Science 101");
    expect(document.footers()[0]?.text()).toBe("Page note");
    const section = document.body().find(WML_NAMESPACE, "sectPr");
    expect(section?.find(WML_NAMESPACE, "pgSz")?.getAttributeNs(WML_NAMESPACE, "orient")).toBe("landscape");
    expect(section?.find(WML_NAMESPACE, "cols")?.getAttributeNs(WML_NAMESPACE, "num")).toBe("2");
    expect(section?.find(WML_NAMESPACE, "pgMar")?.getAttributeNs(WML_NAMESPACE, "top")).toBe("680");
  });

  it("detects formatting-only edits when visible text is unchanged", () => {
    const before: DocxProjection = {
      blocks: [{ id: "p", type: "paragraph", text: "Same", inlineContent: [{ kind: "text", text: "Same", format: { bold: true } }] }],
      outline: [],
      nativeBinding: { version: 1, profile: "strict-native", format: "docx", macroEnabled: false, semanticDigest: "a".repeat(64), nativePlaceholders: [] },
    };
    const after = structuredClone(before);
    const inline = after.blocks[0]!.inlineContent![0];
    if (inline?.kind !== "text") throw new Error("test fixture lost its text run");
    inline.format = { bold: false, italic: true };
    const operations = docxOperationsBetween(before, after);
    expect(operations).toEqual([
      expect.objectContaining({ kind: "replace-paragraph", text: "Same", inlineContent: [expect.objectContaining({ format: { bold: false, italic: true } })] }),
    ]);
  });

  it("imports through the same projection and returns editable media instead of Mammoth HTML", async () => {
    const result = await importDocxPayload(await fixture("complex-structure.docx"));
    expect(result.conversion.notes[0]?.message).toContain("shared native DOCX projection");
    const serialized = JSON.stringify(result.json);
    expect(serialized).not.toContain("nativeDocxImage");
    expect(serialized).not.toContain("mammoth");
  });

  it("carries native OMML through ordinary import and copy export without converting it", async () => {
    const imported = await importDocxPayload(await fixture("equation-omml.docx"));
    expect(JSON.stringify(imported.json)).toContain("ommlXml");
    const importedMarkup: string[] = [];
    const collectMarkup = (node: DocumentJsonNode) => {
      if ((node.type === "inlineEquation" || node.type === "equation") && typeof node.attrs?.ommlXml === "string")
        importedMarkup.push(node.attrs.ommlXml);
      node.content?.forEach(collectMarkup);
    };
    collectMarkup(imported.json);
    expect(importedMarkup.some((markup) => markup.includes("<m:nary>"))).toBe(true);
    const copy = await exportDocxCopy(imported.json);
    const reopened = await docxLens.open(copy.bytes);
    const copiedMarkup = reopened.projection.blocks.flatMap((block) => block.inlineContent ?? [])
      .filter((item) => item.kind === "equation")
      .map((item) => item.ommlXml)
      .filter((markup): markup is string => Boolean(markup));
    expect(copiedMarkup).toEqual(importedMarkup);
    expect(
      reopened.projection.blocks.some((block) =>
        block.inlineContent?.some(
          (item) => item.kind === "equation" && Boolean(item.ommlXml),
        ),
      ),
    ).toBe(true);
    expect(copy.conversion.notes.some((note) => note.scope === "equations" && note.level === "unsupported")).toBe(false);
  });

  it("regenerates a retained equation when the editor changes its source", async () => {
    const imported = await importDocxPayload(await fixture("equation-omml.docx"));
    const edited = structuredClone(imported.json);
    let changed = false;
    const visit = (node: DocumentJsonNode) => {
      if ((node.type === "inlineEquation" || node.type === "equation") && !changed) {
        node.attrs = {
          ...(node.attrs ?? {}),
          latex: String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`,
        };
        changed = true;
      }
      node.content?.forEach(visit);
    };
    visit(edited);
    expect(changed).toBe(true);

    const copy = await exportDocxCopy(edited);
    const reopened = await docxLens.open(copy.bytes);
    const equations = reopened.projection.blocks.flatMap((block) => block.inlineContent ?? [])
      .filter((item) => item.kind === "equation");
    expect(equations.filter((item) => item.kind === "equation" && item.latex.includes("\\begin{bmatrix}")).length).toBe(1);
  });

  it("round-trips inline and block equation edits through the native projection writer", async () => {
    const source = await exportDocxCopy({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Inline: " },
            { type: "inlineEquation", attrs: { latex: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}` } },
          ],
        },
        {
          type: "equation",
          attrs: { latex: String.raw`\sum_{i=1}^{n} i`, display: "block" },
        },
      ],
    });
    const base = await docxLens.open(source.bytes);
    const projection = structuredClone(base.projection);
    const equations = projection.blocks.flatMap((block) =>
      (block.inlineContent ?? []).map((item) => ({ block, item })),
    ).filter(({ item }) => item.kind === "equation");
    expect(equations).toHaveLength(2);
    for (const { item } of equations) {
      if (item.kind !== "equation") continue;
      item.latex = item.display === "inline"
        ? String.raw`\begin{bmatrix}{a+1}&b\\c&d^2\end{bmatrix}`
        : String.raw`\begin{aligned}x&=\frac{\sqrt[3]{x_1^2}}{\sum_{i=1}^{n} i}\\y&=1\end{aligned}`;
    }

    const output = await docxLens.materialize({ projection, carry: base.preservedCarry });
    const reopened = await docxLens.open(output);
    const recovered = reopened.projection.blocks.flatMap((block) => block.inlineContent ?? [])
      .filter((item) => item.kind === "equation");
    expect(recovered).toHaveLength(2);
    expect(recovered.some((item) => item.kind === "equation" && item.display === "inline" && item.latex.includes("\\begin{bmatrix}"))).toBe(true);
    expect(recovered.some((item) => item.kind === "equation" && item.display === "block" && item.latex.includes("\\begin{aligned}") && item.latex.includes("&"))).toBe(true);
    for (const item of recovered) {
      if (item.kind !== "equation") continue;
      expect(latexToEquation(item.latex, item.display).supported).toBe(true);
    }

  });

  it("embeds an authored image inside a mixed paragraph instead of replacing it with alt text", async () => {
    const { bytes } = await exportDocxCopy({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Before " },
            { type: "image", attrs: { src: onePixelPng, alt: "inline diagram" } },
            { type: "text", text: " after" },
          ],
        },
      ],
    });
    const opened = await docxLens.open(bytes);
    const inline = opened.projection.blocks[0]?.inlineContent ?? [];
    expect(inline.map((item) => item.kind)).toEqual(["text", "image", "text"]);
    expect((await Document.open(bytes)).images()).toHaveLength(1);
  });

  it("makes supported imported media editable in the ordinary copy", async () => {
    const source = await exportDocxCopy(richDocument());
    const imported = await importDocxPayload(source.bytes);
    const serialized = JSON.stringify(imported.json);
    expect(serialized).toContain('"type":"image"');
    expect(serialized).not.toContain("nativeReadOnly");
  });

  it("writes table row and column topology through native operations", async () => {
    const base = await docxLens.open(await exportDocxCopy(richDocument()).then((result) => result.bytes));
    const table = base.projection.blocks.find((block) => block.type === "table")!;
    const projection = structuredClone(base.projection);
    const edited = projection.blocks.find((block) => block.id === table.id)!;
    edited.rows!.push(["Runoff", "River"]);
    edited.rows!.forEach((row) => row.push("Class note"));
    const output = await docxLens.materialize({ projection, carry: base.preservedCarry });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.find((block) => block.id === table.id)?.rows).toEqual([
      ["Stage", "Evidence", "Class note"],
      ["Rain", "Clouds", "Class note"],
      ["Runoff", "River", "Class note"],
    ]);
  });

  it("writes native image description, dimensions, and crop without rebuilding the package", async () => {
    const base = await docxLens.open(await exportDocxCopy(richDocument()).then((result) => result.bytes));
    const imageBlock = base.projection.blocks.find((block) =>
      block.inlineContent?.some((item) => item.kind === "image"),
    );
    const image = imageBlock?.inlineContent?.find((item) => item.kind === "image");
    if (!imageBlock || !image || image.kind !== "image") throw new Error("image fixture was not projected");

    const projection = structuredClone(base.projection);
    const edited = projection.blocks.find((block) => block.id === imageBlock.id)!;
    const editedImage = edited.inlineContent?.find((item) => item.kind === "image");
    if (!editedImage || editedImage.kind !== "image") throw new Error("image fixture was not cloned");
    editedImage.altText = "Updated water cycle diagram";
    editedImage.widthEmu = (editedImage.widthEmu ?? 100_000) + 10_000;
    editedImage.heightEmu = (editedImage.heightEmu ?? 100_000) + 20_000;
    editedImage.crop = { left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 };

    const output = await docxLens.materialize({ projection, carry: base.preservedCarry });
    const reopened = await docxLens.open(output);
    const updated = reopened.projection.blocks
      .find((block) => block.id === imageBlock.id)
      ?.inlineContent?.find((item) => item.kind === "image");
    expect(updated).toEqual(expect.objectContaining({
      kind: "image",
      altText: "Updated water cycle diagram",
      widthEmu: editedImage.widthEmu,
      heightEmu: editedImage.heightEmu,
      crop: { left: 0.1, top: 0.05, right: 0.2, bottom: 0.15 },
    }));
  });
});
