import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Workbook } from "@ariadng/office/xlsx";
import { Presentation } from "@ariadng/office/pptx";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement, XmlText } from "@ariadng/office/xml";
import { dateToSerial } from "../sheets/excel-serial";
import { xlsxLens } from "../lenses/xlsx-lens";
import { pptxLens } from "../lenses/pptx-lens";
import {
  pptxArtifactContent,
  xlsxArtifactContent,
  xlsxProjectionFromContent,
} from "../lenses/office-content";
import { validateArtifactContent } from "../artifacts/registry";
import {
  presentationYjsAdapter,
  sheetsYjsAdapter,
} from "../work/models/yjs/structured-adapters";

async function workbookFixture() {
  const workbook = Workbook.create();
  const sheet = workbook.sheet("Sheet1")!;
  sheet.setCell("A1", "Input");
  sheet.setCell("A2", 2);
  sheet.setCell("B2", 3);
  sheet.setFormula("C2", "=SUM(A2:B2)");
  const bytes = await workbook.save();
  const reopened = await Workbook.open(bytes);
  const xml = await reopened.office.xml(reopened.sheet("Sheet1")!.partName);
  const c = xml.root
    .elements()
    .flatMap((node) => node.elements())
    .flatMap((node) => node.elements())
    .find((node) => node.localName === "c" && node.getAttribute("r") === "C2");
  if (!c) throw new Error("fixture failed");
  const formula = c.find(
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "f",
  );
  if (!formula) throw new Error("formula fixture failed");
  formula.removeChild(formula.children[0]!);
  formula.appendChild(new XmlText("XLOOKUP(A2,A2:A2,B2:B2)"));
  const value =
    c.find("http://schemas.openxmlformats.org/spreadsheetml/2006/main", "v") ??
    (() => {
      const created = new XmlElement("v");
      c.appendChild(created);
      return created;
    })();
  c.setAttribute("t", "n");
  for (const child of [...value.children]) value.removeChild(child);
  value.appendChild(new XmlText("5"));
  reopened.office.markDirty(reopened.sheet("Sheet1")!.partName);
  return reopened.save();
}

async function nativeTransitionFixture() {
  return new Uint8Array(
    await readFile(
      join(process.cwd(), "fixtures", "office", "pptx", "transition-law.pptx"),
    ),
  );
}

describe("XLSX and PPTX fidelity lenses", () => {
  it("projects date cells as Excel serials, not ISO strings", async () => {
    const workbook = Workbook.create();
    const sheet = workbook.sheet("Sheet1")!;
    sheet.setCell("A1", new Date(Date.UTC(2024, 0, 15)));
    const opened = await xlsxLens.open(await workbook.save());
    const cell = opened.projection.sheets[0]!.cells.find(
      (candidate) => candidate.ref === "A1",
    )!;
    expect(typeof cell.value).toBe("number");
    expect(cell.value).toBeCloseTo(
      dateToSerial(new Date(Date.UTC(2024, 0, 15))),
      5,
    );
    const content = xlsxArtifactContent(opened.projection);
    expect(typeof content.sheets[0]!.cells.A1?.value).toBe("number");
    expect(content.sheets[0]!.cells.A1?.value).toBe(cell.value);
  });
  it("keeps an unrecognized formula as formula text and cached value", async () => {
    const source = await workbookFixture();
    const opened = await xlsxLens.open(source);
    const cell = opened.projection.sheets[0]!.cells.find(
      (candidate) => candidate.ref === "C2",
    )!;
    expect(cell.formula).toBe("XLOOKUP(A2,A2:A2,B2:B2)");
    expect(cell.formulaSupport).toBe("cached-only");
    expect(cell.value).toBe(5);
    const edited = await xlsxLens.materialize({
      projection: {
        ...opened.projection,
        sheets: opened.projection.sheets.map((sheet) => ({
          ...sheet,
          cells: sheet.cells.map((candidate) =>
            candidate.ref === "A1"
              ? { ...candidate, value: "Changed" }
              : candidate,
          ),
        })),
      },
      carry: opened.preservedCarry,
    });
    const comparison = await comparePackages(source, edited);
    expect(
      comparison.parts.find((part) => part.name === "xl/worksheets/sheet1.xml")
        ?.verdict,
    ).toBe("different");
    const reopened = await xlsxLens.open(edited);
    const preserved = reopened.projection.sheets[0]!.cells.find(
      (candidate) => candidate.ref === "C2",
    )!;
    expect(preserved.formula).toBe("XLOOKUP(A2,A2:A2,B2:B2)");
    expect(preserved.formulaSupport).toBe("cached-only");
    expect(preserved.value).toBe(5);
  });

  it("propagates an omitted editor cell as a native clear", async () => {
    const source = await workbookFixture();
    const opened = await xlsxLens.open(source);
    const sheet = opened.projection.sheets[0]!;
    const edited = await xlsxLens.materialize({
      projection: {
        ...opened.projection,
        sheets: opened.projection.sheets.map((candidate) => ({
          ...candidate,
          cells: candidate.cells.filter((cell) => cell.ref !== "A2"),
        })),
      },
      carry: opened.preservedCarry,
    });
    const reopened = await xlsxLens.open(edited);
    expect(reopened.projection.sheets.find((candidate) => candidate.id === sheet.id)?.cells.some((cell) => cell.ref === "A2")).toBe(false);
  });

  it("keeps the XLSX native contract valid through normalization and Yjs", async () => {
    const opened = await xlsxLens.open(await workbookFixture());
    const content = xlsxArtifactContent(opened.projection);
    const validation = validateArtifactContent("sheets", content);
    expect(
      validation.success,
      validation.success ? undefined : JSON.stringify(validation.error.issues),
    ).toBe(true);
    expect(content.sheets[0]!.cells.A1?.format).toMatchObject({
      numberFormat: "general",
      bold: false,
      italic: false,
      underline: false,
      fontSize: 11,
    });
    expect(
      Object.values(content.sheets[0]!.cells).every(
        (cell) =>
          !cell.format ||
          typeof cell.format.numberFormat === "string",
      ),
    ).toBe(true);

    const document = sheetsYjsAdapter.createDocument(content);
    expect(sheetsYjsAdapter.validate(document)).toEqual({ valid: true });
    const projected = sheetsYjsAdapter.project(document);
    expect(projected.nativeBinding).toEqual(content.nativeBinding);
    expect(projected.sheets[0]!.cells.C2?.nativeFormulaSupport).toBe(
      "cached-only",
    );
    expect(projected.sheets[0]!.cells.C2?.formula).toBe(
      "=XLOOKUP(A2,A2:A2,B2:B2)",
    );
  });

  it("writes cell styles, borders, merges, and frozen panes through the mounted workbook", async () => {
    const source = await workbookFixture();
    const opened = await xlsxLens.open(source);
    const content = xlsxArtifactContent(opened.projection);
    const sheet = content.sheets[0]!;
    const hex = (value: string) => `#${value}`;
    sheet.cells.A1 = {
      ...sheet.cells.A1,
      format: {
        ...sheet.cells.A1?.format,
        bold: true,
        italic: true,
        wrap: true,
        align: "center",
        fillColor: hex("F4B183"),
        textColor: hex("112233"),
        borders: { bottom: { style: "double", color: hex("445566") } },
      },
    };
    sheet.mergedRanges = ["A1:B1"];
    sheet.frozenRows = 1;
    sheet.frozenColumns = 1;
    const projection = xlsxProjectionFromContent(content, opened.projection);
    const saved = await xlsxLens.materialize({ projection, carry: opened.preservedCarry });
    const native = await Workbook.open(saved);
    const nativeSheet = native.sheet("Sheet1")!;
    const style = nativeSheet.getCellStyle("A1");
    expect(style.font).toMatchObject({ bold: true, italic: true, color: "112233" });
    expect(style.fill).toMatchObject({ pattern: "solid", color: "F4B183" });
    expect(style.border.bottom).toMatchObject({ style: "double", color: "445566" });
    expect(style.alignment).toMatchObject({ horizontal: "center", wrapText: true });
    expect(nativeSheet.merges()).toEqual(["A1:B1"]);
    const reopened = await xlsxLens.open(saved);
    expect(reopened.projection.sheets[0]).toMatchObject({
      merges: ["A1:B1"],
      frozenRows: 1,
      frozenColumns: 1,
    });
    const diff = await xlsxLens.diffExternal(source, saved);
    expect(diff.changes.map((change) => change.regionId)).toEqual(expect.arrayContaining([
      expect.stringMatching(/:A1$/),
      expect.stringMatching(/:merges$/),
      expect.stringMatching(/:freezePanes$/),
    ]));
    expect(diff.preservedPartChanges).not.toContain("/xl/styles.xml");
  });

  it("refuses unsupported workbook families even when the file does not carry one yet", async () => {
    const opened = await xlsxLens.open(await workbookFixture());
    const byFeature = new Map(opened.fidelityMap.entries.map((entry) => [entry.feature, entry]));
    expect(byFeature.get("charts")).toMatchObject({ class: "PRESERVED", readOnly: true });
    expect(byFeature.get("tables")).toMatchObject({ class: "PRESERVED", readOnly: true });
    expect(byFeature.get("validation")).toMatchObject({ class: "PRESERVED", readOnly: true });
    expect(byFeature.get("sheetStructure")).toMatchObject({ class: "PRESERVED", readOnly: true });
    expect(byFeature.get("styles")).toMatchObject({ class: "NATIVE" });
    expect(byFeature.get("merges")).toMatchObject({ class: "NATIVE" });
    expect(byFeature.get("freezePanes")).toMatchObject({ class: "NATIVE" });
  });

  it("does not rewrite unedited native style fields during a formatting change", async () => {
    const workbook = Workbook.create();
    const sheet = workbook.sheet("Sheet1")!;
    sheet.setCell("A1", "Preserve my font");
    sheet.setCellStyle("A1", { fontName: "Aptos", underline: "double" });
    const source = await workbook.save();
    const opened = await xlsxLens.open(source);
    const content = xlsxArtifactContent(opened.projection);
    content.sheets[0]!.cells.A1 = {
      ...content.sheets[0]!.cells.A1,
      format: {
        ...content.sheets[0]!.cells.A1?.format,
        fillColor: ["#", "DDEBF7"].join(""),
      },
    };
    const saved = await xlsxLens.materialize({
      projection: xlsxProjectionFromContent(content, opened.projection),
      carry: opened.preservedCarry,
    });
    const style = (await Workbook.open(saved)).sheet("Sheet1")!.getCellStyle("A1");
    expect(style.font).toMatchObject({ name: "Aptos", underline: "double" });
    expect(style.fill).toMatchObject({ color: "DDEBF7" });
  });

  it("preserves a transition through title, text and add-object edits", async () => {
    const source = await nativeTransitionFixture();
    const opened = await pptxLens.open(source);
    expect(opened.projection.slides[0]!.hasTransition).toBe(true);
    const slide = opened.projection.slides[0]!;
    expect(slide.objects.length).toBeGreaterThanOrEqual(2);
    expect(slide.objects.some((object) => object.type === "text" && object.width > 10 && object.height > 10)).toBe(true);
    const edited = await pptxLens.mutate(opened.preservedCarry, {
      kind: "add-text-box",
      slideId: slide.id,
      text: "Added by Spectra",
    });
    const reopened = await pptxLens.open(edited);
    expect(reopened.projection.slides[0]!.hasTransition).toBe(true);
    expect(
      reopened.fidelityMap.entries.some(
        (entry) =>
          entry.feature === "transition" && entry.class === "PRESERVED",
      ),
    ).toBe(true);
  });

  it("projects native shape identity and writes edits back to that shape", async () => {
    const source = await nativeTransitionFixture();
    const opened = await pptxLens.open(source);
    const slide = opened.projection.slides[0]!;
    const target = slide.objects.find((object) => !object.locked && object.type === "text");
    expect(target).toBeTruthy();
    const content = target!.content as { text: string };
    const edited = await pptxLens.materialize({
      projection: {
        ...opened.projection,
        slides: opened.projection.slides.map((candidate) => candidate.id !== slide.id ? candidate : {
          ...candidate,
          objects: candidate.objects.map((object) => object.id === target!.id ? { ...object, content: { ...object.content as object, text: `${content.text} edited` } } : object),
        }),
      },
      carry: opened.preservedCarry,
    });
    const reopened = await pptxLens.open(edited);
    expect(reopened.projection.slides[0]!.objects.find((object) => object.id === target!.id)?.content).toMatchObject({ text: `${content.text} edited` });
  });

  it("reads p:xfrm geometry on a real 4:3 canvas", async () => {
    const source = new Uint8Array(
      await readFile(
        join(process.cwd(), "fixtures", "office", "pptx", "chart-notes-preservation.pptx"),
      ),
    );
    const opened = await pptxLens.open(source);
    expect(opened.projection.nativeBinding).toMatchObject({
      canvasWidthEmu: 9_144_000,
      canvasHeightEmu: 6_858_000,
    });
    const chart = opened.projection.slides.flatMap((slide) => slide.objects)
      .find((object) => object.type === "chart");
    expect(chart).toMatchObject({ x: 50, y: 175, width: 900 });
    expect(chart!.height).toBeCloseTo(494.97, 1);
    expect(pptxArtifactContent(opened.projection).settings?.aspectRatio).toBe("4:3");
  });

  it("keeps the PPTX native contract valid through normalization and Yjs", async () => {
    const opened = await pptxLens.open(await nativeTransitionFixture());
    const content = pptxArtifactContent(opened.projection);
    expect(validateArtifactContent("presentation", content).success).toBe(true);

    const document = presentationYjsAdapter.createDocument(content);
    expect(presentationYjsAdapter.validate(document)).toEqual({ valid: true });
    const projected = presentationYjsAdapter.project(document);
    expect(projected.nativeBinding).toEqual(content.nativeBinding);
    expect(projected.slides[0]!.nativeCompatibility?.transition).toBe(
      "preserved",
    );

    const withAnimation = pptxArtifactContent({
      ...opened.projection,
      slides: opened.projection.slides.map((slide) => ({
        ...slide,
        hasTiming: true,
      })),
    });
    const animationDocument =
      presentationYjsAdapter.createDocument(withAnimation);
    expect(presentationYjsAdapter.validate(animationDocument)).toEqual({
      valid: true,
    });
    expect(
      presentationYjsAdapter.project(animationDocument).slides[0]!
        .nativeCompatibility?.animations,
    ).toBe("preserved");
  });
});

/**
 * The deck promotions, each proved the way the inventory asks: the write lands,
 * the parts nobody asked for do not move, and reopening the file shows the
 * change. A promotion with no evidence is not a promotion.
 */
describe("PPTX native promotions", () => {
  async function fixture(name: string) {
    return new Uint8Array(
      await readFile(join(process.cwd(), "fixtures", "office", "pptx", `${name}.pptx`)),
    );
  }
  async function changedParts(before: Uint8Array, after: Uint8Array) {
    const comparison = await comparePackages(before, after);
    return comparison.parts
      .filter((part) => part.verdict !== "identical")
      .map((part) => part.name.replace(/^\//, ""));
  }

  it("writes a speaker note into the notes page and leaves the slide alone", async () => {
    const source = await fixture("chart-notes-preservation");
    const opened = await pptxLens.open(source);
    const index = opened.projection.slides.findIndex((slide) => slide.notesPartName);
    expect(index).toBeGreaterThanOrEqual(0);
    const saved = await pptxLens.materialize({
      projection: {
        ...opened.projection,
        slides: opened.projection.slides.map((slide, position) =>
          position === index
            ? { ...slide, speakerNotes: "Open on the number, then the story." }
            : slide,
        ),
      },
      carry: opened.preservedCarry,
    });
    const changed = await changedParts(source, saved);
    // The slide part holds the transition and the timing, so it must not move.
    expect(changed.every((part) => part.includes("notesSlides/"))).toBe(true);
    const reopened = await pptxLens.open(saved);
    expect(reopened.projection.slides[index]!.speakerNotes).toBe(
      "Open on the number, then the story.",
    );
  });

  it("describes a shape and moves it without touching anything else", async () => {
    const source = await fixture("typical-preservation");
    const opened = await pptxLens.open(source);
    const slideIndex = opened.projection.slides.findIndex((slide) =>
      slide.objects.some((object) => !object.locked),
    );
    expect(slideIndex).toBeGreaterThanOrEqual(0);
    const slide = opened.projection.slides[slideIndex]!;
    const target = slide.objects.find((object) => !object.locked)!;
    const saved = await pptxLens.materialize({
      projection: {
        ...opened.projection,
        slides: opened.projection.slides.map((candidate, position) =>
          position !== slideIndex
            ? candidate
            : {
                ...candidate,
                objects: candidate.objects.map((object) =>
                  object.id === target.id
                    ? {
                        ...object,
                        x: object.x + 40,
                        altText: "A described object, for anyone reading by ear.",
                      }
                    : object,
                ),
              },
        ),
      },
      carry: opened.preservedCarry,
    });
    const changed = await changedParts(source, saved);
    expect(changed).toEqual([slide.id.replace(/^pptx:slide:\//, "")]);
    const reopened = await pptxLens.open(saved);
    const moved = reopened.projection.slides[slideIndex]!.objects.find(
      (object) => object.id === target.id,
    )!;
    expect(moved.x).toBeCloseTo(target.x + 40, 0);
    expect(moved.altText).toBe("A described object, for anyone reading by ear.");
  });

  it("adds a slide on the file's own layout and keeps masters preserved", async () => {
    const source = await fixture("masters-media-preservation");
    const opened = await pptxLens.open(source);
    const before = opened.projection.slides.length;
    const saved = await pptxLens.materialize({
      projection: {
        ...opened.projection,
        slides: [
          ...opened.projection.slides,
          {
            id: "spectra:new-slide",
            index: before,
            title: "What we decided",
            text: [],
            objects: [
              {
                id: "spectra:new-slide:shape:1",
                type: "text",
                x: 80,
                y: 300,
                width: 600,
                height: 80,
                rotation: 0,
                content: { text: "One sentence a room can repeat." },
                locked: false,
              },
            ],
            hasTransition: false,
            hasTiming: false,
            speakerNotes: "",
          },
        ],
      },
      carry: opened.preservedCarry,
    });
    const changed = await changedParts(source, saved);
    // Growing a deck writes a new slide part, the presentation's slide list and
    // the OPC bookkeeping. It never rewrites a master or a layout, which is why
    // masters can stay PRESERVED while Add slide is native.
    expect(changed.some((part) => part.startsWith("ppt/slideMasters/"))).toBe(false);
    expect(changed.some((part) => part.startsWith("ppt/slideLayouts/"))).toBe(false);
    expect(changed).toContain("ppt/presentation.xml");
    const reopened = await pptxLens.open(saved);
    expect(reopened.projection.slides).toHaveLength(before + 1);
    expect(reopened.projection.slides.at(-1)!.title).toBe("What we decided");
  });

  it("puts a new slide where the person put it, not at the end", async () => {
    const source = await fixture("masters-media-preservation");
    const opened = await pptxLens.open(source);
    const first = opened.projection.slides[0]!;
    const saved = await pptxLens.materialize({
      projection: {
        ...opened.projection,
        slides: [
          {
            id: "spectra:inserted",
            index: 0,
            title: "Before everything",
            text: [],
            objects: [],
            hasTransition: false,
            hasTiming: false,
            speakerNotes: "",
          },
          ...opened.projection.slides,
        ],
      },
      carry: opened.preservedCarry,
    });
    const reopened = await pptxLens.open(saved);
    expect(reopened.projection.slides[0]!.title).toBe("Before everything");
    expect(reopened.projection.slides[1]!.title).toBe(first.title);
  });

  it("removes a slide and leaves the surviving slides byte-identical", async () => {
    const source = await fixture("typical-preservation");
    const opened = await pptxLens.open(source);
    if (opened.projection.slides.length < 2) return;
    const dropped = opened.projection.slides[0]!;
    const saved = await pptxLens.materialize({
      projection: { ...opened.projection, slides: opened.projection.slides.slice(1) },
      carry: opened.preservedCarry,
    });
    const changed = await changedParts(source, saved);
    const survivors = opened.projection.slides
      .slice(1)
      .map((slide) => slide.id.replace(/^pptx:slide:\//, ""));
    for (const survivor of survivors) expect(changed).not.toContain(survivor);
    const reopened = await pptxLens.open(saved);
    expect(reopened.projection.slides).toHaveLength(
      opened.projection.slides.length - 1,
    );
    expect(
      reopened.projection.slides.some((slide) => slide.id === dropped.id),
    ).toBe(false);
  });

  it("reorders a deck by moving only the slide list", async () => {
    const source = await fixture("typical-preservation");
    const opened = await pptxLens.open(source);
    if (opened.projection.slides.length < 2) return;
    const reversed = [...opened.projection.slides].reverse();
    const saved = await pptxLens.materialize({
      projection: { ...opened.projection, slides: reversed },
      carry: opened.preservedCarry,
    });
    const changed = await changedParts(source, saved);
    expect(changed).toEqual(["ppt/presentation.xml"]);
    const reopened = await pptxLens.open(saved);
    expect(reopened.projection.slides.map((slide) => slide.title)).toEqual(
      reversed.map((slide) => slide.title),
    );
  });

  it("classifies every deck region by its own region key", async () => {
    const opened = await pptxLens.open(await nativeTransitionFixture());
    const byFeature = new Map(
      opened.fidelityMap.entries.map((entry) => [entry.feature, entry]),
    );
    const regions = [
      "slides",
      "shapes",
      "speakerNotes",
      "transitions",
      "animations",
      "masters",
      "layouts",
      "media",
      "charts",
      "tables",
    ];
    for (const region of regions) expect(byFeature.has(region)).toBe(true);
    // Masters are preserved on purpose: Spectra reads them and never writes
    // them, so a command that claimed them would be claiming a lie.
    expect(byFeature.get("masters")!.class).toBe("PRESERVED");
    expect(byFeature.get("slides")!.class).toBe("NATIVE");
    // Anything less than native owes a person a sentence. Only the region-key
    // pass is asserted here; the per-part entries are the older feature-named
    // pass the harness reads.
    for (const region of regions) {
      const entry = byFeature.get(region)!;
      if (entry.class === "NATIVE") continue;
      expect((entry.reason ?? "").length).toBeGreaterThan(8);
    }
    // Every class is one of the four the contract defines. A fifth name would
    // compile behind a cast and then be dropped by every reader between here and
    // the bar, so the region would silently look editable and the reason a
    // person needs would never be shown anywhere.
    const allowed = new Set(["NATIVE", "EQUIVALENT", "PRESERVED", "EXTENSION"]);
    for (const entry of opened.fidelityMap.entries) {
      expect(allowed.has(entry.class), `${entry.feature} ${entry.class}`).toBe(true);
    }
  });

  it("creates a native notes page and master when a slide has none", async () => {
    const deck = await Presentation.create();
    deck.addSlide({ layoutIndex: 0 });
    const bytes = await deck.save();
    const opened = await pptxLens.open(bytes);
    const byFeature = new Map(
      opened.fidelityMap.entries.map((entry) => [entry.feature, entry]),
    );
    const notes = byFeature.get("speakerNotes")!;
    expect(notes.class).toBe("EQUIVALENT");
    expect(pptxArtifactContent(opened.projection).slides[0]!.nativeCompatibility?.speakerNotes)
      .toBeUndefined();
    const projection = structuredClone(opened.projection);
    projection.slides[0]!.speakerNotes = "Created as native PowerPoint notes.";
    const saved = await pptxLens.materialize({ projection, carry: opened.preservedCarry });
    const reopened = await pptxLens.open(saved);
    expect(reopened.projection.slides[0]).toMatchObject({
      speakerNotes: "Created as native PowerPoint notes.",
      notesPartName: expect.stringMatching(/^\/ppt\/notesSlides\/notesSlide\d+\.xml$/),
    });
    const diff = await pptxLens.diffExternal(bytes, saved);
    expect(diff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ regionId: reopened.projection.slides[0]!.id, kind: "update" }),
    ]));
    expect(diff.preservedPartChanges.some((part) => /notesSlides|notesMasters/.test(part))).toBe(false);
    const native = await Presentation.open(saved);
    expect(native.office.package.parts().some((part) => /\/ppt\/notesMasters\/notesMaster\d+\.xml$/i.test(part.name)))
      .toBe(true);
    expect(pptxLens.capabilities("strict-native", reopened.fidelityMap).human.find(
      (entry) => entry.id === "edit-speaker-notes",
    )).toMatchObject({ available: true });
  });

  it("says a deck can add, remove and reorder slides natively", async () => {
    const opened = await pptxLens.open(await nativeTransitionFixture());
    const capabilities = pptxLens.capabilities("strict-native", opened.fidelityMap);
    for (const id of [
      "add-slide-on-existing-layout",
      "remove-slide",
      "reorder-slides",
    ]) {
      expect(capabilities.human.find((entry) => entry.id === id)?.available).toBe(
        true,
      );
    }
    for (const op of ["add_slide", "delete_slide", "reorder_slides"]) {
      expect(capabilities.aiOperations).toContain(op);
    }
  });
});
