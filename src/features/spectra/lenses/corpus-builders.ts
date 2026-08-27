import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Workbook } from "@ariadng/office/xlsx";

const docxRoot = (...names: string[]) =>
  join(process.cwd(), "fixtures", "office", "docx", ...names);
const xlsxRoot = (...names: string[]) =>
  join(process.cwd(), "fixtures", "office", "xlsx", ...names);

async function readBytes(path: string) {
  return new Uint8Array(await readFile(path));
}

function zip(files: Record<string, Uint8Array>) {
  return zipSync(files, { level: 6 });
}

function rewritePart(
  files: Record<string, Uint8Array>,
  suffix: string,
  rewrite: (xml: string) => string,
) {
  const name = Object.keys(files).find((candidate) =>
    candidate.replace(/\\/g, "/").endsWith(suffix),
  );
  if (!name) throw new Error(`Missing part ${suffix}`);
  files[name] = strToU8(rewrite(strFromU8(files[name]!)));
  return files;
}

const SIMPLE_TABLE =
  "<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w=\"1440\"/><w:gridCol w:w=\"1440\"/></w:tblGrid>" +
  "<w:tr><w:tc><w:p><w:r><w:t>Inner A</w:t></w:r></w:p></w:tc>" +
  "<w:tc><w:p><w:r><w:t>Inner B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";

const FOOTER_TABLE =
  "<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w=\"2400\"/><w:gridCol w:w=\"2400\"/></w:tblGrid>" +
  "<w:tr><w:tc><w:p><w:r><w:t>Footer left</w:t></w:r></w:p></w:tc>" +
  "<w:tc><w:p><w:r><w:t>Footer right</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";

function firstTableRange(xml: string) {
  const start = xml.search(/<w:tbl[\s>]/);
  if (start < 0) throw new Error("Fixture has no table to rewrite.");
  const end = xml.indexOf("</w:tbl>", start);
  if (end < 0) throw new Error("Fixture table is not closed.");
  return { start, end: end + "</w:tbl>".length };
}

/** Whole-table content control plus a second table, the DOC-5 pairing case. */
export async function sdtWrappedTablesFixture() {
  const files = unzipSync(await readBytes(docxRoot("complex-structure.docx")));
  rewritePart(files, "word/document.xml", (xml) => {
    const range = firstTableRange(xml);
    const table = xml.slice(range.start, range.end);
    return (
      xml.slice(0, range.start) +
      `<w:sdt><w:sdtPr/><w:sdtContent>${table}</w:sdtContent></w:sdt>` +
      table +
      xml.slice(range.end)
    );
  });
  return zip(files);
}

/** Nested table plus a gridSpan merge, the claims complex-structure used to lie about. */
export async function mergedNestedTablesFixture() {
  const files = unzipSync(await readBytes(docxRoot("complex-structure.docx")));
  rewritePart(files, "word/document.xml", (xml) => {
    const range = firstTableRange(xml);
    let table = xml.slice(range.start, range.end);
    table = table.replace(
      /<w:tcPr>/,
      '<w:tcPr><w:gridSpan w:val="2"/>',
    );
    const cellClose = table.indexOf("</w:tc>");
    table = `${table.slice(0, cellClose)}${SIMPLE_TABLE}${table.slice(cellClose)}`;
    return xml.slice(0, range.start) + table + xml.slice(range.end);
  });
  return zip(files);
}

/** A real table living in a footer part. */
export async function footerTableFixture() {
  const files = unzipSync(await readBytes(docxRoot("complex-structure.docx")));
  rewritePart(files, "word/footer1.xml", (xml) =>
    xml.replace(/<w:p[\s>]/, `${FOOTER_TABLE}$&`),
  );
  return zip(files);
}

/** German-style number formats on a real workbook, not an English default. */
export async function localeWorkbookFixture() {
  const workbook = Workbook.create();
  const sheet = workbook.sheet("Sheet1")!;
  sheet.setCell("A1", 1234.5);
  sheet.setCell("B1", 0.15);
  const files = unzipSync(await workbook.save());
  const styleName = Object.keys(files).find((name) =>
    name.replace(/\\/g, "/").endsWith("xl/styles.xml"),
  );
  if (!styleName) throw new Error("Generated workbook has no stylesheet.");
  let styles = strFromU8(files[styleName]!);
  if (!styles.includes("[$-407]")) {
    if (styles.includes("<numFmts")) {
      styles = styles.replace(
        /<numFmts([^>]*)>/,
        '<numFmts$1><numFmt numFmtId="176" formatCode="[$-407]#.##0,00"/>',
      );
    } else {
      styles = styles.replace(
        /<styleSheet([^>]*)>/,
        '<styleSheet$1><numFmts count="1"><numFmt numFmtId="176" formatCode="[$-407]#.##0,00"/></numFmts>',
      );
    }
    files[styleName] = strToU8(styles);
  }
  return zip(files);
}

/** An external workbook link part. The lens may refuse it; the bytes must still exist. */
export async function externalLinkWorkbookFixture() {
  const source = unzipSync(await readBytes(xlsxRoot("comments-preservation.xlsx")));
  source["xl/externalLinks/externalLink1.xml"] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1">' +
      "<sheetNames><sheetName val=\"Data\"/></sheetNames></externalBook></externalLink>",
  );
  const relsName = Object.keys(source).find((name) =>
    name.replace(/\\/g, "/").endsWith("xl/_rels/workbook.xml.rels"),
  );
  if (relsName) {
    const rels = strFromU8(source[relsName]!);
    source[relsName] = strToU8(
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdExt1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>',
      ),
    );
  }
  return zip(source);
}

export async function loadDocxFixture(name: string) {
  return readBytes(docxRoot(name));
}

export async function loadXlsxFixture(name: string) {
  return readBytes(xlsxRoot(name));
}

export async function loadPptxFixture(name: string) {
  return readBytes(join(process.cwd(), "fixtures", "office", "pptx", name));
}
