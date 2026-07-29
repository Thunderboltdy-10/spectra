import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  columnName,
  coordinateToAddress,
  parseAddress,
  type SheetCell,
  type SheetsContent,
  type WorkbookSheet,
} from "./model";

const MAX_ROWS = 100_000;
const MAX_COLUMNS = 16_384;
const MAX_CELLS = 1_000_000;

function xml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function elementChildren(node: Element, localName: string) {
  return Array.from(node.children).filter(
    (child) => child.localName === localName,
  );
}

function repeated(element: Element, attribute: string) {
  const value = Number(element.getAttribute(attribute) ?? 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function odfFormula(value: string) {
  return value
    .replace(/^of:=/i, "=")
    .replace(/\[\.([A-Z]+\d+):\.([A-Z]+\d+)\]/gi, "$1:$2")
    .replace(/\[\.([A-Z]+\d+)\]/gi, "$1")
    .replace(
      /\[(?:\$?'([^']+)'|\$?([^.'\]]+))\.\$?([A-Z]+)\$?(\d+)\]/gi,
      (_match, quoted, plain, column, row) =>
        `'${String(quoted ?? plain).replaceAll("'", "''")}'!${column}${row}`,
    )
    .replaceAll(";", ",");
}

function spectraFormula(value: string) {
  const source = value.replace(/^=/, "");
  const tokens: string[] = [];
  const withProtectedRanges = source.replace(
    /(^|[^A-Za-z0-9_])\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/g,
    (_match, prefix, startColumn, startRow, endColumn, endRow) => {
      const token = `__SPECTRA_ODS_RANGE_${tokens.length}__`;
      tokens.push(`[.${startColumn}${startRow}:.${endColumn}${endRow}]`);
      return `${prefix}${token}`;
    },
  );
  const withCells = withProtectedRanges.replace(
    /(^|[^A-Za-z0-9_.'])\$?([A-Z]+)\$?(\d+)/g,
    (_match, prefix, column, row) => `${prefix}[.${column}${row}]`,
  );
  return `of:=${tokens.reduce(
    (formula, token, index) =>
      formula.replace(`__SPECTRA_ODS_RANGE_${index}__`, token),
    withCells,
  )}`;
}

function cellText(cell: Element) {
  return Array.from(cell.getElementsByTagName("text:p"))
    .map((paragraph) => paragraph.textContent ?? "")
    .join("\n");
}

function parseCell(cell: Element): SheetCell {
  const formula = cell.getAttribute("table:formula");
  const kind = cell.getAttribute("office:value-type");
  const text = cellText(cell);
  let value: SheetCell["value"];
  if (kind === "float" || kind === "currency" || kind === "percentage") {
    const numeric = Number(cell.getAttribute("office:value"));
    value = Number.isFinite(numeric) ? numeric : text;
  } else if (kind === "boolean")
    value = cell.getAttribute("office:boolean-value") === "true";
  else if (kind === "date") {
    const parsed = Date.parse(cell.getAttribute("office:date-value") ?? "");
    value = Number.isFinite(parsed) ? parsed : text;
  } else value = text;
  return {
    ...(formula ? { formula: odfFormula(formula) } : {}),
    ...(value !== "" || !formula ? { value } : {}),
    ...(kind === "percentage"
      ? { format: { numberFormat: "percent" as const } }
      : kind === "currency"
        ? { format: { numberFormat: "currency" as const } }
        : kind === "date"
          ? { format: { numberFormat: "date" as const } }
          : {}),
  };
}

export function importOds(
  buffer: ArrayBuffer,
  current: SheetsContent,
): { next: SheetsContent; unsupported: string[] } {
  const archive = unzipSync(new Uint8Array(buffer));
  const contentFile = archive["content.xml"];
  if (!contentFile)
    throw new Error("ODS_CONTENT_MISSING: content.xml is absent.");
  const document = new DOMParser().parseFromString(
    strFromU8(contentFile),
    "application/xml",
  );
  if (document.getElementsByTagName("parsererror").length)
    throw new Error("ODS_XML_INVALID: content.xml could not be parsed.");
  const tables = Array.from(document.getElementsByTagName("table:table"));
  if (!tables.length)
    throw new Error("ODS_SHEET_MISSING: No worksheet was found.");
  let cellCount = 0;
  let formulaCount = 0;
  let mergedCount = 0;
  const sheets: WorkbookSheet[] = tables
    .slice(0, 256)
    .map((table, tableIndex) => {
      const cells: Record<string, SheetCell> = {};
      const mergedRanges: string[] = [];
      let rowIndex = 0;
      for (const row of elementChildren(table, "table-row")) {
        const rowRepeat = Math.min(
          repeated(row, "table:number-rows-repeated"),
          MAX_ROWS - rowIndex,
        );
        for (let repeatedRow = 0; repeatedRow < rowRepeat; repeatedRow += 1) {
          let columnIndex = 0;
          for (const sourceCell of Array.from(row.children).filter((child) =>
            ["table-cell", "covered-table-cell"].includes(child.localName),
          )) {
            const columnRepeat = Math.min(
              repeated(sourceCell, "table:number-columns-repeated"),
              MAX_COLUMNS - columnIndex,
            );
            const parsed = parseCell(sourceCell);
            const meaningful = Boolean(
              parsed.formula || parsed.value !== "" || parsed.format,
            );
            for (
              let repeatedColumn = 0;
              repeatedColumn < columnRepeat;
              repeatedColumn += 1
            ) {
              if (meaningful && cellCount < MAX_CELLS) {
                const address = coordinateToAddress({
                  row: rowIndex,
                  column: columnIndex + repeatedColumn,
                });
                cells[address] = {
                  ...parsed,
                  provenance: { source: "ODS import", importedAt: Date.now() },
                };
                cellCount += 1;
                if (parsed.formula) formulaCount += 1;
              }
            }
            const columnSpan = repeated(
              sourceCell,
              "table:number-columns-spanned",
            );
            const rowSpan = repeated(sourceCell, "table:number-rows-spanned");
            if (
              (columnSpan > 1 || rowSpan > 1) &&
              mergedRanges.length < 10_000
            ) {
              const start = coordinateToAddress({
                row: rowIndex,
                column: columnIndex,
              });
              const end = coordinateToAddress({
                row: Math.min(MAX_ROWS - 1, rowIndex + rowSpan - 1),
                column: Math.min(MAX_COLUMNS - 1, columnIndex + columnSpan - 1),
              });
              mergedRanges.push(`${start}:${end}`);
              mergedCount += 1;
            }
            columnIndex += columnRepeat;
            if (columnIndex >= MAX_COLUMNS) break;
          }
          rowIndex += 1;
          if (rowIndex >= MAX_ROWS || cellCount >= MAX_CELLS) break;
        }
        if (rowIndex >= MAX_ROWS || cellCount >= MAX_CELLS) break;
      }
      const extent = Object.keys(cells).reduce(
        (current, address) => {
          const coordinate = parseAddress(address);
          return coordinate
            ? {
                row: Math.max(current.row, coordinate.row),
                column: Math.max(current.column, coordinate.column),
              }
            : current;
        },
        { row: -1, column: -1 },
      );
      return {
        id: `sheet-${crypto.randomUUID()}`,
        name: table.getAttribute("table:name") || `Sheet ${tableIndex + 1}`,
        cells,
        tables: [],
        charts: [],
        rowCount: Math.min(MAX_ROWS, Math.max(100, extent.row + 21, rowIndex)),
        columnCount: Math.min(MAX_COLUMNS, Math.max(26, extent.column + 6)),
        hiddenRows: [],
        hiddenColumns: [],
        columnWidths: {},
        rowHeights: {},
        mergedRanges,
        conditionalFormats: [],
        rowIdentities: {},
        columnIdentities: {},
      };
    });
  const next: SheetsContent = {
    ...current,
    sheets,
    activeSheetId: sheets[0]!.id,
  };
  const unsupported = [
    "ODS charts, pivot tables, drawing objects, scripts, and external data links are not imported",
    "Complex OpenFormula expressions may require review after conversion to Spectra formulas",
    "Advanced ODS styles and conditional formats are retained only in the immutable original",
    ...(cellCount >= MAX_CELLS
      ? [
          `Import stopped at the ${MAX_CELLS.toLocaleString()}-cell safety ceiling`,
        ]
      : []),
  ];
  return {
    next,
    unsupported: [
      ...unsupported,
      `${formulaCount} formulas and ${mergedCount} merged ranges were converted`,
    ],
  };
}

function usedBounds(sheet: WorkbookSheet) {
  let rows = 1;
  let columns = 1;
  for (const address of Object.keys(sheet.cells)) {
    const coordinate = parseAddress(address);
    if (!coordinate) continue;
    rows = Math.max(rows, coordinate.row + 1);
    columns = Math.max(columns, coordinate.column + 1);
  }
  return {
    rows: Math.min(rows, MAX_ROWS),
    columns: Math.min(columns, MAX_COLUMNS),
  };
}

function cellXml(cell: SheetCell | undefined) {
  if (!cell) return "<table:table-cell/>";
  const formula = cell.formula
    ? ` table:formula="${xml(spectraFormula(cell.formula))}"`
    : "";
  const value = cell.value;
  if (typeof value === "number") {
    const type =
      cell.format?.numberFormat === "percent"
        ? "percentage"
        : cell.format?.numberFormat === "currency"
          ? "currency"
          : "float";
    return `<table:table-cell office:value-type="${type}" office:value="${value}"${formula}><text:p>${xml(value)}</text:p></table:table-cell>`;
  }
  if (typeof value === "boolean")
    return `<table:table-cell office:value-type="boolean" office:boolean-value="${value}"${formula}><text:p>${value ? "TRUE" : "FALSE"}</text:p></table:table-cell>`;
  const text = value === null || value === undefined ? "" : String(value);
  return `<table:table-cell office:value-type="string"${formula}><text:p>${xml(text)}</text:p></table:table-cell>`;
}

export function exportOds(content: SheetsContent) {
  const tables = content.sheets
    .map((sheet) => {
      const bounds = usedBounds(sheet);
      const rows = Array.from({ length: bounds.rows }, (_, row) => {
        const cells = Array.from({ length: bounds.columns }, (_, column) =>
          cellXml(sheet.cells[`${columnName(column)}${row + 1}`]),
        ).join("");
        return `<table:table-row>${cells}</table:table-row>`;
      }).join("");
      return `<table:table table:name="${xml(sheet.name)}">${rows}</table:table>`;
    })
    .join("");
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  const emptyDocument = (kind: "styles" | "meta") =>
    `<?xml version="1.0" encoding="UTF-8"?><office:document-${kind} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"/>`;
  return zipSync({
    mimetype: [
      strToU8("application/vnd.oasis.opendocument.spreadsheet"),
      { level: 0 },
    ],
    "content.xml": strToU8(contentXml),
    "styles.xml": strToU8(emptyDocument("styles")),
    "meta.xml": strToU8(emptyDocument("meta")),
    "META-INF": { "manifest.xml": strToU8(manifest) },
  });
}
