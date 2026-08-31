import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import type { XmlElement } from "@ariadng/office/xml";
import {
  DocxLensError,
  docxLens,
  type DocxRunFormat,
} from "../lenses/docx-lens";
import { comparePackages } from "@ariadng/office/preservation";
import katex from "katex";
import { assertPreservationKept } from "../commands/office/preservation-guard";
import { mergeDocxProjections, contentProjection } from "@/app/api/spectra/lenses/docx/route";

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

describe("DOCX preservation lens", () => {
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

  it("treats native OMML as preserved read-only at both command and paragraph seams", async () => {
    const opened = await docxLens.open(await fixture("equation-omml.docx"));
    expect(opened.fidelityMap.entries.find((entry) => entry.feature === "equations"))
      .toMatchObject({ class: "PRESERVED", readOnly: true });
    const equation = opened.projection.blocks.find((block) => block.attrs?.nativeReadOnly === true)!;
    await expect(docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: equation.id,
      text: "Would flatten OMML",
    })).rejects.toMatchObject({ code: "DOCX_REGION_READ_ONLY" });
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

  it("promotes a paragraph containing only oMathPara to a protected display equation", async () => {
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
        nativeReadOnly: true,
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
    expect(projected.attrs?.nativeReadOnly).toBe(true);
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
      attrs: { nativeReadOnly: true },
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
    const serialized = JSON.stringify(opened.projection);
    expect(serialized).not.toContain("iVBORw0KGgo");
    expect(serialized).not.toContain("base64");
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
    expect(opened.fidelityMap.entries.find((entry) => entry.feature === "hyperlinks"))
      .toMatchObject({ class: "PRESERVED", readOnly: true });
    await expect(docxLens.mutate(opened.preservedCarry, {
      kind: "replace-paragraph",
      regionId: linked.id,
      text: "Would absorb the hyperlink",
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
    // The region is still preserved for the command surface, which is a
    // different statement from "this file has revisions in it".
    expect(
      plain.fidelityMap.entries.find(
        (entry) => entry.regionId === "docx:region:trackedChanges",
      ),
    ).toMatchObject({ class: "PRESERVED", readOnly: true });
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
