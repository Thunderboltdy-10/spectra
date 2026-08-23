import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { comparePackages } from "@ariadng/office/preservation";
import { XmlElement, serializeNode } from "@ariadng/office/xml";
import { Workbook } from "@ariadng/office/xlsx";
import { Presentation } from "@ariadng/office/pptx";
import { pptxLens } from "../../src/features/spectra/lenses/pptx-lens";
import { xlsxLens } from "../../src/features/spectra/lenses/xlsx-lens";
import { runPptxCommandFixtures } from "./pptx-commands";
import { runXlsxCommandFixtures } from "./xlsx-commands";

function descendants(root: XmlElement) {
  const found: XmlElement[] = [];
  const pending = [...root.elements()].reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    found.push(node);
    const nested = node.elements();
    for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!);
  }
  return found;
}

async function main() {
  const evidence = join(process.cwd(), ".shots", "missions", "N5");
  await mkdir(evidence, { recursive: true });
  // This source is authored and saved by Excel itself. Do not synthesize a
  // fake vbaProject.bin: Office rejects arbitrary bytes and silently repairs
  // the workbook, which would make preservation evidence meaningless.
  const xlsxCorpusSource = new Uint8Array(await readFile(join(process.cwd(), "fixtures", "office", "xlsx", "representative.xlsm")));
  const sourceFiles = unzipSync(xlsxCorpusSource);
  const macroBytes = sourceFiles["xl/vbaProject.bin"];
  if (!macroBytes || macroBytes.byteLength < 1024) throw new Error("The XLSM corpus must contain a real Office-authored VBA project.");
  const sourceSheetXml = strFromU8(sourceFiles["xl/worksheets/sheet1.xml"]!);
  const formulaScanSource = sourceSheetXml.includes("XLOOKUP") && sourceSheetXml.includes("SUM(A2:B2)");
  const xlsxOpened = await xlsxLens.open(xlsxCorpusSource);
  const xlsxEdited = await xlsxLens.materialize({ projection: { ...xlsxOpened.projection, sheets: xlsxOpened.projection.sheets.map((candidate) => ({ ...candidate, cells: candidate.cells.map((cell) => cell.ref === "A1" ? { ...cell, value: "Edited" } : cell) })) }, carry: xlsxOpened.preservedCarry });
  const xlsxComparison = await comparePackages(xlsxCorpusSource, xlsxEdited);
  const xlsxReopened = await Workbook.open(xlsxEdited);
  const editedSheetXml = serializeNode((await xlsxReopened.office.xml(xlsxReopened.sheet("Sheet1")!.partName)).root);
  const formulaScan = editedSheetXml.includes("XLOOKUP(A2,A2:A2,B2:B2)") && editedSheetXml.includes("SUM(A2:B2)");
  const cachedFormula = xlsxOpened.projection.sheets[0]!.cells.find((cell) => cell.ref === "C2");
  const customPartPreserved = new TextDecoder().decode(await xlsxReopened.office.package.getPart("/xl/customXml/item1.xml")!.read()) === "<custom>opaque</custom>";
  const macroPartPreserved = (await xlsxReopened.office.package.getPart("/xl/vbaProject.bin")!.read()).every((byte, index) => byte === macroBytes[index]);
  const xlsxCapabilityAssertions = [];
  for (const [fileName, expectedParts] of [
    ["complex-preservation.xlsx", [/xl\/charts\//i, /xl\/tables\//i, /xl\/diagrams\//i]],
    ["comments-preservation.xlsx", [/xl\/comments\d*\.xml$/i, /xl\/drawings\/vmlDrawing/i]],
    ["active-x-preservation.xlsm", [/xl\/activeX\//i, /xl\/drawings\/vmlDrawing/i]],
  ] as const) {
    const source = new Uint8Array(await readFile(join(process.cwd(), "fixtures", "office", "xlsx", fileName)));
    const names = Object.keys(unzipSync(source));
    const opened = await xlsxLens.open(source);
    const firstSheet = opened.projection.sheets[0];
    if (!firstSheet) throw new Error(`${fileName} has no projected sheet to edit`);
    const firstCell = firstSheet.cells[0];
    const edited = firstCell
      ? await xlsxLens.materialize({ projection: { ...opened.projection, sheets: opened.projection.sheets.map((sheet, index) => index === 0 ? { ...sheet, cells: sheet.cells.map((cell, cellIndex) => cellIndex === 0 ? { ...cell, value: typeof cell.value === "number" ? Number(cell.value) + 1 : `${cell.value ?? ""} edited` } : cell) } : sheet) }, carry: opened.preservedCarry })
      : await xlsxLens.mutate(opened.preservedCarry, { kind: "set-cell", sheetId: firstSheet.id, ref: "A1", value: "Spectra preservation edit" });
    const comparison = await comparePackages(source, edited);
    const preservedResults = expectedParts.map((pattern) => {
      const name = names.find((candidate) => pattern.test(candidate)) ?? null;
      return { name, identical: Boolean(name && comparison.parts.find((part) => part.name === name && part.verdict === "identical")) };
    });
    if (preservedResults.some((item) => !item.name || !item.identical)) throw new Error(`${fileName} lost a preserved Office part`);
    xlsxCapabilityAssertions.push({ fileName, format: opened.projection.nativeBinding.format, preservedResults, changedParts: comparison.parts.filter((part) => part.verdict !== "identical").map((part) => part.name) });
  }

  // Read the checked-in PowerPoint-authored source. Never regenerate it with
  // @ariadng/office: that would only prove a closed loop around its output.
  const pptxSource = new Uint8Array(await readFile(join(process.cwd(), "fixtures", "office", "pptx", "transition-law.pptx")));
  const pptxOpened = await pptxLens.open(pptxSource); const slideId = pptxOpened.projection.slides[0]!.id;
  const pptxAnimationSource = new Uint8Array(await readFile(join(process.cwd(), "fixtures", "office", "pptx", "animation-timing.pptx")));
  const pptxAnimationOpened = await pptxLens.open(pptxAnimationSource);
  const animationSlide = pptxAnimationOpened.projection.slides.find((slide) => slide.hasTiming);
  if (!animationSlide) throw new Error("timing fixture has no projected timing tree");
  const animationEdited = await pptxLens.mutate(pptxAnimationOpened.preservedCarry, { kind: "set-title", slideId: animationSlide.id, text: "Timing-safe edit" });
  const animationReopened = await pptxLens.open(animationEdited);
  const mutations = [
    { name: "title", carry: pptxOpened.preservedCarry, delta: { kind: "set-title", slideId, text: "Edited title text" } as const },
    { name: "object", carry: pptxOpened.preservedCarry, delta: { kind: "set-text", slideId, paragraphIndex: 1, text: "Edited object" } as const },
    { name: "add-object", carry: pptxOpened.preservedCarry, delta: { kind: "add-text-box", slideId, text: "Added object" } as const },
  ];
  const sourceDeck = await Presentation.open(pptxSource);
  const sourceNodes = descendants(sourceDeck.slides()[0]!.root());
  const transitionXml = serializeNode(sourceNodes.find((node) => node.namespaceUri() === "http://schemas.openxmlformats.org/presentationml/2006/main" && node.localName === "transition")!);
  const sourceTiming = sourceNodes.find((node) => node.namespaceUri() === "http://schemas.openxmlformats.org/presentationml/2006/main" && node.localName === "timing");
  const timingXml = sourceTiming ? serializeNode(sourceTiming) : null;
  const transitionAssertions = [];
  for (const mutation of mutations) { const output = await pptxLens.mutate(mutation.carry, mutation.delta); const reopened = await Presentation.open(output); const nodes = descendants(reopened.slides()[0]!.root()); const node = nodes.find((candidate) => candidate.namespaceUri() === "http://schemas.openxmlformats.org/presentationml/2006/main" && candidate.localName === "transition"); const timingNode = nodes.find((candidate) => candidate.namespaceUri() === "http://schemas.openxmlformats.org/presentationml/2006/main" && candidate.localName === "timing"); transitionAssertions.push({ mutation: mutation.name, transitionPresent: Boolean(node), transitionIdentical: Boolean(node && serializeNode(node) === transitionXml), timingIdentical: timingXml ? Boolean(timingNode && serializeNode(timingNode) === timingXml) : !timingNode }); }
  const pptxCapabilityAssertions = [];
  for (const [fileName, expectedParts] of [
    ["masters-media-preservation.pptx", [/ppt\/slideMasters\//i, /ppt\/slideLayouts\//i, /ppt\/media\//i]],
    ["media-preservation.pptx", [/ppt\/media\//i]],
    ["chart-notes-preservation.pptx", [/ppt\/charts\//i, /ppt\/notesSlides\//i, /ppt\/embeddings\//i]],
    ["typical-preservation.pptx", [/ppt\/notesSlides\//i, /ppt\/embeddings\//i, /ppt\/media\//i]],
  ] as const) {
    const source = new Uint8Array(await readFile(join(process.cwd(), "fixtures", "office", "pptx", fileName)));
    const names = Object.keys(unzipSync(source));
    const opened = await pptxLens.open(source);
    const slide = opened.projection.slides[0];
    if (!slide) throw new Error(`${fileName} has no projected slide to edit`);
    const edited = await pptxLens.mutate(opened.preservedCarry, { kind: "set-title", slideId: slide.id, text: `${slide.title} edited` });
    const comparison = await comparePackages(source, edited);
    const preservedResults = expectedParts.map((pattern) => {
      const name = names.find((candidate) => pattern.test(candidate)) ?? null;
      return { name, identical: Boolean(name && comparison.parts.find((part) => part.name === name && part.verdict === "identical")) };
    });
    if (preservedResults.some((item) => !item.name || !item.identical)) throw new Error(`${fileName} lost a preserved Office part`);
    pptxCapabilityAssertions.push({ fileName, format: opened.projection.nativeBinding.format, slideCount: opened.projection.slides.length, preservedResults, changedParts: comparison.parts.filter((part) => part.verdict !== "identical").map((part) => part.name) });
  }
  const largeStart = performance.now(); const largeBook = Workbook.create(); const largeSheet = largeBook.sheet("Sheet1")!; for (let index = 0; index < 200_000; index += 1) largeSheet.setCell(`A${index + 1}`, index); const largeBytes = await largeBook.save(); const largeOpenStart = performance.now(); const largeOpened = await xlsxLens.open(largeBytes); const largeOutput = await xlsxLens.materialize({ projection: { ...largeOpened.projection, sheets: largeOpened.projection.sheets.map((sheet) => ({ ...sheet, cells: sheet.cells.map((cell) => cell.ref === "A1" ? { ...cell, value: "edited" } : cell) })) }, carry: largeOpened.preservedCarry }); const largeEnd = performance.now();
  const deckLarge = Presentation.create(); for (let index = 1; index < 120; index += 1) deckLarge.addSlide(); const deckLargeBytes = await deckLarge.save(); const deckLargeOpenStart = performance.now(); const deckLargeOpened = await pptxLens.open(deckLargeBytes); const deckLargeOutput = await pptxLens.mutate(deckLargeOpened.preservedCarry, { kind: "add-text-box", slideId: deckLargeOpened.projection.slides[0]!.id, text: "edited" }); const deckLargeEnd = performance.now();
  const pptxCommandEvidence = await runPptxCommandFixtures(join(process.cwd(), "fixtures", "office", "pptx"));
  const xlsxCommandEvidence = await runXlsxCommandFixtures(join(process.cwd(), "fixtures", "office", "xlsx"));
  const report = { xlsx: { format: xlsxOpened.projection.nativeBinding.format, macroEnabled: xlsxOpened.projection.nativeBinding.macroEnabled, cachedOnlyFormula: { formula: cachedFormula?.formula, value: cachedFormula?.value, support: cachedFormula?.formulaSupport }, formulaPolicy: "cached-only formula remains formula text", formulaScan: formulaScan && formulaScanSource, customPartPreserved, macroPartPreserved, macroBytes: macroBytes.byteLength, changedParts: xlsxComparison.parts.filter((part) => part.verdict !== "identical").map((part) => part.name), capabilityAssertions: xlsxCapabilityAssertions, commandFixtures: xlsxCommandEvidence.assertions }, pptx: { titlePlaceholder: pptxOpened.projection.slides[0]!.title === "Original title", transitionAssertions, timingCorpus: { slides: pptxAnimationOpened.projection.slides.length, sourceHasTiming: true, survivesTitleEdit: Boolean(animationReopened.projection.slides.find((slide) => slide.id === animationSlide.id)?.hasTiming) }, capabilityAssertions: pptxCapabilityAssertions, commandFixtures: pptxCommandEvidence.assertions }, performance: { xlsx200k: { cells: 200000, bytes: largeBytes.byteLength, openEditMaterializeMs: Math.round(largeEnd - largeStart), openMs: Math.round(largeEnd - largeOpenStart), outputBytes: largeOutput.byteLength }, pptx120: { slides: 120, bytes: deckLargeBytes.byteLength, openEditMs: Math.round(deckLargeEnd - deckLargeOpenStart), outputBytes: deckLargeOutput.byteLength } }, generatedAt: new Date().toISOString() };
  await writeFile(join(evidence, "harness-report.json"), JSON.stringify(report, null, 2));
  if (report.xlsx.format !== "xlsm" || !report.xlsx.macroEnabled || cachedFormula?.formulaSupport !== "cached-only" || !formulaScan || !customPartPreserved || !macroPartPreserved || report.xlsx.macroBytes < 1024 || !report.pptx.titlePlaceholder || !pptxOpened.projection.slides[0]!.hasTransition || transitionAssertions.some((item) => !item.transitionPresent || !item.transitionIdentical || !item.timingIdentical) || !report.pptx.timingCorpus.survivesTitleEdit || pptxCommandEvidence.failures.length > 0 || xlsxCommandEvidence.failures.length > 0) throw new Error(`fidelity assertion failed${pptxCommandEvidence.failures.length ? `: ${JSON.stringify(pptxCommandEvidence.failures)}` : ""}`);
  console.log(JSON.stringify({ xlsx: "passed", pptx: "passed", transitionAssertions, pptxCommandFixtures: pptxCommandEvidence.assertions.length, xlsxCommandFixtures: xlsxCommandEvidence.assertions.length, performance: report.performance }));
}

void main();
