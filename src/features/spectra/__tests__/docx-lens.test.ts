import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import type { XmlElement } from "@ariadng/office/xml";
import {
  DocxLensError,
  docxLens,
} from "../lenses/docx-lens";
import { contentProjection } from "@/app/api/spectra/lenses/docx/route";

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

  it("returns the original package for a semantic no-op", async () => {
    const source = await fixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const output = await docxLens.materialize({
      projection: structuredClone(opened.projection),
      carry: opened.preservedCarry,
    });
    expect(Buffer.from(output).equals(Buffer.from(source))).toBe(true);
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
