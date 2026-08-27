import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Workbook } from "@ariadng/office/xlsx";
import { comparePackages } from "@ariadng/office/preservation";
import { mergeDocxProjections } from "@/app/api/spectra/lenses/docx/route";
import { contentToPptx } from "@/app/api/spectra/lenses/office/route";
import { assertPreservationKept } from "../commands/office/preservation-guard";
import { claimHolds, inspectOfficePackage } from "../lenses/corpus-facts";
import {
  externalLinkWorkbookFixture,
  footerTableFixture,
  loadDocxFixture,
  loadPptxFixture,
  localeWorkbookFixture,
  mergedNestedTablesFixture,
  sdtWrappedTablesFixture,
} from "../lenses/corpus-builders";
import { docxLens, type DocxRunFormat } from "../lenses/docx-lens";
import {
  pptxProjectionUpdateFromContent,
} from "../lenses/office-content";
import { pptxLens } from "../lenses/pptx-lens";
import {
  flattenTablesLikePreFixAdapter,
  runDocxProductionSeam,
  runPptxProductionSeam,
  runXlsxProductionSeam,
  sortSheetRows,
} from "../lenses/seam-contract";
import { presentationYjsAdapter } from "../work/models/yjs/structured-adapters";

const sequencesRoot = join(process.cwd(), "fixtures", "office", "sequences");
const officeRoot = join(process.cwd(), "fixtures", "office");

async function sidecarFiles() {
  const groups = ["docx", "xlsx", "pptx"] as const;
  const found: Array<{ sidecar: string; packagePath: string | null }> = [];
  for (const group of groups) {
    const dir = join(officeRoot, group);
    const names = await readdir(dir);
    for (const name of names.filter((entry) => entry.endsWith(".fixture.json"))) {
      const stem = name.replace(/\.fixture\.json$/, "");
      const packageName = names.find(
        (entry) =>
          entry.startsWith(stem) &&
          !entry.endsWith(".fixture.json") &&
          !entry.endsWith(".md"),
      );
      found.push({
        sidecar: join(dir, name),
        packagePath: packageName ? join(dir, packageName) : null,
      });
    }
  }
  return found;
}

describe("TEST-2 corpus sidecars match fixture bytes", () => {
  it("grades every committed contains claim against the package", async () => {
    const failures: string[] = [];
    for (const entry of await sidecarFiles()) {
      const sidecar = JSON.parse(await readFile(entry.sidecar, "utf8")) as {
        contains?: string[];
      };
      if (!entry.packagePath) {
        failures.push(`${entry.sidecar}: sidecar has no sibling package`);
        continue;
      }
      const facts = inspectOfficePackage(new Uint8Array(await readFile(entry.packagePath)));
      for (const claim of sidecar.contains ?? []) {
        const reason = claimHolds(facts, claim);
        if (reason) failures.push(`${entry.sidecar}: "${claim}" — ${reason}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("builds the missing school-file facts that the old sidecars invented", async () => {
    const sdt = inspectOfficePackage(await sdtWrappedTablesFixture());
    expect(sdt.sdtWrappedTables).toBe(true);
    expect(sdt.tableCount).toBeGreaterThanOrEqual(2);

    const merged = inspectOfficePackage(await mergedNestedTablesFixture());
    expect(merged.mergedCells).toBe(true);
    expect(merged.nestedTables).toBe(true);

    const footer = inspectOfficePackage(await footerTableFixture());
    expect(footer.headerFooterTables).toBe(true);

    const locale = inspectOfficePackage(await localeWorkbookFixture());
    expect(claimHolds(locale, "locale")).toBeNull();

    const linked = inspectOfficePackage(await externalLinkWorkbookFixture());
    expect(linked.externalLinks).toBe(true);

    const fourByThree = inspectOfficePackage(
      await loadPptxFixture("chart-notes-preservation.pptx"),
    );
    expect(claimHolds(fourByThree, "non-16:9")).toBeNull();
  });
});

describe("L1 production seam — Part III–V CRITICAL", () => {
  it("DOC-1 table round-trip keeps the table and neighboring prose", async () => {
    const source = await loadDocxFixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const table = opened.projection.blocks.find((block) => block.type === "table");
    const neighbor = opened.projection.blocks.find(
      (block) => block.type !== "table" && block.text.trim().length > 0,
    );
    expect(table && neighbor).toBeTruthy();
    const neighborText = neighbor!.text;

    const seam = await runDocxProductionSeam(source, ({ blocks }) => ({
      blocks: blocks.map((block) =>
        block.id === table!.id && block.rows
          ? {
              ...block,
              rows: block.rows.map((row, rowIndex) =>
                rowIndex === 0
                  ? row.map((cell, column) => (column === 0 ? "Spectra cell" : cell))
                  : row,
              ),
            }
          : block,
      ),
      nativeProjectionComplete: true,
    }));

    expect(seam.afterYjs.blocks?.some((block) => block.type === "table")).toBe(true);
    const reopenedTable = seam.reopened.projection.blocks.find(
      (block) => block.id === table!.id,
    );
    expect(reopenedTable?.type).toBe("table");
    expect(reopenedTable?.rows?.[0]?.[0]).toBe("Spectra cell");
    expect(
      seam.reopened.projection.blocks.find((block) => block.id === neighbor!.id)?.text,
    ).toBe(neighborText);
    expect(seam.afterIds).toEqual(expect.arrayContaining(seam.beforeIds));

    const flattened = flattenTablesLikePreFixAdapter(opened.projection.blocks);
    expect(flattened.find((block) => block.id === table!.id)?.type).toBe("paragraph");
  });

  it("DOC-2 formatting-only native edits are visible to diff and merge", async () => {
    const source = await loadDocxFixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const target = opened.projection.blocks.find(
      (block) =>
        block.type !== "table" &&
        block.attrs?.nativeReadOnly !== true &&
        Boolean(block.attrs?.format),
    )!;
    const previous = target.attrs?.format as DocxRunFormat;
    const formatted = await docxLens.mutate(opened.preservedCarry, {
      kind: "format-runs",
      regionId: target.id,
      format: { ...previous, bold: !previous.bold },
    });
    const diff = await docxLens.diffExternal(source, formatted);
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ regionId: target.id, kind: "update" }),
      ]),
    );
    const external = await docxLens.open(formatted);
    const merged = mergeDocxProjections(
      opened.projection,
      opened.projection,
      external.projection,
    );
    expect(merged.conflicts).toEqual([]);
    const mergedFormat = merged.projection.blocks.find((block) => block.id === target.id)
      ?.attrs?.format as DocxRunFormat;
    expect(mergedFormat.bold).toBe(!previous.bold);
  });

  it("DOC-3 stale-base overwrite is a merge, not a silent clobber", async () => {
    const source = await loadDocxFixture("complex-structure.docx");
    const opened = await docxLens.open(source);
    const target = opened.projection.blocks.find(
      (block) => block.type !== "table" && block.text.trim().length > 0,
    )!;
    const spectra = await runDocxProductionSeam(source, ({ blocks }) => ({
      blocks: blocks.map((block) =>
        block.id === target.id ? { ...block, text: "Spectra later" } : block,
      ),
      nativeProjectionComplete: true,
    }));
    const wordBytes = await docxLens.mutate(opened.preservedCarry, {
      kind: "ai-edit",
      operations: [
        {
          kind: "insert-paragraph",
          regionId: "docx:paragraph:wordonly",
          afterRegionId: target.id,
          text: "Word saved this while Spectra was materializing",
        },
      ],
    });
    const word = await docxLens.open(wordBytes);
    const staleClobber = await docxLens.materialize({
      projection: spectra.update.projection,
      carry: opened.preservedCarry,
    });
    const clobbered = await docxLens.open(staleClobber);
    expect(
      clobbered.projection.blocks.some((block) =>
        block.text.includes("Word saved this"),
      ),
    ).toBe(false);

    const merged = mergeDocxProjections(
      opened.projection,
      spectra.update.projection,
      word.projection,
      "spectra",
    );
    expect(
      merged.projection.blocks.some((block) =>
        block.text.includes("Word saved this"),
      ),
    ).toBe(true);
    expect(
      merged.projection.blocks.find((block) => block.id === target.id)?.text,
    ).toBe("Spectra later");
  });

  it("XLS-1 a cell edit through the office route does not trip the preservation guard", async () => {
    const workbook = Workbook.create();
    workbook.sheet("Sheet1")!.setCell("A1", "Keep the rest");
    workbook.sheet("Sheet1")!.setCell("B1", "Neighbor");
    const source = await workbook.save();
    const seam = await runXlsxProductionSeam(source, (content) => {
      const sheet = content.sheets[0]!;
      sheet.cells.A1 = { ...sheet.cells.A1, value: "Edited through the seam" };
      return content;
    });
    expect(() =>
      assertPreservationKept({
        entries: seam.opened.fidelityMap.entries,
        parts: seam.comparison.parts,
      }),
    ).not.toThrow();
    expect(
      seam.comparison.parts.some((part) =>
        /worksheets\/sheet/i.test(part.name) && part.verdict !== "identical",
      ),
    ).toBe(true);

    const mutantEntries = seam.opened.fidelityMap.entries.map((entry) =>
      /worksheets\/sheet/i.test(String(entry.partName ?? ""))
        ? { ...entry, class: "PRESERVED" as const, readOnly: true }
        : entry,
    );
    expect(() =>
      assertPreservationKept({
        entries: mutantEntries,
        parts: seam.comparison.parts,
      }),
    ).toThrow();
  });

  it("XLS-2 sort offsets formula references before they reach the file", async () => {
    const workbook = Workbook.create();
    const sheet = workbook.sheet("Sheet1")!;
    sheet.setCell("A2", "b");
    sheet.setCell("A3", "a");
    sheet.setFormula("B2", "A2*2");
    sheet.setFormula("B3", "A3*10");
    const source = await workbook.save();
    const seam = await runXlsxProductionSeam(source, (content) =>
      sortSheetRows(content, 1, 2, 0),
    );
    expect(seam.update.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "set-formula", ref: "B2" }),
      ]),
    );
    const native = await Workbook.open(seam.output);
    expect(native.sheet("Sheet1")!.getFormula("B2")).toMatch(/A2\*10/);
    expect(seam.afterYjs.sheets[0]!.cells.B2?.formula).toBe("=A2*10");
    expect(seam.afterYjs.sheets[0]!.cells.B3?.formula).toBe("=A3*2");
    expect(seam.afterYjs.sheets[0]!.cells.A2?.value).toBe("a");
  });

  it("XLS-3 a deleted cell becomes a clear-cell and leaves the file", async () => {
    const workbook = Workbook.create();
    workbook.sheet("Sheet1")!.setCell("A1", "Keep me");
    workbook.sheet("Sheet1")!.setCell("C2", "Delete me");
    const source = await workbook.save();
    const seam = await runXlsxProductionSeam(source, (next) => {
      const target = next.sheets[0]!;
      delete target.cells.C2;
      return next;
    });
    expect(seam.update.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "clear-cell", ref: "C2" }),
      ]),
    );
    expect(
      seam.reopened.projection.sheets[0]!.cells.some((cell) => cell.ref === "C2"),
    ).toBe(false);
    expect(
      seam.reopened.projection.sheets[0]!.cells.some((cell) => cell.ref === "A1"),
    ).toBe(true);
  });

  it("PPT-1 a missing or empty persisted deck yields the native projection", async () => {
    const source = await loadPptxFixture("transition-law.pptx");
    const opened = await pptxLens.open(source);
    expect(pptxProjectionUpdateFromContent(null, opened.projection).projection).toEqual(
      opened.projection,
    );
    expect(contentToPptx({ slides: [] }, opened.projection).slides).toEqual(
      opened.projection.slides,
    );
  });

  it("PPT-2 a new object on an existing slide survives Yjs, route merge, and materialize", async () => {
    const source = await loadPptxFixture("transition-law.pptx");
    const seam = await runPptxProductionSeam(source, (content) => {
      const slide = content.slides[0]!;
      slide.objects = [
        ...slide.objects,
        {
          id: "spectra-added",
          type: "text",
          x: 120,
          y: 200,
          width: 400,
          height: 80,
          rotation: 0,
          content: { text: "Spectra added this object" },
        },
      ];
      return content;
    });
    expect(seam.merged.slides[0]!.objects.some((object) => object.id === "spectra-added")).toBe(
      true,
    );
    expect(
      seam.reopened.projection.slides[0]!.objects.some((object) => {
        const value = object.content as { text?: string } | string | undefined;
        const text = typeof value === "string" ? value : value?.text;
        return text === "Spectra added this object";
      }),
    ).toBe(true);
    expect(seam.reopened.projection.slides[0]!.hasTransition).toBe(true);
  });
});

describe("L1 sequence fixtures", () => {
  it("lists first-class multi-step sessions next to the corpus", async () => {
    const names = (await readdir(sequencesRoot)).filter((name) => name.endsWith(".json"));
    expect(names.sort()).toEqual([
      "docx-table-then-external-format.json",
      "pptx-add-object-undo-rematerialize.json",
      "xlsx-clear-then-sort.json",
    ]);
  });

  it("DOC-1 then DOC-2: table edit, then a formatting-only Word save", async () => {
    const source = await loadDocxFixture("complex-structure.docx");
    const tableEdit = await runDocxProductionSeam(source, ({ blocks }) => {
      const table = blocks.find((block) => block.type === "table" && block.rows);
      return {
        blocks: blocks.map((block) =>
          block.id === table?.id && block.rows
            ? {
                ...block,
                rows: block.rows.map((row, rowIndex) =>
                  rowIndex === 0
                    ? row.map((cell, column) => (column === 0 ? "Sequence cell" : cell))
                    : row,
                ),
              }
            : block,
        ),
        nativeProjectionComplete: true,
      };
    });
    const target = tableEdit.reopened.projection.blocks.find(
      (block) =>
        block.type !== "table" &&
        block.attrs?.nativeReadOnly !== true &&
        Boolean(block.attrs?.format),
    )!;
    const previous = target.attrs?.format as DocxRunFormat;
    const formatted = await docxLens.mutate(tableEdit.reopened.preservedCarry, {
      kind: "format-runs",
      regionId: target.id,
      format: { ...previous, italic: true },
    });
    const diff = await docxLens.diffExternal(tableEdit.output, formatted);
    expect(diff.changes.some((change) => change.regionId === target.id)).toBe(true);
    const comparison = await comparePackages(source, formatted);
    expect(
      comparison.parts.some((part) => part.verdict !== "identical"),
    ).toBe(true);
  });

  it("PPT-2 undo mid-sequence then rematerialize still keeps the new object", async () => {
    const source = await loadPptxFixture("transition-law.pptx");
    const opened = await pptxLens.open(source);
    const content = (await import("../lenses/office-content")).pptxArtifactContent(
      opened.projection,
    );
    const document = presentationYjsAdapter.createDocument(content);
    const actor = { clientId: "p2-i5-sequence", kind: "human" as const };
    const undo = presentationYjsAdapter.createUndoManager(document, actor);
    const origin = presentationYjsAdapter.origins(actor).localHuman;
    const withObject = presentationYjsAdapter.project(document);
    withObject.slides[0]!.objects.push({
      id: "spectra-sequence",
      type: "text",
      x: 80,
      y: 80,
      width: 300,
      height: 60,
      rotation: 0,
      content: { text: "Undo me" },
    });
    presentationYjsAdapter.applyProjection(document, withObject, origin);
    expect(
      presentationYjsAdapter
        .project(document)
        .slides[0]!.objects.some((object) => object.id === "spectra-sequence"),
    ).toBe(true);
    undo.undo();
    expect(
      presentationYjsAdapter
        .project(document)
        .slides[0]!.objects.some((object) => object.id === "spectra-sequence"),
    ).toBe(false);
    const again = presentationYjsAdapter.project(document);
    again.slides[0]!.objects.push({
      id: "spectra-sequence",
      type: "text",
      x: 80,
      y: 80,
      width: 300,
      height: 60,
      rotation: 0,
      content: { text: "After undo" },
    });
    const seam = await runPptxProductionSeam(source, () => again);
    expect(
      seam.reopened.projection.slides[0]!.objects.some((object) => {
        const value = object.content as { text?: string } | undefined;
        return value?.text === "After undo";
      }),
    ).toBe(true);
  });
});
