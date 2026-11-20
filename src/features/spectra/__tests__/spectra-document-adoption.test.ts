import { describe, expect, it } from "vitest";
import { authorNew } from "../ai/harness/authoring";
import { sequentialIdFactory } from "../ai/harness/authoring/shared";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { docxLens } from "../lenses/docx-lens";
import { bindDocxProjectionSource, documentContentToProseMirrorJson } from "../lenses/document-projection";
import { docxStyleCatalogueSchema } from "../lenses/projection-contracts";

/*
 * A document made in Spectra reaches the disk as a Word file
 * (/api/spectra/native): its export opens as a Word projection that keeps its
 * words, tables, equations and styles, which the document then takes as its own.
 */
describe("a Spectra document becomes Word-backed", () => {
  it("opens its own export as a complete Word projection", async () => {
    const markdown = [
      "# Catalase {.center}",
      "",
      "The rate is $k = Ae^{-E_a/RT}$.^[Arrhenius.]",
      "",
      "| T (°C) | Time (s) |",
      "| --- | ---: |",
      "| 20 | 41.2 |",
      "{style=banded}",
      "",
      "Table 1: Mean times {.caption}",
    ].join("\n");
    const created = authorNew("document", { markdown, look: "essay" }, { timeZone: "UTC", ids: sequentialIdFactory() });
    const content = created.content as Record<string, unknown>;
    const styles = docxStyleCatalogueSchema.parse(content.styles);
    const copy = await exportDocxCopy(documentContentToProseMirrorJson(content), { styles });
    const opened = await docxLens.open(copy.bytes, "strict-native");
    const projection = bindDocxProjectionSource(opened.projection, "work", "a".repeat(64));
    const text = projection.blocks.map((block) => block.text).join("\n");
    expect(text).toContain("Catalase");
    expect(text).toContain("Table 1: Mean times");
    expect(projection.blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "table", "paragraph"]);
    expect(projection.blocks.at(-1)!.attrs).toMatchObject({ styleId: "Caption" });
    expect(projection.nativeBinding.format).toBe("docx");
  });
});
