import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { Document } from "@ariadng/office/docx";
import { comparePackages } from "@ariadng/office/preservation";
import { Presentation } from "@ariadng/office/pptx";
import { Workbook } from "@ariadng/office/xlsx";
import { exportDocxCopy } from "../../src/features/spectra/lenses/docx-adapter";
import type { DocumentJsonNode } from "../../src/features/spectra/lenses/document-projection";
import { docxLens } from "../../src/features/spectra/lenses/docx-lens";
import { xlsxLens } from "../../src/features/spectra/lenses/xlsx-lens";
import { xlsxArtifactContent, xlsxProjectionFromContent } from "../../src/features/spectra/lenses/office-content";
import { pptxLens } from "../../src/features/spectra/lenses/pptx-lens";
import { applyLinkedChartResolution, resolveLinkedChart } from "../../src/features/spectra/presentation/linked-chart";

const repo = process.cwd();
const evidence = join(repo, ".shots", "missions", "S8-OFFICE");
const corpus = join(evidence, "finite-corpus");
const powershell = "C:\\Users\\pablo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell\\pwsh.exe";
const validatorScript = join(repo, "scripts", "fidelity-harness", "office-sdk-validator.ps1");
const officeScript = join(repo, "scripts", "fidelity-harness", "office-com-readback.ps1");
const customXmlRelationship = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
const customXml = new TextEncoder().encode("<s8-control xmlns=\"urn:spectra:s8\" version=\"1\">untouched</s8-control>");
const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type PackageComparison = Awaited<ReturnType<typeof comparePackages>>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function packageText(bytes: Uint8Array, name: string) {
  const value = unzipSync(bytes)[name];
  return value ? strFromU8(value) : "";
}

function packageNames(bytes: Uint8Array) {
  return Object.keys(unzipSync(bytes));
}

function changedParts(comparison: PackageComparison) {
  return comparison.parts.filter((part) => part.verdict !== "identical").map((part) => part.name);
}

function samePackagePart(left: Uint8Array, right: Uint8Array, name: string) {
  const leftPart = unzipSync(left)[name];
  const rightPart = unzipSync(right)[name];
  if (!leftPart || !rightPart || leftPart.byteLength !== rightPart.byteLength) return false;
  return leftPart.every((value, index) => value === rightPart[index]);
}

async function addRetainedControl(bytes: Uint8Array, format: "docx" | "xlsx" | "pptx") {
  if (format === "docx") {
    const document = await Document.open(bytes);
    document.office.package.addPart("/customXml/s8-control.xml", "application/xml", customXml);
    document.office.mainPart.relationships().add({ type: customXmlRelationship, target: "../customXml/s8-control.xml" });
    return document.save();
  }
  if (format === "xlsx") {
    const workbook = await Workbook.open(bytes);
    workbook.office.package.addPart("/xl/customXml/s8-control.xml", "application/xml", customXml);
    workbook.office.mainPart.relationships().add({ type: customXmlRelationship, target: "customXml/s8-control.xml" });
    return workbook.save();
  }
  const presentation = await Presentation.open(bytes);
  presentation.office.package.addPart("/ppt/customXml/s8-control.xml", "application/xml", customXml);
  presentation.office.mainPart.relationships().add({ type: customXmlRelationship, target: "customXml/s8-control.xml" });
  return presentation.save();
}

function richWordDocument(): DocumentJsonNode {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, blockId: "s8-heading" }, content: [{ type: "text", text: "Water cycle" }] },
      {
        type: "paragraph",
        attrs: { blockId: "s8-mixed" },
        content: [
          { type: "text", text: "English 日本語 العربية", marks: [{ type: "bold" }, { type: "italic" }, { type: "textStyle", attrs: { fontFamily: "游ゴシック", fontSize: "13pt", color: "1F3A2E" } }] },
          { type: "text", text: " source", marks: [{ type: "link", attrs: { href: "https://example.edu/water" } }] },
        ],
      },
      {
        type: "table",
        attrs: { blockId: "s8-table" },
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Stage" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Evidence" }] }] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Rain" }] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Clouds" }] }] }] },
        ],
      },
      { type: "paragraph", attrs: { blockId: "s8-inline-equation" }, content: [{ type: "text", text: "Existing equation: " }, { type: "inlineEquation", attrs: { latex: String.raw`\frac{x+1}{2}`, display: "inline" } }] },
      { type: "equation", attrs: { blockId: "s8-block-equation", latex: String.raw`\sum_{i=1}^{n} i`, display: "block" } },
      { type: "image", attrs: { src: onePixelPng, alt: "Water cycle diagram", widthPercent: 50 } },
    ],
  };
}

async function runProcess(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolveProcess, reject) => {
    const child = spawn(powershell, args, { cwd: repo, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolveProcess({ code: code ?? 1, stdout, stderr }));
  });
}

function parseJsonOutput<T>(output: string): T {
  const start = output.indexOf("{");
  if (start < 0) throw new Error(`PowerShell did not return JSON: ${output}`);
  return JSON.parse(output.slice(start).trim()) as T;
}

async function validatePackage(before: string, after: string, format: "docx" | "xlsx" | "pptx", name: string) {
  const outputPath = join(evidence, `${name}-openxml-validator.json`);
  const result = await runProcess([
    "-File", validatorScript,
    "-Before", before,
    "-After", after,
    "-Format", format,
    "-FileFormatVersion", "Microsoft365",
    "-OutputPath", outputPath,
  ]);
  if (result.code !== 0) throw new Error(`Open XML SDK validator failed for ${name}: ${result.stderr || result.stdout}`);
  const report = parseJsonOutput<Record<string, unknown>>(result.stdout);
  assert(report.validAfter === true, `Open XML SDK reported diagnostics for ${name}: ${JSON.stringify(report.after)}`);
  return report;
}

async function officeReadback(input: string, output: string, format: "docx" | "xlsx" | "pptx", name: string) {
  const reportPath = join(evidence, `${name}-office-readback.json`);
  const result = await runProcess([
    "-File", officeScript,
    "-InputPath", input,
    "-OutputPath", output,
    "-Format", format,
    "-ReportPath", reportPath,
  ]);
  if (result.code !== 0) throw new Error(`Office COM readback failed for ${name}: ${result.stderr || result.stdout}`);
  const report = parseJsonOutput<{ status: string; semantic: Record<string, unknown> }>(result.stdout);
  assert(report.status === "passed", `Office COM readback did not pass for ${name}.`);
  return report;
}

async function runDocxCorpus() {
  const copied = await exportDocxCopy(richWordDocument());
  const authored = await Document.open(copied.bytes);
  authored.setHeader("S8 header", { type: "default" });
  authored.setFooter("S8 footer", { type: "default" });
  const baseline = await addRetainedControl(await authored.save(), "docx");
  const opened = await docxLens.open(baseline, "enhanced");
  const mixed = opened.projection.blocks.find((block) => block.text.includes("English 日本語 العربية"));
  const table = opened.projection.blocks.find((block) => block.type === "table");
  const equation = opened.projection.blocks.find((block) => block.type === "equation");
  assert(mixed && table && equation, "DOCX corpus lost mixed paragraph, table, or existing equation projection.");
  const after = await docxLens.mutate(opened.preservedCarry, {
    kind: "ai-edit",
    operations: [
      { kind: "format-runs", regionId: mixed.id, format: { bold: true, italic: true, fontFamily: "Georgia", fontSizePoints: 14, color: "1F3A2E" } },
      { kind: "edit-table-cell", regionId: table.id, row: 1, column: 1, text: "Clouds edited" },
      { kind: "insert-paragraph", regionId: "s8-matrix", afterRegionId: mixed.id, text: "", inlineContent: [{ kind: "equation", latex: String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`, display: "block" }] },
      { kind: "set-equation-layout", regionId: equation.id, display: "block", alignment: "center" },
      { kind: "update-header-footer", slot: "header", text: "S8 header edited" },
      { kind: "update-header-footer", slot: "footer", text: "S8 footer edited" },
    ],
  });
  const reopened = await docxLens.open(after, "enhanced");
  const reopenedTable = reopened.projection.blocks.find((block) => block.type === "table");
  const reopenedDocument = await Document.open(after);
  const equationText = reopened.projection.blocks.flatMap((block) => block.inlineContent ?? []).filter((item) => item.kind === "equation");
  assert(reopenedTable?.rows?.some((row) => row.includes("Clouds edited")), "DOCX table cell edit did not read back.");
  assert(equationText.some((item) => item.kind === "equation" && item.latex.includes("bmatrix")), "DOCX inserted matrix equation did not read back.");
  assert(equationText.some((item) => item.kind === "equation" && item.latex.includes("sum")), "DOCX existing equation was not retained.");
  assert(reopenedDocument.headers()[0]?.text().includes("S8 header edited"), "DOCX header update did not read back.");
  assert(reopenedDocument.footers()[0]?.text().includes("S8 footer edited"), "DOCX footer update did not read back.");
  assert(reopenedDocument.images().length === 1, "DOCX retained image occurrence was lost.");
  assert(samePackagePart(baseline, after, "customXml/s8-control.xml"), "DOCX retained custom XML control changed.");
  const comparison = await comparePackages(baseline, after);
  const beforePath = join(corpus, "word-before.docx");
  const afterPath = join(corpus, "word-after.docx");
  await writeFile(beforePath, baseline); await writeFile(afterPath, after);
  return {
    format: "docx",
    before: beforePath,
    after: afterPath,
    changedParts: changedParts(comparison),
    retainedControl: true,
    semantic: { mixedRunEdited: true, imageCount: reopenedDocument.images().length, tableCellEdited: true, existingEquation: true, matrixEquation: true, headerFooterEdited: true },
    validator: await validatePackage(beforePath, afterPath, "docx", "word"),
  };
}

async function runXlsxCorpus() {
  const workbook = Workbook.create();
  const sheet = workbook.sheet("Sheet1")!;
  sheet.setCell("A1", "Month"); sheet.setCell("B1", "Revenue"); sheet.setCell("C1", "Margin");
  [["Jan", 10, 0.2], ["Feb", 14, 0.25], ["Mar", 18, 0.3], ["Apr", 22, 0.35], ["May", 26, 0.4], ["Jun", 30, 0.45], ["Jul", 34, 0.5], ["Aug", 38, 0.55], ["Sep", 42, 0.6], ["Oct", 46, 0.65], ["Nov", 50, 0.7], ["Dec", 54, 0.75]].forEach(([month, revenue, margin], index) => {
    sheet.setCell(`A${index + 2}`, month); sheet.setCell(`B${index + 2}`, revenue); sheet.setCell(`C${index + 2}`, margin);
  });
  const source = await addRetainedControl(await workbook.save(), "xlsx");
  const opened = await xlsxLens.open(source, "enhanced");
  const content = xlsxArtifactContent(opened.projection);
  const editorSheet = content.sheets[0]!;
  editorSheet.cells.B2 = { ...editorSheet.cells.B2, validation: { kind: "list", options: ["10", "14", "18"], rejectInvalid: true, showErrorMessage: true, errorTitle: "Invalid revenue", errorMessage: "Choose a known revenue.", promptTitle: "Revenue", promptMessage: "Choose a known value." } };
  editorSheet.conditionalFormats = [{ id: "s8-cf", range: "B2:B13", kind: "cell_is", operator: "greater_than", value: 40, fillColor: "var(--warning)", textColor: "var(--text-primary)", priority: 2, stopIfTrue: true }];
  editorSheet.charts.push(
    { id: "s8-ordinary", type: "line", sourceRange: "Sheet1!A1:B13", title: "Revenue trend", position: { x: 40, y: 40, width: 520, height: 280 } },
    { id: "s8-combo", type: "combo", sourceRange: "Sheet1!A1:C13", title: "Revenue and margin", position: { x: 40, y: 340, width: 520, height: 280 } },
    { id: "s8-histogram", type: "histogram", sourceRange: "Sheet1!B2:B13", title: "Revenue distribution", position: { x: 40, y: 640, width: 520, height: 280 } },
  );
  const baseline = await xlsxLens.materialize({ projection: xlsxProjectionFromContent(content, opened.projection), carry: opened.preservedCarry });
  const baselineOpened = await xlsxLens.open(baseline, "enhanced");
  const baselineContent = xlsxArtifactContent(baselineOpened.projection);
  const baselineSheet = baselineContent.sheets[0]!;
  baselineSheet.cells.B2 = { ...baselineSheet.cells.B2, value: 16 };
  baselineSheet.charts = baselineSheet.charts.map((chart) => chart.id.includes("histogram") || chart.type === "histogram" ? { ...chart, title: "Edited revenue distribution" } : chart.id.includes("combo") || chart.type === "combo" ? { ...chart, title: "Edited revenue and margin" } : { ...chart, title: "Edited revenue trend" });
  const after = await xlsxLens.materialize({ projection: xlsxProjectionFromContent(baselineContent, baselineOpened.projection), carry: baselineOpened.preservedCarry });
  const reopened = await xlsxLens.open(after, "enhanced");
  const charts = reopened.projection.sheets[0]!.charts ?? [];
  const names = packageNames(after);
  const chartExPart = names.find((name) => /^xl\/charts\/chartEx\d+\.xml$/i.test(name));
  const chartParts = names.filter((name) => /^xl\/charts\/chart\d+\.xml$/i.test(name));
  const comboPart = chartParts.find((name) => packageText(after, name).includes("barChart") && packageText(after, name).includes("lineChart"));
  assert(chartExPart && chartParts.length >= 2 && comboPart, "XLSX corpus did not produce ordinary, combo, and ChartEx chart parts.");
  assert(charts.some((chart) => chart.type === "line") && charts.some((chart) => chart.type === "combo") && charts.some((chart) => chart.type === "histogram"), "XLSX chart families did not read back as line, combo, and histogram.");
  const chartExXml = packageText(after, chartExPart);
  assert(chartExXml.includes("binning") && chartExXml.includes("dataId") && chartExXml.includes("_xlchart.v1."), "XLSX histogram is missing interoperable ChartEx bin/value semantics.");
  assert(packageText(after, comboPart).includes("barChart") && packageText(after, comboPart).includes("lineChart"), "XLSX combo chart is missing one of its native plot families.");
  assert(packageText(after, "xl/worksheets/sheet1.xml").includes("dataValidation") && packageText(after, "xl/worksheets/sheet1.xml").includes("conditionalFormatting"), "XLSX validation or conditional-format rule was lost.");
  assert(samePackagePart(baseline, after, "xl/customXml/s8-control.xml"), "XLSX retained custom XML control changed.");
  const comparison = await comparePackages(baseline, after);
  const beforePath = join(corpus, "workbook-before.xlsx");
  const afterPath = join(corpus, "workbook-after.xlsx");
  await writeFile(beforePath, baseline); await writeFile(afterPath, after);
  return {
    format: "xlsx",
    before: beforePath,
    after: afterPath,
    changedParts: changedParts(comparison),
    retainedControl: true,
    semantic: { validation: true, conditionalFormatting: true, ordinaryChart: true, comboChart: true, histogramChartEx: true, chartTypes: charts.map((chart) => chart.type), editedRevenue: xlsxArtifactContent(reopened.projection).sheets[0]!.cells.B2?.value },
    validator: await validatePackage(beforePath, afterPath, "xlsx", "workbook"),
  };
}

async function runPptxCorpus() {
  const fixture = join(repo, "fixtures", "office", "pptx", "chart-notes-preservation.pptx");
  const source = new Uint8Array(await readFile(fixture));
  const baseline = await addRetainedControl(source, "pptx");
  const opened = await pptxLens.open(baseline, "enhanced");
  const sourceSlide = opened.projection.slides[0]!;
  const sourceChart = sourceSlide.objects.find((object) => object.type === "chart");
  assert(sourceChart, "PPTX corpus fixture has no chart object.");
  const nativeShapeId = (sourceChart.content as { nativeShapeId?: string }).nativeShapeId;
  assert(nativeShapeId, "PPTX corpus chart has no native shape identity.");
  const after = await pptxLens.mutate(opened.preservedCarry, {
    kind: "ai-edit",
    operations: [
      { kind: "duplicate-slide", slideId: sourceSlide.id, newSlideId: "s8-duplicate", title: "Duplicated QA slide" },
      { kind: "set-chart", slideId: "s8-duplicate", shapeId: nativeShapeId, chartType: "column", title: "S8 duplicated chart", categories: ["Q1", "Q2"], series: [{ name: "Copied output", categories: ["Q1", "Q2"], values: [901, 902] }], showLegend: true },
      { kind: "set-notes", slideId: "s8-duplicate", text: "S8 duplicate speaker notes" },
      { kind: "add-text-box", slideId: sourceSlide.id, text: "S8 external link", hyperlink: { kind: "external", url: "https://example.com/s8-office" } },
      { kind: "add-text-box", slideId: "s8-duplicate", text: "S8 internal link", hyperlink: { kind: "slide", slideId: sourceSlide.id } },
    ],
  });
  const reopened = await pptxLens.open(after, "enhanced");
  const duplicate = reopened.projection.slides[1]!;
  const duplicateChart = duplicate.objects.find((object) => object.type === "chart");
  const names = packageNames(after);
  assert(reopened.projection.slides.length === 2 && duplicateChart, "PPTX duplicate slide or chart did not read back.");
  assert(names.filter((name) => /^ppt\/charts\/chart\d+\.xml$/i.test(name)).length >= 2, "PPTX duplicate did not receive an isolated chart part.");
  assert(names.filter((name) => /^ppt\/embeddings\/.*\.xlsx$/i.test(name)).length >= 2, "PPTX duplicate did not receive an isolated embedded workbook.");
  assert(names.some((name) => /^ppt\/notesSlides\/notesSlide2\.xml$/i.test(name)), "PPTX duplicate notes part was not created.");
  assert(packageNames(after).filter((name) => /ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(name)).map((name) => packageText(after, name)).some((xml) => xml.includes("https://example.com/s8-office")), "PPTX external hyperlink relationship was not written.");
  assert(packageNames(after).filter((name) => /ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(name)).map((name) => packageText(after, name)).some((xml) => xml.includes("slide1.xml")), "PPTX internal slide hyperlink relationship was not written.");
  assert(packageText(after, "ppt/charts/chart2.xml").includes("Copied output"), "PPTX duplicated chart values did not read back in its own chart part.");
  assert(samePackagePart(baseline, after, "ppt/customXml/s8-control.xml"), "PPTX retained custom XML control changed.");
  const linkedChart = { id: "s8-linked", type: "chart" as const, x: 0, y: 0, width: 100, height: 100, rotation: 0, content: { chartType: "column", categories: ["old"], series: [{ name: "Old", categories: ["old"], values: [1] }] }, sourceBinding: { artifactId: "s8-sheets", kind: "sheets_range" as const, range: "Data!A1:C3", live: true } };
  const sourceArtifact = { _id: "s8-sheets", blueprintKey: "sheets", title: "S8 source", status: "active", content: { activeSheetId: "data", sheets: [{ id: "data", name: "Data", cells: { A1: { value: "Quarter" }, B1: { value: "Output" }, C1: { value: "Cost" }, A2: { value: "Q1" }, B2: { value: 10 }, C2: { value: 2 }, A3: { value: "Q2" }, B3: { value: 20 }, C3: { value: 3 } } }] }, tags: [], createdAt: 1, updatedAt: 2, currentVersionId: "s8-version" };
  const available = resolveLinkedChart(linkedChart, [sourceArtifact as never]);
  assert(available.status === "available" && available.chart?.series.length === 2, "PPTX linked Sheets refresh did not resolve the full series set.");
  const pinned = applyLinkedChartResolution(linkedChart, available);
  assert(pinned.sourceBinding?.live === true && (pinned.content as { series: unknown[] }).series.length === 2, "PPTX linked chart consumer did not retain refreshed content.");
  const comparison = await comparePackages(baseline, after);
  const beforePath = join(corpus, "presentation-before.pptx");
  const afterPath = join(corpus, "presentation-after.pptx");
  await writeFile(beforePath, baseline); await writeFile(afterPath, after);
  return {
    format: "pptx",
    before: beforePath,
    after: afterPath,
    changedParts: changedParts(comparison),
    retainedControl: true,
    semantic: { duplicatedSlide: true, isolatedChartAndWorkbook: true, notes: true, externalLink: true, internalLink: true, linkedSheetsRefresh: true, duplicateChartTitle: (duplicateChart.content as { title?: string }).title },
    validator: await validatePackage(beforePath, afterPath, "pptx", "presentation"),
  };
}

async function main() {
  await mkdir(corpus, { recursive: true });
  const [docx, xlsx, pptx] = await Promise.all([runDocxCorpus(), runXlsxCorpus(), runPptxCorpus()]);
  const office = [];
  for (const item of [docx, xlsx, pptx] as const) {
    const format = item.format as "docx" | "xlsx" | "pptx";
    const extension = format;
    const officePath = join(corpus, `${item.format}-office-saved.${extension}`);
    const readback = await officeReadback(item.after, officePath, format, format);
    const comparison = await comparePackages(new Uint8Array(await readFile(item.after)), new Uint8Array(await readFile(officePath)));
    const officeValidation = await validatePackage(item.after, officePath, format, `${format}-office-saved`);
    office.push({ format: item.format, path: officePath, readback, changedParts: changedParts(comparison), validator: officeValidation });
  }
  const report = {
    mission: "S8-OFFICE",
    generatedAt: new Date().toISOString(),
    independentValidator: { implementation: "DocumentFormat.OpenXml.OpenXmlValidator", sdkVersion: "3.0.1", fileFormatVersion: "Microsoft365", diagnosticsPolicy: "compare exact diagnostic identities before/after; untouched control parts must remain byte-identical" },
    corpus: { root: corpus, word: docx, workbook: xlsx, presentation: pptx },
    officeReadback: office,
    notes: ["Office COM opened disposable copies and saved separate outputs; original fixture and corpus input files were never opened for write.", "Schema validation is independent of the application lens; it does not establish broad Office/Mac parity or live external-service acceptance."],
  };
  await writeFile(join(evidence, "s8-office-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mission: report.mission, corpus: corpus, formats: [docx, xlsx, pptx].map((item) => ({ format: item.format, validAfter: (item.validator as { validAfter?: boolean }).validAfter })), officeReadback: office.map((item) => ({ format: item.format, status: (item.readback as { status: string }).status, validAfter: (item.validator as { validAfter?: boolean }).validAfter })) }));
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
