import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".spectra-local",
  "p8v1-f2-fixtures",
);

async function writeFortyPageDoc() {
  const children = [];
  for (let page = 1; page <= 40; page += 1) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(`P8.V1 F2 page ${page}`)],
      }),
    );
    for (let paragraph = 1; paragraph <= 12; paragraph += 1) {
      children.push(
        new Paragraph({
          children: [
            new TextRun(
              `Page ${page} paragraph ${paragraph}. This fixture exists so first useful paint and keystroke cost can be measured at document density, not on a short CARD9 draft.`,
            ),
          ],
        }),
      );
    }
    children.push(new Paragraph({ children: [new TextRun({ text: "", break: 1 })] }));
  }
  const document = new Document({
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(document);
  const path = resolve(root, "P8V1-F2-40-page.docx");
  await writeFile(path, buffer);
  return { path, bytes: buffer.byteLength, pages: 40 };
}

async function writeTwoHundredKWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Density");
  const rows = 10_000;
  const columns = 20;
  for (let column = 1; column <= columns; column += 1) {
    sheet.getColumn(column).width = 12;
  }
  for (let row = 1; row <= rows; row += 1) {
    const values = [];
    for (let column = 1; column <= columns; column += 1) {
      values.push(column === 1 ? row : row * column);
    }
    sheet.getRow(row).values = values;
  }
  const path = resolve(root, "P8V1-F2-200k-cell.xlsx");
  await workbook.xlsx.writeFile(path);
  return { path, cells: rows * columns, rows, columns };
}

async function writeOneHundredTwentySlides() {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  for (let slideNumber = 1; slideNumber <= 120; slideNumber += 1) {
    const slide = pptx.addSlide();
    slide.addText(`P8.V1 F2 slide ${slideNumber}`, {
      x: 0.6,
      y: 2.8,
      w: 12,
      h: 1.2,
      fontSize: 32,
      bold: true,
    });
    slide.addText(
      "Density fixture for first useful paint, drag, and keystroke measurement.",
      { x: 0.6, y: 4.1, w: 12, h: 0.6, fontSize: 16 },
    );
  }
  const path = resolve(root, "P8V1-F2-120-slide.pptx");
  await pptx.writeFile({ fileName: path });
  return { path, slides: 120 };
}

async function writeTenKLibraryFolder() {
  const folder = resolve(root, "library-10k");
  await mkdir(folder, { recursive: true });
  const batch = [];
  for (let index = 1; index <= 10_000; index += 1) {
    const name = `node-${String(index).padStart(5, "0")}.txt`;
    batch.push(
      writeFile(resolve(folder, name), `P8.V1 F2 library node ${index}\n`),
    );
    if (batch.length === 250) {
      await Promise.all(batch);
      batch.length = 0;
    }
  }
  if (batch.length) await Promise.all(batch);
  return { folder, nodes: 10_000 };
}

await mkdir(root, { recursive: true });
const started = Date.now();
const [document, workbook, deck, library] = await Promise.all([
  writeFortyPageDoc(),
  writeTwoHundredKWorkbook(),
  writeOneHundredTwentySlides(),
  writeTenKLibraryFolder(),
]);
process.stdout.write(
  `${JSON.stringify({ root, elapsedMs: Date.now() - started, document, workbook, deck, library }, null, 2)}\n`,
);
