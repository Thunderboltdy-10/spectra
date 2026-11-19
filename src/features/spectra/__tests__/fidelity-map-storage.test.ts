import { describe, expect, it } from "vitest";
import * as docx from "docx";
import { docxLens } from "../lenses/docx-lens";
import { fidelityRegionMap } from "../commands/office/fidelity-regions";
import { storedFidelityMap, STORED_FIDELITY_BUDGET_BYTES } from "../../../../shared/fidelity-map-storage";

type Map = { entries: Array<Record<string, unknown>>; implicitNative?: boolean; truncated?: boolean };

async function essay(paragraphs: number) {
  const document = new docx.Document({
    sections: [{
      children: [
        new docx.Paragraph({ children: [new docx.TextRun("Intro"), new docx.FootnoteReferenceRun(1)] }),
        ...Array.from({ length: paragraphs }, (_, index) => new docx.Paragraph(`Paragraph ${index} of the essay.`)),
      ],
    }],
    footnotes: { 1: { children: [new docx.Paragraph("A note.")] } },
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

describe("stored fidelity maps keep what restricts editing and drop the rest", () => {
  it("gates and read-only paragraphs are the same from the stored map", async () => {
    const opened = await docxLens.open(await essay(600));
    const full = opened.fidelityMap as unknown as Map;
    const stored = storedFidelityMap(full) as Map;
    expect(stored.implicitNative).toBe(true);
    expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(full).length / 5);
    expect(fidelityRegionMap(stored.entries)).toEqual(fidelityRegionMap(full.entries));
    const readOnly = (map: Map) => map.entries.filter((entry) => entry.readOnly === true).map((entry) => entry.regionId);
    expect(readOnly(stored)).toEqual(readOnly(full));
    expect(storedFidelityMap(stored)).toEqual(stored);
  });

  it("an oversized map keeps its most restrictive rows instead of losing them all", () => {
    const entries = Array.from({ length: 2_000 }, (_, index) => ({
      regionId: `docx:paragraph:${index}`, feature: "revision-or-field-paragraph",
      class: index % 2 ? "EQUIVALENT" : "PRESERVED", readOnly: index % 2 === 0, partName: "/word/document.xml",
    }));
    const stored = storedFidelityMap({ version: 1, profile: "strict-native", entries }) as Map;
    expect(stored.truncated).toBe(true);
    expect(JSON.stringify(stored).length).toBeLessThanOrEqual(STORED_FIDELITY_BUDGET_BYTES);
    expect(stored.entries.length).toBeGreaterThan(100);
    expect(stored.entries.every((entry) => entry.class === "PRESERVED")).toBe(true);
  });
});
