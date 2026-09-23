import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { XmlElement, XmlText } from "@ariadng/office/xml";
import {
  DocxLensError,
  docxLens,
  type DocxAssetResolver,
  type DocxRichInline,
  type DocxRunFormat,
} from "../lenses/docx-lens";
import { comparePackages } from "@ariadng/office/preservation";
import katex from "katex";
import { assertPreservationKept } from "../commands/office/preservation-guard";
import { mergeDocxProjections, contentProjection } from "@/app/api/spectra/lenses/docx/route";
import { compactDocxProjectionForStorage, docxProjectionFromContent } from "../lenses/document-projection";
import { isEquationLatexSupported } from "../lenses/equation-interchange";
import { documentYjsAdapter } from "../work/models/yjs/document-adapter";

const fixture = (name: string) =>
  readFile(join(process.cwd(), "fixtures", "office", "docx", name)).then(
    (bytes) => new Uint8Array(bytes),
  );

/** Every element in the main part, so a test can count Word markup directly. */
function mainElements(root: XmlElement): XmlElement[] {
  const found = [root];
  for (const child of root.children) {
    if (child.kind === "element") found.push(...mainElements(child as XmlElement));
  }
  return found;
}

async function countWml(payload: Uint8Array, localName: string) {
  const document = await Document.open(payload);
  return mainElements(document.body()).filter(
    (element) =>
      element.namespaceUri() === WML_NAMESPACE && element.localName === localName,
  ).length;
}

async function compactedDocxSeam(source: Uint8Array) {
  const opened = await docxLens.open(source, "strict-native");
  const compacted = compactDocxProjectionForStorage(opened.projection);
  const yjs = documentYjsAdapter.createDocument(compacted);
  const afterYjs = documentYjsAdapter.project(yjs);
  const editorContent = {
    ...afterYjs,
    nativeProjectionComplete: true as const,
  };
  const update = docxProjectionFromContent(editorContent, opened.projection);
  const output = await docxLens.materialize({
    projection: update.projection,
    carry: opened.preservedCarry,
  });
  return {
    opened,
    compacted,
    afterYjs,
    update,
    output,
    reopened: await docxLens.open(output, "strict-native"),
  };
}

describe("DOCX preservation lens", () => {
  it("does not rewrite compacted native subtrees across the editor seam", async () => {
    const equationSource = await fixture("equation-omml.docx");
    const equationSeam = await compactedDocxSeam(equationSource);
    const equations = equationSeam.opened.projection.blocks.flatMap((block) => [
      ...(block.inlineContent ?? []),
      ...(block.richRows ?? []).flat(2),
    ]).filter((item) => item.kind === "equation");
    expect(equations.some((item) => isEquationLatexSupported(item.latex))).toBe(true);
    expect(equations.some((item) => !isEquationLatexSupported(item.latex))).toBe(true);
    expect(equationSeam.update.operations).toEqual([]);
    expect(equationSeam.output).toEqual(equationSource);
    expect(equationSeam.reopened.projection.blocks.flatMap((block) => [
      ...(block.inlineContent ?? []),
      ...(block.richRows ?? []).flat(2),
    ]).filter((item) => item.kind === "equation").map((item) => item.ommlXml))
      .toEqual(equations.map((item) => item.ommlXml));

    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const equationFiles = unzipSync(equationSource);
    const documentName = Object.keys(equationFiles).find((name) =>
      name.endsWith("word/document.xml"),
    )!;
    const equationXml = strFromU8(equationFiles[documentName]!);
    const equation = equationXml.match(/<m:oMath>[\s\S]*?<\/m:oMath>/)?.[0];
    expect(equation).toBeTruthy();
    const richTable =
      "<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w=\"4000\"/>" +
      "<w:gridCol w:w=\"4000\"/></w:tblGrid><w:tr>" +
      `<w:tc><w:tcPr/><w:p><w:r><w:t xml:space=\"preserve\">Before </w:t></w:r>${equation}<w:r><w:t xml:space=\"preserve\"> after</w:t></w:r></w:p></w:tc>` +
      "<w:tc><w:tcPr/><w:p><w:r><w:t>Body survives</w:t></w:r></w:p></w:tc>" +
      "</w:tr></w:tbl>";
    equationFiles[documentName] = strToU8(
      equationXml.replace(/<w:sectPr/, `${richTable}<w:sectPr`),
    );
    const tableSource = zipSync(equationFiles);
    const tableSeam = await compactedDocxSeam(tableSource);
    const table = tableSeam.reopened.projection.blocks.find((block) => block.type === "table");
    expect(table?.richRows?.[0]?.[0]?.map((item) => item.kind)).toEqual([
      "text",
      "equation",
      "text",
    ]);
    expect(tableSeam.update.operations).toEqual([]);
    expect(tableSeam.output).toEqual(tableSource);

    const imageDocument = Document.create();
    const png = new Uint8Array(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ));
    imageDocument.addImage(png, { widthPx: 80, altText: "Shared native" });
    const imageParagraph = imageDocument.body().elements().find((element) => element.localName === "p")!;
    const imageRun = imageParagraph.elements().find((element) => element.localName === "r")!;
    const duplicate = imageRun.clone();
    mainElements(duplicate).find(
      (element) =>
        element.namespaceUri() === "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" &&
        element.localName === "docPr",
    )?.setAttribute("id", "999");
    imageParagraph.appendChild(duplicate);
    imageDocument._markMainDirty();
    const imageSource = await imageDocument.save();
    const imageSeam = await compactedDocxSeam(imageSource);
    expect(imageSeam.update.operations).toEqual([]);
    expect((await Document.open(imageSeam.output)).images()).toHaveLength(2);
    expect(imageSeam.reopened.projection.blocks.flatMap((block) =>
      (block.inlineContent ?? []).filter((item) => item.kind === "image"),
    )).toHaveLength(2);

    const neighboringSource = await fixture("complex-structure.docx");
    const neighboringOpened = await docxLens.open(neighboringSource, "strict-native");
    const neighboringYjs = documentYjsAdapter.createDocument(
      compactDocxProjectionForStorage(neighboringOpened.projection),
    );
    const neighboringEditor = documentYjsAdapter.project(neighboringYjs);
    const target = neighboringOpened.projection.blocks.find(
      (block) => block.type !== "table" && block.text.trim().length > 0 && block.attrs?.nativeReadOnly !== true,
    )!;
    const neighbor = neighboringOpened.projection.blocks.find(
      (block) => block.id !== target.id && block.type !== "table" && block.text.trim().length > 0,
    )!;
    const editedText = `${target.text} — edited after compaction`;
    const editedContent = {
      ...neighboringEditor,
      blocks: neighboringEditor.blocks?.map((block) =>
        block.id === target.id ? { ...block, text: editedText } : block,
      ),
      nativeProjectionComplete: true as const,
    };
    const neighboringUpdate = docxProjectionFromContent(
      editedContent,
      neighboringOpened.projection,
    );
    expect(neighboringUpdate.operations).toHaveLength(1);
    expect(neighboringUpdate.operations[0]).toMatchObject({
      kind: "replace-paragraph",
      regionId: target.id,
      text: editedText,
    });
    const neighboringOutput = await docxLens.materialize({
      projection: neighboringUpdate.projection,
      carry: neighboringOpened.preservedCarry,
    });
    const neighboringReopened = await docxLens.open(neighboringOutput, "strict-native");
    expect(neighboringReopened.projection.blocks.find((block) => block.id === target.id)?.text)
      .toBe(editedText);
    expect(neighboringReopened.projection.blocks.find((block) => block.id === neighbor.id)?.text)
      .toBe(neighbor.text);
    const changedParts = (await comparePackages(neighboringSource, neighboringOutput)).parts
      .filter((part) => part.verdict !== "identical")
      .map((part) => part.name);
    expect(changedParts.every((name) => name.endsWith("word/document.xml"))).toBe(true);

    const staleOurs = structuredClone(neighboringOpened.projection);
    const staleExternal = structuredClone(neighboringOpened.projection);
    staleOurs.blocks.find((block) => block.id === target.id)!.text = "Spectra edit";
    staleExternal.blocks.find((block) => block.id === target.id)!.text = "Word edit";
    expect(() => mergeDocxProjections(
      neighboringOpened.projection,
      staleOurs,
      staleExternal,
      undefined,
      true,
    )).toThrow("did not yet have persisted native anchors");
  });

  it("appends beside shared native wrappers without requesting a redundant reorder", async () => {
    const source = await fixture("bibliography-source.docx");
    const opened = await docxLens.open(source);
    const added = {
      id: "spectra-bibliography-append",
      type: "paragraph" as const,
      text: "A safe paragraph after the bibliography wrapper.",
    };
    const output = await docxLens.materialize({
      projection: {
        ...opened.projection,
        blocks: [...opened.projection.blocks, added],
      },
      carry: opened.preservedCarry,
    });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.at(-1)?.text).toBe(added.text);
  });

  it("retains omitted native blocks when materializing a partial live projection", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const retained = opened.projection.blocks[0]!;
    const added = {
      id: "ai-appended-paragraph",
      type: "paragraph" as const,
      text: "AI append survives native merge.",
    };
    const projection = contentProjection(
      { blocks: [retained, added] },
      opened.projection,
    );

    expect(projection.blocks).toHaveLength(opened.projection.blocks.length + 1);
    expect(projection.blocks.at(-1)).toEqual(added);

    const output = await docxLens.materialize({
      projection,
      carry: opened.preservedCarry,
    });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.at(-1)?.text).toBe(added.text);
  });

  it("round-trips a changed table cell without flattening it into prose", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const table = opened.projection.blocks.find((block) => block.type === "table");
    expect(table?.rows?.[0]?.[0]).toContain("Multitasking");
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "edit-table-cell",
      regionId: table!.id,
      row: 0,
      column: 0,
      text: "Parallel work",
    });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.find((block) => block.id === table!.id)?.rows?.[0]?.[0])
      .toBe("Parallel work");
    expect(reopened.projection.blocks.some((block) => block.type !== "table" && block.text.includes("Parallel work"))).toBe(false);
  });

  it("updates a bound table cell and its matching Custom XML value together", async () => {
    const source = await fixture("content-controls-customxml.docx");
    const opened = await docxLens.open(source);
    const table = opened.projection.blocks.find((block) => block.type === "table")!;
    expect(table.rows?.[0]?.[1]).toBe("Eric White");
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "edit-table-cell",
      regionId: table.id,
      row: 0,
      column: 1,
      text: "Ada Lovelace",
    });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.find((block) => block.id === table.id)?.rows?.[0]?.[1])
      .toBe("Ada Lovelace");
    const document = await Document.open(output);
    const customXmlPart = document.office.package.parts().find((part) =>
      /^\/customxml\/item\d*\.xml$/i.test(part.name),
    );
    expect(customXmlPart).toBeTruthy();
    expect((await document.office.xml(customXmlPart!.name)).root.find(null, "Name")?.text())
      .toBe("Ada Lovelace");
    const comparison = await comparePackages(source, output);
    expect(() =>
      assertPreservationKept({
        entries: opened.fidelityMap.entries,
        parts: comparison.parts,
      }),
    ).not.toThrow();
  });

  it("writes tabs and soft line breaks as native run tokens", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const target = opened.projection.blocks.find(
      (block) => block.type !== "table" && block.attrs?.nativeReadOnly !== true,
    )!;
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: target.id,
      text: "First\tSecond\nThird",
    });
    expect(await countWml(output, "tab")).toBeGreaterThan(0);
    expect(await countWml(output, "br")).toBeGreaterThan(0);
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.find((block) => block.id === target.id)?.text)
      .toBe("First\tSecond\nThird");
  });

  it("writes Unicode font names to every Word script slot and clears theme indirection", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const target = opened.projection.blocks.find(
      (block) => block.type !== "table" && block.text.trim().length > 0 && block.attrs?.nativeReadOnly !== true,
    )!;

    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "format-runs",
      regionId: target.id,
      format: { fontFamily: "游ゴシック" },
    });
    const document = await Document.open(output);
    const fonts = mainElements(document.body()).find(
      (element) =>
        element.namespaceUri() === WML_NAMESPACE &&
        element.localName === "rFonts" &&
        element.getAttributeNs(WML_NAMESPACE, "ascii") === "游ゴシック",
    );
    expect(fonts).toBeTruthy();
    for (const slot of ["ascii", "hAnsi", "eastAsia", "cs"])
      expect(fonts!.getAttributeNs(WML_NAMESPACE, slot)).toBe("游ゴシック");
    for (const slot of ["asciiTheme", "hAnsiTheme", "eastAsiaTheme", "csTheme", "cstheme"])
      expect(fonts!.getAttributeNs(WML_NAMESPACE, slot)).toBeUndefined();

    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.find((block) => block.id === target.id)?.attrs?.format)
      .toMatchObject({ fontFamily: "游ゴシック" });
  });

  it("orders newly authored font properties before bold in Word run XML", async () => {
    const sourceDocument = Document.create();
    sourceDocument.addParagraph("Original");
    const opened = await docxLens.open(await sourceDocument.save());
    const target = opened.projection.blocks[0]!;
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: target.id,
      text: "Edited",
      inlineContent: [{ kind: "text", text: "Edited", format: { bold: true, fontFamily: "Calibri", fontSizePoints: 12 } }],
    });
    const document = await Document.open(output);
    const properties = mainElements(document.body()).find((element) => element.localName === "rPr")!;
    expect(properties.elements().map((element) => element.localName)).toEqual(["rFonts", "b", "sz", "szCs"]);
  });

  it("refuses a style alias that has no native style definition", async () => {
    const opened = await docxLens.open(await fixture("complex-structure.docx"));
    const target = opened.projection.blocks.find(
      (block) => block.type !== "table" && block.attrs?.nativeReadOnly !== true,
    )!;
    await expect(docxLens.mutate(opened.preservedCarry, {
      kind: "apply-style",
      regionId: target.id,
      style: "DefinitelyMissingStyle",
    })).rejects.toMatchObject({ code: "DOCX_UNSUPPORTED_EDIT" });
  });

  it("keeps native OMML editable at both command and paragraph seams", async () => {
    const opened = await docxLens.open(await fixture("equation-omml.docx"));
    expect(opened.fidelityMap.entries.find((entry) => entry.feature === "equations"))
      .toMatchObject({ class: "NATIVE" });
    const equation = opened.projection.blocks.find((block) =>
      block.inlineContent?.some((item) => item.kind === "equation"),
    )!;
    const changed = await docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: equation.id,
      text: equation.text,
      inlineContent: [{ kind: "equation", latex: String.raw`\frac{x+1}{2}`, display: "block" }],
    });
    const reopened = await docxLens.open(changed);
    expect(reopened.projection.blocks[0]?.inlineContent?.[0]).toMatchObject({
      kind: "equation",
      latex: String.raw`\frac{x+1}{2}`,
    });
  });

  it("projects mixed and display OMML in native order as valid KaTeX", async () => {
    const source = await fixture("equation-omml.docx");
    const opened = await docxLens.open(source);
    const mixed = opened.projection.blocks[0]!;
    expect(mixed.inlineContent?.map((item) => item.kind)).toEqual([
      "text",
      "equation",
      "text",
    ]);
    expect(mixed.text).toContain("\\alpha{}");
    expect(mixed.text).toContain("(Linear)");

    const equations = opened.projection.blocks.flatMap((block) => [
      ...(block.inlineContent ?? []),
      ...(block.richRows ?? []).flat(2),
    ]).filter((item) => item.kind === "equation");
    expect(equations.some((item) => item.latex.includes("\\frac"))).toBe(true);
    expect(equations.some((item) => item.latex.includes("\\begin{matrix}"))).toBe(true);
    expect(equations.some((item) => item.display === "block")).toBe(true);
    for (const equation of equations)
      expect(() =>
        katex.renderToString(equation.latex, {
          throwOnError: true,
          displayMode: equation.display === "block",
          strict: "ignore",
        }),
      ).not.toThrow();
  });

  it("promotes a paragraph containing only oMathPara to an editable display equation", async () => {
    const source = await fixture("equation-omml.docx");
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const files = unzipSync(source);
    const documentName = Object.keys(files).find((name) =>
      name.endsWith("word/document.xml"),
    )!;
    const xml = strFromU8(files[documentName]!);
    const display = xml.match(/<m:oMathPara>[\s\S]*?<\/m:oMathPara>/)?.[0];
    expect(display).toBeTruthy();
    files[documentName] = strToU8(
      xml.replace(
        /<w:body>[\s\S]*?(<w:sectPr[\s\S]*?<\/w:sectPr>)<\/w:body>/,
        `<w:body><w:p>${display}</w:p>$1</w:body>`,
      ),
    );
    const opened = await docxLens.open(zipSync(files));
    expect(opened.projection.blocks).toHaveLength(1);
    expect(opened.projection.blocks[0]).toMatchObject({
      type: "equation",
      attrs: {
        display: "block",
        alignment: "center",
      },
    });
  });

  it("keeps OMML and surrounding prose inside real Word table cells", async () => {
    const source = await fixture("equation-omml.docx");
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const files = unzipSync(source);
    const documentName = Object.keys(files).find((name) =>
      name.endsWith("word/document.xml"),
    )!;
    const xml = strFromU8(files[documentName]!);
    const equation = xml.match(/<m:oMath>[\s\S]*?<\/m:oMath>/)?.[0];
    expect(equation).toBeTruthy();
    const table =
      "<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w=\"4000\"/>" +
      "<w:gridCol w:w=\"4000\"/></w:tblGrid><w:tr>" +
      `<w:tc><w:tcPr/><w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r>${equation}<w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p></w:tc>` +
      "<w:tc><w:tcPr/><w:p><w:r><w:t>Body survives</w:t></w:r></w:p></w:tc>" +
      "</w:tr></w:tbl>";
    files[documentName] = strToU8(
      xml.replace(/<w:sectPr/, `${table}<w:sectPr`),
    );
    const opened = await docxLens.open(zipSync(files));
    const projected = opened.projection.blocks.find(
      (block) => block.type === "table",
    )!;
    expect(projected.rows?.[0]).toEqual([
      expect.stringMatching(/^Before .* after$/),
      "Body survives",
    ]);
    expect(projected.richRows?.[0]?.[0]?.map((item) => item.kind)).toEqual([
      "text",
      "equation",
      "text",
    ]);
    expect(projected.attrs?.nativeReadOnly).toBeUndefined();
  });

  it("projects an image-only cover as a bounded package reference", async () => {
    const document = Document.create();
    const png = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    document.addImage(png, {
      widthPx: 320,
      altText: "Extended Essay cover",
    });
    const opened = await docxLens.open(await document.save());
    const cover = opened.projection.blocks.find((block) =>
      block.inlineContent?.some((item) => item.kind === "image"),
    )!;
    expect(cover).toMatchObject({
      type: "paragraph",
      inlineContent: [
        {
          kind: "image",
          partName: "/word/media/image1.png",
          mediaType: "image/png",
          altText: "Extended Essay cover",
          placement: "inline",
        },
      ],
    });
    const imageEntry = opened.fidelityMap.entries.find((entry) => entry.regionId === cover.id);
    expect(imageEntry).toMatchObject({ class: "NATIVE" });
    expect(imageEntry?.readOnly).toBeUndefined();
    const serialized = JSON.stringify(opened.projection);
    expect(serialized).not.toContain("iVBORw0KGgo");
    expect(serialized).not.toContain("base64");
  });

  it("inserts an inline equation beside bold text and a retained native image", async () => {
    const sourceDocument = Document.create();
    const png = new Uint8Array(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ));
    const paragraph = sourceDocument.addParagraph("Bold ");
    const textRun = paragraph.element.elements().find((element) => element.localName === "r");
    const textProperties = new XmlElement("rPr", "w");
    textProperties.appendChild(new XmlElement("b", "w"));
    textRun?.insertBefore(textProperties, textRun.children[0] ?? null);
    sourceDocument.addImage(png, { widthPx: 80, altText: "Inline native" });
    const imageParagraph = sourceDocument.body().elements().find(
      (element) => element !== paragraph.element && element.localName === "p",
    );
    const imageRun = imageParagraph?.elements().find((element) => element.localName === "r");
    if (!imageParagraph || !imageRun) throw new Error("inline image fixture was not created");
    imageParagraph.removeChild(imageRun);
    paragraph.element.appendChild(imageRun);
    if (!imageParagraph.elements().length) sourceDocument.body().removeChild(imageParagraph);
    sourceDocument._markMainDirty();

    const opened = await docxLens.open(await sourceDocument.save());
    const target = opened.projection.blocks.find((block) =>
      block.inlineContent?.some((item) => item.kind === "image"),
    )!;
    const image = target.inlineContent?.find((item) => item.kind === "image");
    if (!image || image.kind !== "image") throw new Error("inline image was not projected");
    const nextInline: DocxRichInline[] = [];
    for (const item of target.inlineContent!) {
      if (item.kind === "image")
        nextInline.push({ kind: "equation", latex: "x^2", display: "inline" });
      nextInline.push(item);
    }
    const projection = structuredClone(opened.projection);
    const nextTarget = projection.blocks.find((block) => block.id === target.id)!;
    nextTarget.inlineContent = nextInline as NonNullable<typeof nextTarget.inlineContent>;
    const output = await docxLens.materialize({ projection, carry: opened.preservedCarry });
    const reopened = await docxLens.open(output);
    const result = reopened.projection.blocks.find((block) => block.id === target.id)!;
    expect(result.inlineContent?.map((item) => item.kind)).toEqual(["text", "equation", "image"]);
    expect(result.inlineContent?.find((item) => item.kind === "equation")).toMatchObject({
      display: "inline",
      latex: "{x}^{2}",
    });
    expect(result.inlineContent?.find((item) => item.kind === "text")).toMatchObject({
      format: { bold: true },
    });
    expect(result.inlineContent?.find((item) => item.kind === "image")).toMatchObject({
      occurrenceId: image.occurrenceId,
    });
  });

  it("inserts a block matrix/root equation between Word paragraphs and persists alignment-only edits", async () => {
    const sourceDocument = Document.create();
    sourceDocument.addParagraph("Before");
    sourceDocument.addParagraph("After");
    const opened = await docxLens.open(await sourceDocument.save());
    const latex = String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`;
    const projection = structuredClone(opened.projection);
    projection.blocks.splice(1, 0, {
      id: "equation-between-paragraphs",
      type: "equation",
      text: latex,
      latex,
      inlineContent: [{ kind: "equation", latex, display: "block" }],
      attrs: { display: "block", alignment: "center" },
    });
    const inserted = await docxLens.materialize({ projection, carry: opened.preservedCarry });
    const withEquation = await docxLens.open(inserted);
    const equation = withEquation.projection.blocks.find((block) => block.type === "equation")!;
    expect(withEquation.projection.blocks.map((block) => block.text)).toEqual([
      "Before",
      expect.stringContaining("matrix"),
      "After",
    ]);
    expect(equation).toMatchObject({ type: "equation", attrs: { display: "block", alignment: "center" } });
    expect(equation.inlineContent?.[0]).toMatchObject({ kind: "equation", display: "block" });
    expect(equation.inlineContent?.[0]?.kind === "equation" && equation.inlineContent[0].ommlXml).toContain("oMathPara");

    const alignedProjection = structuredClone(withEquation.projection);
    const aligned = alignedProjection.blocks.find((block) => block.id === equation.id)!;
    aligned.attrs = { ...(aligned.attrs ?? {}), alignment: "left" };
    const alignedBytes = await docxLens.materialize({
      projection: alignedProjection,
      carry: withEquation.preservedCarry,
    });
    const alignedOpen = await docxLens.open(alignedBytes);
    const alignedEquation = alignedOpen.projection.blocks.find((block) => block.id === equation.id)!;
    expect(alignedEquation).toMatchObject({ type: "equation", attrs: { display: "block", alignment: "left" } });
    expect(alignedEquation.inlineContent?.[0]).toMatchObject({ kind: "equation", latex: equation.latex });
    const alignedXml = await Document.open(alignedBytes);
    const alignedParagraph = alignedXml.paragraphs().find((paragraph) =>
      mainElements(paragraph.element).some((element) => element.localName === "oMathPara"),
    );
    expect(alignedParagraph?.element.find(WML_NAMESPACE, "pPr")?.find(WML_NAMESPACE, "jc")
      ?.getAttributeNs(WML_NAMESPACE, "val")).toBe("left");
  });

  it("deletes one shared-media image occurrence and restores it by stable identity", async () => {
    const sourceDocument = Document.create();
    const png = new Uint8Array(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ));
    sourceDocument.addImage(png, { widthPx: 80, altText: "Shared native" });
    const paragraph = sourceDocument.body().elements().find((element) => element.localName === "p")!;
    const imageRun = paragraph.elements().find((element) => element.localName === "r")!;
    const duplicate = imageRun.clone();
    const docPr = mainElements(duplicate).find(
      (element) =>
        element.namespaceUri() === "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" &&
        element.localName === "docPr",
    );
    docPr?.setAttribute("id", "999");
    paragraph.appendChild(duplicate);
    sourceDocument._markMainDirty();

    const opened = await docxLens.open(await sourceDocument.save());
    const target = opened.projection.blocks.find((block) =>
      (block.inlineContent ?? []).filter((item) => item.kind === "image").length === 2,
    )!;
    const images = target.inlineContent!.filter((item) => item.kind === "image");
    expect(images).toHaveLength(2);
    expect(images[0]!.occurrenceId).not.toBe(images[1]!.occurrenceId);
    const deletedProjection = structuredClone(opened.projection);
    const deletedTarget = deletedProjection.blocks.find((block) => block.id === target.id)!;
    deletedTarget.inlineContent = deletedTarget.inlineContent!.filter(
      (item) => item.kind !== "image" || item.occurrenceId !== images[0]!.occurrenceId,
    );
    const deletedBytes = await docxLens.materialize({
      projection: deletedProjection,
      carry: opened.preservedCarry,
    });
    const deletedDocument = await Document.open(deletedBytes);
    expect(deletedDocument.images()).toHaveLength(1);
    const afterDelete = await docxLens.open(deletedBytes);
    const remaining = afterDelete.projection.blocks.find((block) => block.id === target.id)!;
    expect(remaining.inlineContent?.filter((item) => item.kind === "image")).toHaveLength(1);

    const undoProjection = structuredClone(afterDelete.projection);
    const undoTarget = undoProjection.blocks.find((block) => block.id === target.id)!;
    undoTarget.inlineContent = [...undoTarget.inlineContent!, images[0]!];
    const undoBytes = await docxLens.materialize({ projection: undoProjection, carry: afterDelete.preservedCarry });
    const undone = await docxLens.open(undoBytes);
    const restored = undone.projection.blocks.find((block) => block.id === target.id)!;
    expect(restored.inlineContent?.filter((item) => item.kind === "image")).toHaveLength(2);
    expect(restored.inlineContent?.filter((item) => item.kind === "image").map((item) => item.occurrenceId))
      .toEqual(expect.arrayContaining(images.map((item) => item.occurrenceId)));
    expect((await Document.open(undoBytes)).images()).toHaveLength(2);
  });

  it("preserves hyperlink ranges read-only instead of absorbing their text", async () => {
    const source = await fixture("complex-structure.docx");
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const files = unzipSync(source);
    const name = Object.keys(files).find((entry) => entry.endsWith("word/document.xml"))!;
    const xml = strFromU8(files[name]!);
    files[name] = strToU8(xml.replace(
      /(<w:r><w:pict>[\s\S]*?<\/w:r>)/,
      '<w:hyperlink w:anchor="spectra">$1</w:hyperlink>',
    ));
    const opened = await docxLens.open(zipSync(files));
    const linked = opened.projection.blocks.find((block) => block.attrs?.nativeReadOnly === true)!;
    const hyperlinks = opened.fidelityMap.entries.find((entry) => entry.feature === "hyperlinks");
    expect(hyperlinks).toMatchObject({ class: "PRESERVED", readOnly: true });
    expect(hyperlinks?.reason ?? "").toMatch(/preserves hyperlinks/i);
    expect(hyperlinks?.reason ?? "").not.toMatch(/editable when/i);
    await expect(docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: linked.id,
      text: "Would absorb the hyperlink",
    })).rejects.toMatchObject({ code: "DOCX_REGION_READ_ONLY" });
  });

  it("keeps omitted protected-field tails native while rejecting authored read-only edits", async () => {
    const opened = await docxLens.open(await fixture("fields-toc.docx"), "strict-native");
    const protectedParagraph = opened.projection.blocks.find(
      (block) =>
        block.attrs?.nativeReadOnly === true &&
        block.type === "paragraph" &&
        Boolean(block.inlineContent && block.inlineContent.length > 1),
    )!;
    const visiblePrefix = protectedParagraph.inlineContent!.slice(0, 1);
    const visibleText = visiblePrefix
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join("");
    const compacted = compactDocxProjectionForStorage(opened.projection) as {
      blocks: typeof opened.projection.blocks;
      [key: string]: unknown;
    };
    const lossyContent = {
      ...compacted,
      nativeProjectionComplete: true as const,
      blocks: compacted.blocks.map((block) =>
        block.id === protectedParagraph.id
          ? { ...block, text: visibleText, inlineContent: visiblePrefix }
          : block,
      ),
    };
    const unchanged = docxProjectionFromContent(lossyContent, opened.projection);
    expect(unchanged.operations).toEqual([]);
    expect(unchanged.projection.blocks.find((block) => block.id === protectedParagraph.id))
      .toEqual(protectedParagraph);

    const authoredEdit = {
      ...lossyContent,
      blocks: lossyContent.blocks.map((block) =>
        block.id === protectedParagraph.id
          ? {
              ...block,
              text: `${visibleText} authored edit`,
              inlineContent: [{ kind: "text" as const, text: `${visibleText} authored edit` }],
            }
          : block,
      ),
    };
    const unsafe = docxProjectionFromContent(authoredEdit, opened.projection);
    expect(unsafe.operations).toHaveLength(1);
    await expect(docxLens.mutate(opened.preservedCarry, {
      kind: "ai-edit",
      operations: unsafe.operations,
    })).rejects.toMatchObject({ code: "DOCX_REGION_READ_ONLY" });
  });

  it("keeps two tables paired when the first is wrapped in a content control", async () => {
    const source = await fixture("complex-structure.docx");
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const files = unzipSync(source);
    const documentName = Object.keys(files).find((name) => name.endsWith("word/document.xml"))!;
    const xml = strFromU8(files[documentName]!);
    const start = xml.indexOf("<w:tbl>");
    const end = xml.indexOf("</w:tbl>", start) + "</w:tbl>".length;
    const firstTable = xml.slice(start, end);
    files[documentName] = strToU8(
      xml.slice(0, start) +
        "<w:sdt><w:sdtPr/><w:sdtContent>" + firstTable + "</w:sdtContent></w:sdt>" +
        firstTable +
        xml.slice(end),
    );
    const hostile = zipSync(files);
    const opened = await docxLens.open(hostile);
    const tables = opened.projection.blocks.filter((block) => block.type === "table");
    expect(tables).toHaveLength(2);
    const second = tables[1]!;
    const edited = await docxLens.mutate(opened.preservedCarry, {
      kind: "edit-table-cell",
      regionId: second.id,
      row: 0,
      column: 0,
      text: "Only the second table changed",
    });
    const reopened = await docxLens.open(edited);
    const reopenedTables = reopened.projection.blocks.filter((block) => block.type === "table");
    expect(reopenedTables[0]!.rows?.[0]?.[0]).toBe(tables[0]!.rows?.[0]?.[0]);
    expect(reopenedTables[1]!.rows?.[0]?.[0]).toBe("Only the second table changed");
    expect(reopenedTables.map((block) => block.id)).toEqual(tables.map((block) => block.id));
  });

  it("returns the original package for a semantic no-op", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const output = await docxLens.materialize({
      projection: structuredClone(opened.projection),
      carry: opened.preservedCarry,
    });
    expect(Buffer.from(output).equals(Buffer.from(source))).toBe(true);
  });

  it("persists generated paraIds on the first real materialization", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    expect(opened.projection.nativeBinding.identityStable).toBe(false);
    const projection = structuredClone(opened.projection);
    const target = projection.blocks.find(
      (block) => block.type !== "table" && block.attrs?.nativeReadOnly !== true,
    )!;
    target.text = `${target.text} with anchors`;
    const output = await docxLens.materialize({ projection, carry: opened.preservedCarry });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.nativeBinding.identityStable).toBe(true);
    expect(reopened.projection.blocks.map((block) => block.id)).toEqual(
      opened.projection.blocks.map((block) => block.id),
    );
  });

  it("refuses duplicate persisted paraIds instead of guessing a Word region", async () => {
    const source = await fixture("complex-structure.docx");
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const files = unzipSync(source);
    const documentName = Object.keys(files).find((name) => name.endsWith("word/document.xml"))!;
    const xml = strFromU8(files[documentName]!);
    let count = 0;
    const withNamespace = xml.replace(
      /<w:document\b/,
      '<w:document xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
    );
    files[documentName] = strToU8(withNamespace.replace(/<w:p(?=[ >])/g, (match) => {
      count += 1;
      return count <= 2 ? `${match} w14:paraId="ABCDEF12"` : match;
    }));
    await expect(docxLens.open(zipSync(files))).rejects.toMatchObject({
      code: "DOCX_IDENTITY_AMBIGUOUS",
    });
  });

  it("refuses duplicated existing paraIds on a materialized package instead of treating it as corrupt XML", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const projection = structuredClone(opened.projection);
    const target = projection.blocks.find(
      (block) => block.type !== "table" && block.attrs?.nativeReadOnly !== true,
    )!;
    target.text = `${target.text} with duplicated anchors`;
    const materialized = await docxLens.materialize({
      projection,
      carry: opened.preservedCarry,
    });
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
    const files = unzipSync(materialized);
    const documentName = Object.keys(files).find((name) => name.endsWith("word/document.xml"))!;
    let count = 0;
    const xml = strFromU8(files[documentName]!);
    files[documentName] = strToU8(
      xml.replace(/(w14:)?paraId="[^"]+"/g, (match) => {
        count += 1;
        return count <= 2 ? match.replace(/paraId="[^"]+"/, 'paraId="ABCDEF12"') : match;
      }),
    );
    expect(count).toBeGreaterThanOrEqual(2);
    await expect(docxLens.open(zipSync(files))).rejects.toMatchObject({
      code: "DOCX_IDENTITY_AMBIGUOUS",
    });
  });

  it("refuses a concurrent merge whose stored base never persisted native anchors", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const ours = structuredClone(opened.projection);
    const external = structuredClone(opened.projection);
    const target = ours.blocks.find((block) => block.type !== "table" && block.text.trim())!;
    ours.blocks.find((block) => block.id === target.id)!.text = "Spectra edit";
    external.blocks.find((block) => block.id === target.id)!.text = "Word edit";
    expect(() => mergeDocxProjections(opened.projection, ours, external, undefined, true))
      .toThrow("did not yet have persisted native anchors");
    expect(() => mergeDocxProjections(opened.projection, opened.projection, external, undefined, true))
      .not.toThrow();
  });

  it("detects and merges a formatting-only external edit", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const target = opened.projection.blocks.find(
      (block) => block.type !== "table" && block.attrs?.nativeReadOnly !== true && Boolean(block.attrs?.format),
    )!;
    const previousFormat = target.attrs?.format as DocxRunFormat;
    const formatted = await docxLens.mutate(opened.preservedCarry, {
      kind: "format-runs",
      regionId: target.id,
      format: { ...previousFormat, bold: !previousFormat.bold },
    });
    const external = await docxLens.open(formatted);
    const diff = await docxLens.diffExternal(source, formatted);
    expect(diff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ regionId: target.id, kind: "update" }),
    ]));
    const merged = mergeDocxProjections(
      opened.projection,
      opened.projection,
      external.projection,
    );
    expect(merged.conflicts).toEqual([]);
    const mergedFormat = merged.projection.blocks.find((block) => block.id === target.id)?.attrs?.format as DocxRunFormat;
    const externalFormat = external.projection.blocks.find((block) => block.id === target.id)?.attrs?.format as DocxRunFormat;
    expect(mergedFormat.bold).toBe(externalFormat.bold);
  });

  it("keeps a foreign Word insertion while resolving only Spectra's changed region", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const target = opened.projection.blocks.find(
      (block) => block.type !== "table" && block.text.trim().length > 0,
    )!;
    const ours = structuredClone(opened.projection);
    ours.blocks.find((block) => block.id === target.id)!.text = "Spectra version";
    const externalBytes = await docxLens.mutate(opened.preservedCarry, {
      kind: "ai-edit",
      operations: [
        { kind: "replace-paragraph", regionId: target.id, text: "Word version" },
        { kind: "insert-paragraph", regionId: "docx:paragraph:abcddcba", text: "Foreign insertion" },
      ],
    });
    const external = await docxLens.open(externalBytes);
    const resolved = mergeDocxProjections(opened.projection, ours, external.projection, "spectra");
    expect(resolved.projection.blocks.find((block) => block.id === target.id)?.text).toBe("Spectra version");
    expect(resolved.projection.blocks.some((block) => block.text === "Foreign insertion")).toBe(true);
    const output = await docxLens.materialize({
      projection: resolved.projection,
      carry: external.preservedCarry,
    });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.some((block) => block.text === "Foreign insertion")).toBe(true);
  });

  it("Keep Word uses the native Word projection, including Word-only insertions", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const target = opened.projection.blocks.find(
      (block) => block.type !== "table" && block.text.trim().length > 0,
    )!;
    const ours = structuredClone(opened.projection);
    ours.blocks.find((block) => block.id === target.id)!.text = "Spectra version";
    const externalBytes = await docxLens.mutate(opened.preservedCarry, {
      kind: "ai-edit",
      operations: [
        { kind: "replace-paragraph", regionId: target.id, text: "Word version" },
        { kind: "insert-paragraph", regionId: "docx:paragraph:abcddcba", text: "Foreign insertion" },
      ],
    });
    const external = await docxLens.open(externalBytes);
    const kept = mergeDocxProjections(
      opened.projection,
      ours,
      external.projection,
      "word",
    );
    expect(kept.projection.blocks.find((block) => block.id === target.id)?.text).toBe(
      "Word version",
    );
    expect(
      kept.projection.blocks.some((block) => block.text === "Foreign insertion"),
    ).toBe(true);
    expect(kept.projection.blocks.map((block) => block.id)).toEqual(
      external.projection.blocks.map((block) => block.id),
    );
  });

  it("changes an editable paragraph without losing tracked changes elsewhere", async () => {
    const source = await fixture("tracked-changes.docx");
    const opened = await docxLens.open(source);
    const editable = opened.projection.blocks.find(
      (block) =>
        block.type !== "table" && block.attrs?.nativeReadOnly !== true,
    );
    expect(editable).toBeTruthy();
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: editable!.id,
      text: `${editable!.text} safe edit`,
    });
    const reopened = await docxLens.open(output);
    expect(
      reopened.fidelityMap.entries.some(
        (entry) => entry.feature === "trackedChanges",
      ),
    ).toBe(true);
  });

  it("retains native paragraph locators when cloud content carries a stale index", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const projection = structuredClone(opened.projection);
    const target = projection.blocks.find(
      (block) => block.type !== "table" && block.text.trim().length > 0,
    );
    expect(target).toBeTruthy();
    target!.text = `${target!.text} locator-safe`;
    target!.attrs = { ...target!.attrs, paragraphIndex: 999_999 };
    const output = await docxLens.materialize({
      projection,
      carry: opened.preservedCarry,
    });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.find((block) => block.id === target!.id)?.text)
      .toBe(target!.text);
  });

  it("refuses to rewrite a paragraph containing revision or field machinery", async () => {
    const source = await fixture("fields-toc.docx");
    const opened = await docxLens.open(source);
    const protectedBlock = opened.projection.blocks.find(
      (block) => block.attrs?.nativeReadOnly === true,
    );
    expect(protectedBlock).toBeTruthy();
    await expect(
      docxLens.mutate(opened.preservedCarry, {
        kind: "replace-paragraph",
        regionId: protectedBlock!.id,
        text: "unsafe replacement",
      }),
    ).rejects.toMatchObject({ code: "DOCX_REGION_READ_ONLY" });
    await expect(
      docxLens.mutate(opened.preservedCarry, {
        kind: "delete-region",
        regionId: protectedBlock!.id,
      }),
    ).rejects.toMatchObject({ code: "DOCX_REGION_READ_ONLY" });
  });

  it("refuses an unanchored plain-text overwrite of a native Word comment range", async () => {
    const source = await fixture("macro-enabled.docm");
    const opened = await docxLens.open(source);
    const commented = opened.projection.blocks.find((block) =>
      block.text.includes("On the Insert tab"),
    );
    expect(commented).toBeTruthy();
    expect(commented?.inlineContent?.some((item) => item.kind === "commentBoundary")).toBe(true);
    await expect(
      docxLens.mutate(opened.preservedCarry, {
        kind: "replace-paragraph",
        regionId: commented!.id,
        text: "Do not flatten native Word comment anchors.",
      }),
    ).rejects.toMatchObject({ code: "DOCX_UNSUPPORTED_EDIT" });
  });

  it("preserves multilingual text exactly through a safe unrelated edit", async () => {
    const source = await fixture("fields-toc.docx");
    const opened = await docxLens.open(source);
    const multilingual = opened.projection.blocks
      .filter((block) => /[\u3400-\u9fff]/u.test(block.text))
      .map((block) => ({ id: block.id, text: block.text }));
    expect(multilingual.length).toBeGreaterThan(0);
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "insert-paragraph",
      text: "Unrelated Spectra edit.",
    });
    const reopened = await docxLens.open(output);
    expect(
      reopened.projection.blocks
        .filter((block) =>
          multilingual.some((entry) => entry.id === block.id),
        )
        .map((block) => ({ id: block.id, text: block.text })),
    ).toEqual(multilingual);
  });

  it("normalizes numeric built-in heading aliases without promoting protected TOC rows", async () => {
    const source = await fixture("fields-toc.docx");
    const opened = await docxLens.open(source);
    const protectedRows = opened.projection.blocks.slice(0, 6);
    expect(protectedRows.every((block) => block.type === "paragraph")).toBe(true);
    expect(protectedRows.every((block) => block.attrs?.nativeReadOnly === true)).toBe(true);
    expect(
      opened.projection.blocks
        .filter((block) => block.type === "heading")
        .map((block) => block.attrs?.styleId),
    ).toEqual([
      "Heading1",
      "Heading2",
      "Heading3",
      "Heading1",
      "Heading2",
      "Heading3",
    ]);
  });

  it("raises a native placeholder only for content the file actually carries", async () => {
    // A placeholder is a claim about this document — "there is a text box here,
    // and it is safe" — so it may only follow detection. The region rows say
    // what Spectra is able to write, and reading those as placeholders would
    // announce tracked changes in every file that has none.
    const textBox = await docxLens.open(await fixture("floating-textbox.docx"));
    expect(
      textBox.projection.nativeBinding.nativePlaceholders.map((entry) => entry.feature),
    ).toEqual(["textBox"]);

    const revisions = await docxLens.open(await fixture("tracked-changes.docx"));
    expect(
      revisions.projection.nativeBinding.nativePlaceholders.map((entry) => entry.feature),
    ).toContain("trackedChanges");

    const plain = await docxLens.open(await fixture("complex-structure.docx"));
    expect(plain.projection.nativeBinding.nativePlaceholders).toEqual([]);
    // Bounded text revision commands are available even when none are present.
    expect(
      plain.fidelityMap.entries.find(
        (entry) => entry.regionId === "docx:region:trackedChanges",
      ),
    ).toMatchObject({ class: "NATIVE" });
  });

  it("writes text beside a picture run instead of over it", async () => {
    // The text box in this file lives inside the paragraph's only run. Rewriting
    // that run is how a round-trip loses a drawing while reporting success, so
    // the new text has to become a new run and the box has to survive.
    const source = await fixture("floating-textbox.docx");
    expect(await countWml(source, "txbxContent")).toBe(1);
    const opened = await docxLens.open(source);
    const target = opened.projection.blocks[0]!;
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: target.id,
      text: "Typed beside the Word text box.",
    });
    expect(await countWml(output, "txbxContent")).toBe(1);
    expect(await countWml(output, "pict")).toBe(1);
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks[0]?.text).toBe("Typed beside the Word text box.");
  });

  it("steps an indent by half an inch without snapping a style's outdent to the grid", async () => {
    // `ProductHead` in this file resolves to -3254 twips. Writing `level × 720`
    // would move the heading on the printed page, so one step is one step.
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const heading = opened.projection.blocks.find(
      (block) => block.text === "Complexity",
    );
    expect(heading?.attrs?.paragraphFormat).toMatchObject({ indentLevel: -5 });
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "format-paragraph",
      regionId: heading!.id,
      format: { indentLevel: -4 },
    });
    const document = await Document.open(output);
    const indents = mainElements(document.body())
      .filter(
        (element) =>
          element.namespaceUri() === WML_NAMESPACE && element.localName === "ind",
      )
      .map((element) => element.getAttributeNs(WML_NAMESPACE, "left"));
    expect(indents).toContain("-2534");
  });

  it("resolves a durable asset when replacing a retained native picture", async () => {
    const sourceDocument = Document.create();
    const sourcePng = new Uint8Array(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ));
    sourceDocument.addImage(sourcePng, { widthPx: 160, altText: "Before" });
    const opened = await docxLens.open(await sourceDocument.save());
    const imageBlock = opened.projection.blocks.find((block) =>
      block.inlineContent?.some((item) => item.kind === "image"),
    )!;
    const image = imageBlock.inlineContent?.find((item) => item.kind === "image");
    if (!image || image.kind !== "image") throw new Error("image fixture was not projected");
    const projection = structuredClone(opened.projection);
    const target = projection.blocks.find((block) => block.id === imageBlock.id)!;
    const replacement = target.inlineContent?.find((item) => item.kind === "image");
    if (!replacement || replacement.kind !== "image" || !replacement.partName)
      throw new Error("image fixture was not cloned");
    replacement.assetId = "asset-replacement-1";
    replacement.altText = "After";
    let requested: string | undefined;
    const output = await docxLens.materialize({
      projection,
      carry: opened.preservedCarry,
      options: {
        resolveAsset: (async ({ assetId, mediaType }) => {
          requested = `${assetId}:${mediaType}`;
          return sourcePng;
        }) satisfies DocxAssetResolver,
      },
    });
    expect(requested).toBe("asset-replacement-1:image/png");
    const reopened = await docxLens.open(output);
    const resultImage = reopened.projection.blocks
      .flatMap((block) => block.inlineContent ?? [])
      .find((item) => item.kind === "image");
    expect(resultImage).toMatchObject({ kind: "image", altText: "After" });
    expect(await (await Document.open(output)).images()[0]!.data()).toEqual(sourcePng);
    expect(reopened.projection.blocks.some((block) => block.text.includes("After"))).toBe(true);
  });

  it("keeps a retained picture editable beside changed mixed text", async () => {
    const sourceDocument = Document.create();
    const sourcePng = new Uint8Array(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ));
    const paragraph = sourceDocument.addParagraph("Before ");
    sourceDocument.addImage(sourcePng, { widthPx: 120, altText: "Retained" });
    const imageParagraph = sourceDocument.body().elements().find(
      (element) => element !== paragraph.element && element.localName === "p",
    );
    const imageRun = imageParagraph?.elements().find((element) => element.localName === "r");
    if (!imageParagraph || !imageRun) throw new Error("image fixture was not created");
    imageParagraph.removeChild(imageRun);
    paragraph.element.appendChild(imageRun);
    const tail = new XmlElement("r", "w");
    const tailText = new XmlElement("t", "w");
    tailText.appendChild(new XmlText(" after"));
    tail.appendChild(tailText);
    paragraph.element.appendChild(tail);
    const opened = await docxLens.open(await sourceDocument.save());
    const target = opened.projection.blocks.find((block) =>
      block.inlineContent?.some((item) => item.kind === "image"),
    )!;
    const inlineContent = target.inlineContent!.map((item) =>
      item.kind === "text" && item.text === "Before "
        ? { ...item, text: "Edited " }
        : item,
    );
    const output = await docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: target.id,
      text: "Edited  after",
      inlineContent,
    });
    const reopened = await docxLens.open(output);
    const result = reopened.projection.blocks.find((block) => block.id === target.id);
    expect(result?.text).toContain("Edited");
    expect(result?.inlineContent?.some((item) => item.kind === "image")).toBe(true);
    expect(await (await Document.open(output)).images()).toHaveLength(1);
  });

  it("materializes retained page setup and isolates a shared header part", async () => {
    const sourceDocument = Document.create();
    sourceDocument.setHeader("Shared header");
    sourceDocument.setFooter("Shared footer");
    const firstParagraph = sourceDocument.addParagraph("First section");
    const finalSection = sourceDocument.body().find(WML_NAMESPACE, "sectPr");
    const firstSection = new XmlElement("sectPr", "w");
    const sharedHeader = finalSection?.find(WML_NAMESPACE, "headerReference");
    const sharedFooter = finalSection?.find(WML_NAMESPACE, "footerReference");
    if (sharedHeader) firstSection.appendChild(sharedHeader.clone());
    if (sharedFooter) firstSection.appendChild(sharedFooter.clone());
    const paragraphProperties = new XmlElement("pPr", "w");
    paragraphProperties.appendChild(firstSection);
    firstParagraph.element.insertBefore(paragraphProperties, firstParagraph.element.children[0] ?? null);
    sourceDocument._markMainDirty();
    const opened = await docxLens.open(await sourceDocument.save());
    const projection = structuredClone(opened.projection);
    projection.pageSetup = {
      ...(projection.pageSetup ?? {}),
      size: "letter",
      orientation: "landscape",
      margins: "narrow",
      columns: 2,
      header: "First section header",
      footer: "First section footer",
      sectionIndex: 0,
    };
    const output = await docxLens.materialize({ projection, carry: opened.preservedCarry });
    const document = await Document.open(output);
    const first = document.paragraphs()[0]?.element.find(WML_NAMESPACE, "pPr")?.find(WML_NAMESPACE, "sectPr");
    expect(first?.find(WML_NAMESPACE, "pgSz")?.getAttributeNs(WML_NAMESPACE, "orient")).toBe("landscape");
    expect(first?.find(WML_NAMESPACE, "cols")?.getAttributeNs(WML_NAMESPACE, "num")).toBe("2");
    expect(document.headers().map((header) => header.text())).toEqual(
      expect.arrayContaining(["First section header", "Shared header"]),
    );
    expect(document.footers().map((footer) => footer.text())).toEqual(
      expect.arrayContaining(["First section footer", "Shared footer"]),
    );
  });

  it("reports protected and corrupt files honestly", async () => {
    await expect(docxLens.open(await fixture("password-protected.docx"))).rejects.toBeInstanceOf(
      DocxLensError,
    );
    await expect(docxLens.open(await fixture("corrupt.docx"))).rejects.toMatchObject({
      code: "DOCX_CORRUPT",
    });
  });

  it("narrows strict-native command and AI availability", async () => {
    const opened = await docxLens.open(await fixture("tracked-changes.docx"));
    expect(
      opened.capabilities.human.find((capability) => capability.id === "accept-revisions"),
    ).toMatchObject({ available: false });
    expect(opened.capabilities.aiOperations).not.toContain("accept_revisions");
    expect(opened.capabilities.aiOperations).toContain("replace_paragraph");
  });
});
