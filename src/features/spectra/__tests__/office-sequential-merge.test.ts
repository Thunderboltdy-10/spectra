import { describe, expect, it } from "vitest";
import { mergePptxProjections, mergeXlsxProjections } from "../lenses/office-projection-merge";
import type { PptxProjection, XlsxProjection } from "../lenses/projection-contracts";

const cell = (ref: string, value: number, formula?: string) => ({ id: `s1:${ref}`, ref, value, ...(formula ? { formula, formulaCache: "present" as const } : {}) });
const sheet = (cells: ReturnType<typeof cell>[]) => ({ sheets: [{ id: "s1", name: "Sheet1", cells, merges: [], rowCount: 10, columnCount: 5 }] }) as unknown as XlsxProjection;

describe("sequential native saves merge without false conflicts (FLOW-012/013)", () => {
  it("lets Excel change an untouched cell after Spectra edited another", () => {
    const base = sheet([cell("A1", 12), cell("A2", 30), cell("A3", 42, "SUM(A1:A2)")]);
    // Spectra changed A1 and recalculated A3; its copy keeps no Excel cache flag.
    const ours = sheet([cell("A1", 20), cell("A2", 30), { id: "s1:A3", ref: "A3", value: 50, formula: "SUM(A1:A2)" }]);
    const theirs = sheet([cell("A1", 20), cell("A2", 22), cell("A3", 42, "SUM(A1:A2)")]);
    const merged = mergeXlsxProjections(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.projection.sheets[0]!.cells.map((c) => [c.ref, c.value])).toEqual([["A1", 20], ["A2", 22], ["A3", 42]]);
  });

  it("treats a reordered but identical slide object as untouched", () => {
    const object = (text: string, order: "a" | "b") => ({
      id: "shape:2", type: "text", x: 90, y: 185, width: 820, height: 124, rotation: 0, locked: false, readingOrder: 0,
      content: order === "a" ? { text, nativeShapeId: "2" } : { nativeShapeId: "2", text },
    });
    const deck = (slides: Array<[string, ReturnType<typeof object>]>) => ({ slides: slides.map(([id, obj], index) => ({
      id, index, title: "", text: [], objects: [obj], hasTransition: false, hasTiming: false, speakerNotes: "" })) }) as unknown as PptxProjection;
    const base = deck([["s1", object("Edited slide in Spectra", "a")], ["s2", object("Second", "a")]]);
    const ours = deck([["s1", object("Edited slide in Spectra", "b")], ["s2", object("Second", "b")]]);
    const theirs = deck([["s1", object("Saved by Microsoft PowerPoint", "a")], ["s2", object("Second", "a")]]);
    const merged = mergePptxProjections(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect((merged.projection.slides[0]!.objects[0]!.content as { text: string }).text).toBe("Saved by Microsoft PowerPoint");
  });
});
