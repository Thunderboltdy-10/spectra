import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Workbook } from "@ariadng/office/xlsx";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement, XmlText } from "@ariadng/office/xml";
import { xlsxLens } from "../lenses/xlsx-lens";
import { pptxLens } from "../lenses/pptx-lens";
import {
  pptxArtifactContent,
  xlsxArtifactContent,
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
