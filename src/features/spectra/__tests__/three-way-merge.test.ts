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

  it("orders random concurrent edits exactly as the reference weave does", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const edit = (base: string[], prefix: string) => {
      const kept = base.filter(() => random() > 0.15);
      if (random() < 0.3) kept.reverse();
      const out: string[] = [];
      kept.forEach((regionId, index) => {
        if (random() < 0.25) out.push(`${prefix}${index}`);
        out.push(regionId);
      });
      if (random() < 0.5) out.push(`${prefix}end`);
      return out;
    };
    for (let round = 0; round < 400; round += 1) {
      const base = Array.from({ length: Math.floor(random() * 12) }, (_, index) => `b${index}`);
      const ours = edit(base, "o");
      const theirs = edit(base, "t");
      for (const conflictResolution of [undefined, "ours", "theirs"] as const) {
        const wrap = (ids: string[]) => ids.map((regionId) => ({ id: regionId }));
        const result = mergeThreeWay({ base: wrap(base), ours: wrap(ours), theirs: wrap(theirs), id, conflictResolution });
        expect(result.value.map(id)).toEqual(referenceOrder(base, ours, theirs, conflictResolution));
      }
    }
  });

  it("merges a thesis-length document with thousands of insertions on both sides", () => {
    const base = Array.from({ length: 5_000 }, (_, index) => ({ id: `b${index}` }));
    const ours = [...base, ...Array.from({ length: 5_000 }, (_, index) => ({ id: `o${index}` }))];
    const theirs = base.flatMap((block, index) => [block, { id: `t${index}` }]);
    const started = performance.now();
    const result = mergeThreeWay({ base, ours, theirs, id });
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result.conflicts).toEqual([]);
    expect(result.value.slice(0, 4).map(id)).toEqual(["b0", "t0", "b1", "t1"]);
    expect(result.value.slice(-2).map(id)).toEqual(["o4998", "o4999"]);
    expect(result.value).toHaveLength(15_000);
  });
});

/** The original array-splice weave, kept as an oracle for the linked-list one. */
function referenceOrder(base: string[], ours: string[], theirs: string[], resolution?: "ours" | "theirs") {
  const baseSet = new Set(base);
  const inOurs = new Set(ours);
  const inTheirs = new Set(theirs);
  const selected = new Set([...base, ...ours, ...theirs].filter((regionId) => {
    const oursChanged = baseSet.has(regionId) !== inOurs.has(regionId);
    const theirsChanged = baseSet.has(regionId) !== inTheirs.has(regionId);
    if (oursChanged && theirsChanged && inOurs.has(regionId) !== inTheirs.has(regionId))
      return resolution === "ours" ? inOurs.has(regionId) : resolution === "theirs" ? inTheirs.has(regionId) : false;
    return oursChanged ? inOurs.has(regionId) : theirsChanged ? inTheirs.has(regionId) : baseSet.has(regionId);
  }));
  const oursOrder = ours.filter((regionId) => selected.has(regionId));
  const theirsOrder = theirs.filter((regionId) => selected.has(regionId));
  const survivors = base.filter((regionId) => selected.has(regionId));
  const oursBackbone = oursOrder.filter((regionId) => baseSet.has(regionId));
  const theirsBackbone = theirsOrder.filter((regionId) => baseSet.has(regionId));
  const oursMoved = oursBackbone.join() !== survivors.join();
  const theirsMoved = theirsBackbone.join() !== survivors.join();
  let order = survivors;
  if (oursMoved && theirsMoved && oursBackbone.join() !== theirsBackbone.join())
    order = resolution === "ours" ? oursBackbone : resolution === "theirs" ? theirsBackbone : survivors;
  else if (oursMoved) order = oursBackbone;
  else if (theirsMoved) order = theirsBackbone;
  const weave = (source: string[]) => {
    for (const regionId of source) {
      if (order.includes(regionId) || !selected.has(regionId)) continue;
      const at = source.indexOf(regionId);
      const nextAnchor = source.slice(at + 1).find((candidate) => order.includes(candidate));
      if (nextAnchor) { order.splice(order.indexOf(nextAnchor), 0, regionId); continue; }
      const previousAnchor = source.slice(0, at).reverse().find((candidate) => order.includes(candidate));
      if (previousAnchor) order.splice(order.indexOf(previousAnchor) + 1, 0, regionId);
      else order.push(regionId);
    }
  };
  weave(oursOrder);
  weave(theirsOrder);
  weave([...base, ...ours, ...theirs].filter((regionId, index, all) => all.indexOf(regionId) === index && selected.has(regionId)));
  return order;
}

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
