import type { PresentationContent } from "../presentation/model";
import type { SheetsContent } from "../sheets/model";
import type { PptxProjection } from "./pptx-lens";
import type { XlsxProjection } from "./xlsx-lens";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedNumberFormat(value: unknown) {
  const native = record(value);
  const code =
    typeof value === "string"
      ? value
      : typeof native.code === "string"
        ? native.code
        : "General";
  if (/[%]/.test(code)) return "percent" as const;
  if (/[$€£¥]|\[\$/.test(code)) return "currency" as const;
  if (/[dmyhs]/i.test(code.replace(/\[[^\]]*]/g, ""))) return "date" as const;
  if (code.toLowerCase() === "general") return "general" as const;
  return "number" as const;
}

function decimalPlaces(value: unknown) {
  const native = record(value);
  const code =
    typeof value === "string"
      ? value
      : typeof native.code === "string"
        ? native.code
        : "";
  const match = code.match(/\.(0+|#+)/);
  return match ? Math.min(match[1]!.length, 12) : undefined;
}

/**
 * The Office reader returns a rich native style object. The Sheets editor has
 * a deliberately smaller semantic style contract, so only equivalent fields
 * cross this boundary. The complete native style remains in preserved carry
 * and is reused by materialization; copying it into the Sheets model would
 * make the collaborative Yjs document fail its own schema validation.
 */
function normalizedCellFormat(format: Record<string, unknown> | undefined) {
  if (!format) return undefined;
  const font = record(format.font);
  const alignment = record(format.alignment);
  const horizontal = alignment.horizontal;
  const decimals = decimalPlaces(format.numberFormat);
  const underline = font.underline;
  return {
    ...(typeof font.bold === "boolean" ? { bold: font.bold } : {}),
    ...(typeof font.italic === "boolean" ? { italic: font.italic } : {}),
    ...(underline !== undefined
      ? { underline: underline !== false && underline !== "none" }
      : {}),
    ...(horizontal === "left" || horizontal === "center" || horizontal === "right"
      ? { align: horizontal as "left" | "center" | "right" }
      : {}),
    numberFormat: normalizedNumberFormat(format.numberFormat),
    ...(decimals !== undefined ? { decimals } : {}),
    ...(typeof font.size === "number" && font.size >= 6 && font.size <= 72
      ? { fontSize: font.size }
      : {}),
  };
}

export function xlsxArtifactContent(projection: XlsxProjection): SheetsContent {
  return {
    workbook: {
      calculationMode: "automatic",
      locale: "en-US",
      namedRanges: Object.fromEntries(
        projection.definedNames.map((item) => [item.name, item.ref]),
      ),
      calculationVersion: 1,
    },
    sheets: projection.sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      cells: Object.fromEntries(
        sheet.cells.map((cell) => {
          const value =
            cell.value instanceof Date ? cell.value.toISOString() : cell.value;
          return [
            cell.ref,
            {
              ...(value !== undefined ? { value } : {}),
              ...(cell.formula
                ? {
                    formula: `=${cell.formula}`,
                    nativeFormulaSupport: cell.formulaSupport,
                  }
                : {}),
              ...(cell.style
                ? { format: normalizedCellFormat(cell.style) }
                : {}),
            },
          ];
        }),
      ),
      tables: [],
      charts: [],
      mergedRanges: [...sheet.merges],
    })),
    activeSheetId: projection.sheets[0]?.id ?? "",
    nativeBinding: projection.nativeBinding,
  };
}

export function pptxArtifactContent(
  projection: PptxProjection,
): PresentationContent {
  return {
    theme: { id: "native-pptx", name: "PowerPoint theme" },
    slides: projection.slides.map((slide) => ({
      id: slide.id,
      title: slide.title,
      ...(slide.layoutPartName ? { layoutId: slide.layoutPartName } : {}),
      objects: slide.text.map((text, index) => ({
        id: `${slide.id}:text:${index}`,
        type: "text" as const,
        x: 8,
        y: index ? 24 + index * 12 : 6,
        width: 84,
        height: 10,
        rotation: 0,
        content: { text },
        locked: index === 0,
      })),
      ...(slide.hasTransition || slide.hasTiming
        ? {
            nativeCompatibility: {
              ...(slide.hasTransition
                ? { transition: "preserved" as const }
                : {}),
              ...(slide.hasTiming ? { animations: "preserved" as const } : {}),
            },
          }
        : {}),
    })),
    nativeBinding: projection.nativeBinding,
  };
}
