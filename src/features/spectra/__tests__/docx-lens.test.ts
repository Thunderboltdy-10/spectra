import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocxLensError,
  docxLens,
} from "../lenses/docx-lens";
import { contentProjection } from "@/app/api/spectra/lenses/docx/route";

const fixture = (name: string) =>
  readFile(join(process.cwd(), "fixtures", "office", "docx", name)).then(
    (bytes) => new Uint8Array(bytes),
  );

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
