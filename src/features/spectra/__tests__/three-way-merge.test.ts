import { describe, expect, it } from "vitest";
import { mergeThreeWay } from "../lenses/three-way-merge";
import {
  mergePptxProjections,
  mergeXlsxProjections,
} from "../lenses/office-projection-merge";

describe("mergeThreeWay", () => {
  const id = (value: { id: string }) => value.id;
  it("keeps independent edits from both sides", () => {
    const result = mergeThreeWay({
      base: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
      ours: [{ id: "a", text: "A*" }, { id: "b", text: "B" }],
      theirs: [{ id: "a", text: "A" }, { id: "b", text: "B*" }],
      id,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.value).toEqual([{ id: "a", text: "A*" }, { id: "b", text: "B*" }]);
  });

  it("reports same-region and delete-vs-edit conflicts", () => {
    const result = mergeThreeWay({
      base: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
      ours: [{ id: "a", text: "ours" }],
      theirs: [{ id: "a", text: "theirs" }, { id: "b", text: "B" }],
      id,
    });
    expect(result.conflicts.map((conflict) => conflict.id)).toEqual(["a"]);
  });

  it("reports delete-vs-edit instead of silently resurrecting a region", () => {
    const result = mergeThreeWay({
      base: [{ id: "a", text: "A" }],
      ours: [],
      theirs: [{ id: "a", text: "External edit" }],
      id,
    });
    expect(result.conflicts).toMatchObject([{ id: "a", ours: undefined }]);
  });

  it("does not use enumeration order as identity", () => {
    const result = mergeThreeWay({
      base: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
      ours: [{ id: "b", text: "B" }, { id: "a", text: "A*" }],
      theirs: [{ id: "a", text: "A" }, { id: "b", text: "B*" }],
      id,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.value).toEqual([{ id: "b", text: "B*" }, { id: "a", text: "A*" }]);
  });

  it("weaves independent insertions without inventing an order conflict", () => {
    const result = mergeThreeWay({
      base: [{ id: "a" }, { id: "b" }],
      ours: [{ id: "a" }, { id: "ours" }, { id: "b" }],
      theirs: [{ id: "a" }, { id: "b" }, { id: "theirs" }],
      id,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.value.map((value) => value.id)).toEqual(["a", "ours", "b", "theirs"]);
  });
});

const binding = {
  version: 1 as const,
  profile: "strict-native" as const,
  macroEnabled: false,
  semanticDigest: "0".repeat(64),
};

describe("Office projection merge", () => {
  it("merges independent Excel cells and conflicts only on the same address", () => {
    const base = {
      sheets: [{
        id: "xlsx:sheet:1",
        name: "Sheet1",
        merges: [] as string[],
        cells: [
          { id: "xlsx:1:A1", ref: "A1", value: "A" },
          { id: "xlsx:1:B1", ref: "B1", value: "B" },
        ],
      }],
      definedNames: [],
      nativeBinding: { ...binding, format: "xlsx" as const, recognizedFormulaFunctions: [] },
    };
    const independent = mergeXlsxProjections(
      base,
      { ...base, sheets: [{ ...base.sheets[0]!, cells: [{ ...base.sheets[0]!.cells[0]!, value: "Spectra" }, base.sheets[0]!.cells[1]!] }] },
      { ...base, sheets: [{ ...base.sheets[0]!, cells: [base.sheets[0]!.cells[0]!, { ...base.sheets[0]!.cells[1]!, value: "Excel" }] }] },
    );
    expect(independent.conflicts).toEqual([]);
    expect(independent.projection.sheets[0]!.cells.map((cell) => cell.value)).toEqual(["Spectra", "Excel"]);

    const conflict = mergeXlsxProjections(
      base,
      { ...base, sheets: [{ ...base.sheets[0]!, cells: [{ ...base.sheets[0]!.cells[0]!, value: "Spectra" }, base.sheets[0]!.cells[1]!] }] },
      { ...base, sheets: [{ ...base.sheets[0]!, cells: [{ ...base.sheets[0]!.cells[0]!, value: "Excel" }, base.sheets[0]!.cells[1]!] }] },
    );
    expect(conflict.conflicts.map((entry) => entry.id)).toEqual(["xlsx:sheet:1:A1"]);
  });

  it("keeps independent freeze-pane changes during an Excel merge", () => {
    const base = {
      sheets: [{
        id: "xlsx:sheet:1",
        name: "Sheet1",
        merges: [] as string[],
        frozenRows: 0,
        frozenColumns: 0,
        cells: [{ id: "xlsx:1:A1", ref: "A1", value: "A" }],
      }],
      definedNames: [],
      nativeBinding: { ...binding, format: "xlsx" as const, recognizedFormulaFunctions: [] },
    };
    const merged = mergeXlsxProjections(
      base,
      { ...base, sheets: [{ ...base.sheets[0]!, frozenRows: 1 }] },
      { ...base, sheets: [{ ...base.sheets[0]!, frozenColumns: 2 }] },
    );
    expect(merged.conflicts).toEqual([]);
    expect(merged.projection.sheets[0]).toMatchObject({
      frozenRows: 1,
      frozenColumns: 2,
    });
  });

  it("merges PowerPoint objects independently inside the same slide", () => {
    const object = (id: string, text: string) => ({
      id,
      type: "text" as const,
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      rotation: 0,
      content: { text, nativeShapeId: id.split(":").at(-1) },
    });
    const base = {
      slides: [{
        id: "pptx:slide:/ppt/slides/slide1.xml",
        index: 0,
        title: "Title",
        text: ["A", "B"],
        objects: [object("slide:shape:2", "A"), object("slide:shape:3", "B")],
        hasTransition: false,
        hasTiming: false,
        speakerNotes: "",
      }],
      nativeBinding: { ...binding, format: "pptx" as const },
    };
    const merged = mergePptxProjections(
      base,
      { ...base, slides: [{ ...base.slides[0]!, objects: [object("slide:shape:2", "Spectra"), object("slide:shape:3", "B")] }] },
      { ...base, slides: [{ ...base.slides[0]!, objects: [object("slide:shape:2", "A"), object("slide:shape:3", "PowerPoint")] }] },
    );
    expect(merged.conflicts).toEqual([]);
    expect(merged.projection.slides[0]!.objects.map((entry) => (entry.content as { text: string }).text))
      .toEqual(["Spectra", "PowerPoint"]);
  });

  it("keeps an independent hidden-slide change through the PowerPoint merge", () => {
    const base = {
      slides: [{
        id: "pptx:slide:/ppt/slides/slide1.xml",
        index: 0,
        title: "Title",
        text: ["Title"],
        objects: [],
        hasTransition: false,
        hasTiming: false,
        speakerNotes: "",
      }],
      nativeBinding: { ...binding, format: "pptx" as const },
    };
    const merged = mergePptxProjections(
      base,
      { ...base, slides: [{ ...base.slides[0]!, hidden: true }] },
      { ...base, slides: [{ ...base.slides[0]!, speakerNotes: "External note" }] },
    );
    expect(merged.conflicts).toEqual([]);
    expect(merged.projection.slides[0]).toMatchObject({
      hidden: true,
      speakerNotes: "External note",
    });
    expect(merged.spectraChanged).toContain(
      "pptx:slide:/ppt/slides/slide1.xml:hidden",
    );
  });

  it("refuses ambiguous native identities", () => {
    const base = {
      sheets: [{
        id: "xlsx:sheet:1",
        name: "Sheet1",
        merges: [] as string[],
        cells: [
          { id: "one", ref: "A1", value: "A" },
          { id: "two", ref: "A1", value: "B" },
        ],
      }],
      definedNames: [],
      nativeBinding: { ...binding, format: "xlsx" as const, recognizedFormulaFunctions: [] },
    };
    expect(() => mergeXlsxProjections(base, base, base)).toThrow("identity is missing or ambiguous");
  });
});
