import type { PresentationContent } from "../presentation/model";
import { type SheetCellFormat, type SheetsContent } from "../sheets/model";
import {
  decodeSheetsContentFromStorage,
  encodeArtifactContentForStorage,
} from "../../../../shared/sheet-cells";
import { dateToSerial } from "../sheets/excel-serial";
import { z } from "zod";
import {
  pptxProjectionSchema,
  xlsxProjectionSchema,
  type PptxOperation,
  type PptxProjection,
  type XlsxOperation,
  type XlsxProjection,
} from "./projection-contracts";
import { xlsxFormulaSupport } from "./xlsx-formula-support";

function codedOfficeContentError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

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
function normalizedColor(value: unknown) {
  if (typeof value !== "string") return undefined;
  const hex = value.replace(/^#/, "");
  return `#${hex.length === 8 ? hex.slice(2) : hex}`;
}

function normalizedFontFamily(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (/consolas|courier|mono/i.test(value)) return "mono" as const;
  if (/cambria|times|georgia|serif/i.test(value)) return "serif" as const;
  return "sans" as const;
}

export function normalizedCellFormat(
  format: Record<string, unknown> | undefined,
): SheetCellFormat | undefined {
  if (!format) return undefined;
  const font = record(format.font);
  const alignment = record(format.alignment);
  const fill = record(format.fill);
  const nativeBorders = record(format.border);
  const horizontal = alignment.horizontal;
  const vertical = alignment.vertical;
  const decimals = decimalPlaces(format.numberFormat);
  const underline = font.underline;
  const numberFormatRecord = record(format.numberFormat);
  const nativeCode =
    typeof numberFormatRecord.code === "string"
      ? numberFormatRecord.code
      : undefined;
  const borders = Object.fromEntries(
    (["top", "right", "bottom", "left"] as const).flatMap((edge) => {
      const native = record(nativeBorders[edge]);
      if (typeof native.style !== "string") return [];
      return [
        [
          edge,
          {
            style: native.style,
            ...(normalizedColor(native.color)
              ? { color: normalizedColor(native.color) }
              : {}),
          },
        ],
      ];
    }),
  );
  const rotation =
    typeof alignment.textRotation === "number"
      ? alignment.textRotation > 90
        ? 90 - alignment.textRotation
        : alignment.textRotation
      : undefined;
  return {
    ...(typeof font.bold === "boolean" ? { bold: font.bold } : {}),
    ...(typeof font.italic === "boolean" ? { italic: font.italic } : {}),
    ...(underline !== undefined
      ? { underline: underline !== false && underline !== "none" }
      : {}),
    ...(typeof font.strike === "boolean" ? { strike: font.strike } : {}),
    ...(normalizedFontFamily(font.name)
      ? { fontFamily: normalizedFontFamily(font.name) }
      : {}),
    ...(normalizedColor(font.color)
      ? { textColor: normalizedColor(font.color) }
      : {}),
    ...(fill.pattern === "solid" && normalizedColor(fill.color)
      ? { fillColor: normalizedColor(fill.color) }
      : {}),
    ...(horizontal === "left" ||
    horizontal === "center" ||
    horizontal === "right" ||
    horizontal === "justify"
      ? { align: horizontal as "left" | "center" | "right" | "justify" }
      : {}),
    ...(vertical === "top" || vertical === "bottom"
      ? { verticalAlign: vertical }
      : vertical === "center"
        ? { verticalAlign: "middle" as const }
        : {}),
    ...(typeof alignment.wrapText === "boolean"
      ? { wrap: alignment.wrapText }
      : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(typeof alignment.indent === "number"
      ? { indent: alignment.indent }
      : {}),
    numberFormat: normalizedNumberFormat(format.numberFormat),
    ...(nativeCode && nativeCode !== "General"
      ? { customFormat: nativeCode }
      : {}),
    ...(decimals !== undefined ? { decimals } : {}),
    ...(typeof font.size === "number" && font.size >= 6 && font.size <= 72
      ? { fontSize: font.size }
      : {}),
    ...(Object.keys(borders).length ? { borders } : {}),
  };
}

function canonicalColor(value: unknown) {
  if (typeof value !== "string") return null;
  const hex = value.replace(/^#/, "").toUpperCase();
  if (hex.length === 8) return `#${hex.slice(2)}`;
  if (hex.length === 6) return `#${hex}`;
  return value;
}

/**
 * The Sheets editor stores every default (false bold, 11pt, bottom align).
 * The native projection omits those defaults. Stringifying the two objects
 * makes every visible cell look like a format write, then the Bridge
 * region-id cap refuses a one-cell edit on a real workbook.
 */
function canonicalSheetFormat(value: unknown) {
  const format = record(value);
  const align =
    format.align === "left" ||
    format.align === "center" ||
    format.align === "right" ||
    format.align === "justify"
      ? format.align
      : "general";
  const verticalAlign =
    format.verticalAlign === "top" ||
    format.verticalAlign === "middle" ||
    format.verticalAlign === "bottom"
      ? format.verticalAlign
      : "bottom";
  return {
    bold: format.bold === true,
    italic: format.italic === true,
    underline: format.underline === true,
    strike: format.strike === true,
    wrap: format.wrap === true,
    rotation: typeof format.rotation === "number" ? format.rotation : 0,
    indent: typeof format.indent === "number" ? format.indent : 0,
    fontSize: typeof format.fontSize === "number" ? format.fontSize : 11,
    fontFamily: typeof format.fontFamily === "string" ? format.fontFamily : "sans",
    numberFormat:
      typeof format.numberFormat === "string" ? format.numberFormat : "general",
    align,
    verticalAlign,
    textColor: canonicalColor(format.textColor),
    fillColor: canonicalColor(format.fillColor),
    customFormat:
      typeof format.customFormat === "string" ? format.customFormat : null,
    currency: typeof format.currency === "string" ? format.currency : null,
    decimals: typeof format.decimals === "number" ? format.decimals : null,
    thousands: format.thousands !== false,
    borders: format.borders ?? null,
  };
}

export function sheetFormatsEquivalent(left: unknown, right: unknown) {
  return (
    JSON.stringify(canonicalSheetFormat(left)) ===
    JSON.stringify(canonicalSheetFormat(right))
  );
}

export function xlsxArtifactContent(projection: XlsxProjection): SheetsContent {
  const date1904 = projection.nativeBinding.date1904 === true;
  return {
    workbook: {
      calculationMode: "automatic",
      locale: "en-US",
      namedRanges: Object.fromEntries(
        projection.definedNames.map((item) => [item.name, item.ref]),
      ),
      calculationVersion: 1,
      ...(date1904 ? { date1904: true } : {}),
    },
    sheets: projection.sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      cells: Object.fromEntries(
        sheet.cells.map((cell) => {
          const value =
            cell.value instanceof Date
              ? dateToSerial(cell.value, date1904)
              : cell.value;
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
              ...((cell.format ??
              (cell.style ? normalizedCellFormat(cell.style) : undefined))
                ? { format: cell.format ?? normalizedCellFormat(cell.style) }
                : {}),
            },
          ];
        }),
      ),
      tables: [],
      charts: [],
      mergedRanges: [...sheet.merges],
      frozenRows: sheet.frozenRows,
      frozenColumns: sheet.frozenColumns,
    })),
    activeSheetId: projection.sheets[0]?.id ?? "",
    nativeBinding: projection.nativeBinding,
  };
}

/** Convex documents and mutation arguments cap near 1 MiB. A 200k-cell
 * workbook's full projection cannot live on `spectraArtifacts.content`; the
 * native payload in storage is the durable source, and open returns the live
 * projection to the editor over HTTP. */
export const CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES = 700_000;

function jsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function stripSheetCellsForActivation(content: unknown) {
  const source = record(content);
  const workbook = record(source.workbook);
  const sheets = Array.isArray(source.sheets) ? source.sheets : [];
  const namedRanges = Object.fromEntries(
    Object.entries(record(workbook.namedRanges)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    ...source,
    workbook: {
      calculationMode:
        workbook.calculationMode === "manual" ? "manual" : "automatic",
      locale: typeof workbook.locale === "string" ? workbook.locale : "en-US",
      namedRanges,
      calculationVersion:
        typeof workbook.calculationVersion === "number"
          ? workbook.calculationVersion
          : 1,
      ...(workbook.date1904 === true ? { date1904: true } : {}),
    },
    sheets: sheets.map((sheet, index) => {
      const row = record(sheet);
      return {
        id: typeof row.id === "string" ? row.id : `sheet-${index + 1}`,
        name: typeof row.name === "string" ? row.name : `Sheet ${index + 1}`,
        cells: {},
        tables: Array.isArray(row.tables) ? row.tables : [],
        charts: Array.isArray(row.charts) ? row.charts : [],
        mergedRanges: Array.isArray(row.mergedRanges)
          ? row.mergedRanges.filter(
              (range): range is string => typeof range === "string",
            )
          : [],
        frozenRows:
          typeof row.frozenRows === "number" ? row.frozenRows : undefined,
        frozenColumns:
          typeof row.frozenColumns === "number" ? row.frozenColumns : undefined,
      };
    }),
    activeSheetId:
      typeof source.activeSheetId === "string"
        ? source.activeSheetId
        : typeof record(sheets[0]).id === "string"
          ? String(record(sheets[0]).id)
          : "",
    nativeBinding: source.nativeBinding,
  };
}

function stripPresentationObjectsForActivation(content: unknown) {
  const source = record(content);
  const slides = Array.isArray(source.slides) ? source.slides : [];
  return {
    ...source,
    slides: slides.map((slide, index) => {
      const row = record(slide);
      const objects = Array.isArray(row.objects) ? row.objects : [];
      const title =
        typeof row.title === "string" && row.title.trim()
          ? row.title
          : `Slide ${index + 1}`;
      return {
        ...row,
        title,
        objects: objects.slice(0, 1).map((object) => {
          const item = record(object);
          return {
            ...item,
            content:
              typeof item.content === "string"
                ? item.content.slice(0, 240)
                : item.content,
          };
        }),
        speakerNotes:
          typeof row.speakerNotes === "string"
            ? row.speakerNotes.slice(0, 240)
            : "",
      };
    }),
  };
}

/**
 * Activation writes identity and sheet/slide lists into Convex. Occupied cells
 * and dense slide objects stay in the native payload and the HTTP open
 * response so a 200k-cell book or 120-slide deck cannot blow the document cap.
 */
export function convexSafeFidelityMap(map: unknown) {
  if (jsonBytes(map) <= 80_000) return map;
  return {
    truncated: true,
    message:
      "Native features Spectra cannot edit remain in the original package.",
  };
}

export function convexSafeOfficeActivationContent(
  typeKey: "sheets" | "presentation",
  content: unknown,
): unknown {
  const encoded = encodeArtifactContentForStorage(typeKey, content);
  if (jsonBytes(encoded) <= CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES)
    return encoded;
  const compact =
    typeKey === "sheets"
      ? stripSheetCellsForActivation(content)
      : stripPresentationObjectsForActivation(content);
  const next = encodeArtifactContentForStorage(typeKey, compact);
  if (jsonBytes(next) <= CONVEX_ARTIFACT_CONTENT_BUDGET_BYTES) return next;
  return encodeArtifactContentForStorage(
    typeKey,
    typeKey === "sheets"
      ? {
          ...stripSheetCellsForActivation(content),
          workbook: {
            calculationMode: "automatic" as const,
            locale: "en-US",
            namedRanges: {},
            calculationVersion: 1,
          },
        }
      : {
          ...record(content),
          slides: [],
        },
  );
}

export function bindPptxProjectionSource(
  projection: PptxProjection,
  artifactId: string,
  payloadHash: string,
): PptxProjection {
  return pptxProjectionSchema.parse({
    ...projection,
    nativeBinding: {
      ...projection.nativeBinding,
      sourceArtifactId: artifactId,
      sourcePayloadHash: payloadHash,
    },
  });
}

export function pptxNativeMediaUrl(
  binding: unknown,
  partName: string,
) {
  const source = record(binding);
  const artifactId =
    typeof source.sourceArtifactId === "string" ? source.sourceArtifactId : "";
  const payloadHash =
    typeof source.sourcePayloadHash === "string"
      ? source.sourcePayloadHash
      : "";
  if (
    !artifactId ||
    !/^[a-f0-9]{64}$/.test(payloadHash) ||
    !/^\/ppt\/media\/[^/\\\u0000-\u001f]{1,400}$/u.test(partName)
  )
    return "";
  const query = new URLSearchParams({
    artifactId,
    payloadHash,
    partName,
  });
  return `/api/spectra/lenses/office/media?${query.toString()}`;
}

export function pptxArtifactContent(
  projection: PptxProjection,
): PresentationContent {
  return {
    theme: { id: "native-pptx", name: "PowerPoint theme" },
    settings: {
      aspectRatio:
        projection.nativeBinding.canvasWidthEmu &&
        projection.nativeBinding.canvasHeightEmu &&
        projection.nativeBinding.canvasWidthEmu /
          projection.nativeBinding.canvasHeightEmu <
          1.55
          ? "4:3"
          : "16:9",
      showSlideNumbers: true,
    },
    slides: projection.slides.map((slide) => {
      return {
        id: slide.id,
        title: slide.title,
        ...(slide.layoutPartName ? { layoutId: slide.layoutPartName } : {}),
        ...(slide.hidden ? { hidden: true } : {}),
        // The lens reads the file's notes pages, so the studio has to receive
        // them. Dropping them here made an opened deck look as though it had no
        // speaker notes at all, and then saving could only ever write them back
        // as empty.
        ...(slide.speakerNotes ? { speakerNotes: slide.speakerNotes } : {}),
        objects: slide.objects,
        ...(slide.hasTransition || slide.hasTiming
          ? {
              nativeCompatibility: {
                ...(slide.hasTransition
                  ? { transition: "preserved" as const }
                  : {}),
                ...(slide.hasTiming
                  ? { animations: "preserved" as const }
                  : {}),
              },
            }
          : {}),
      };
    }),
    nativeBinding: projection.nativeBinding,
  };
}

const xlsxEditorContentSchema = z
  .object({
    sheets: z.array(
      z
        .object({
          id: z.string(),
          cells: z.record(
            z.string(),
            z
              .object({
                value: z.unknown().optional(),
                formula: z.string().optional(),
                format: z.record(z.string(), z.unknown()).optional(),
              })
              .passthrough(),
          ),
          mergedRanges: z.array(z.string()).optional(),
          frozenRows: z.number().int().nonnegative().optional(),
          frozenColumns: z.number().int().nonnegative().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** The one Sheets editor-model -> XLSX projection transform. */
export function xlsxProjectionFromContent(
  content: unknown,
  base: XlsxProjection,
): XlsxProjection {
  if (content == null) return base;
  const raw = xlsxEditorContentSchema.parse(
    decodeSheetsContentFromStorage(content),
  );
  const byId = new Map(raw.sheets.map((sheet) => [sheet.id, sheet]));
  const projection = xlsxProjectionSchema.parse({
    ...base,
    sheets: base.sheets.map((sheet) => {
      const next = byId.get(sheet.id);
      if (!next) return sheet;
      const previousByRef = new Map(
        sheet.cells.map((cell) => [cell.ref, cell]),
      );
      const cells = Object.entries(next.cells).map(([rawRef, value]) => {
        const ref = rawRef.toUpperCase();
        const previous = previousByRef.get(ref);
        const nextValue =
          value.value === undefined ? (previous?.value ?? null) : value.value;
        const nextFormula =
          typeof value.formula === "string" && value.formula
            ? value.formula.replace(/^=/, "")
            : previous?.formula;
        if (
          previous?.formula &&
          !value.formula &&
          Object.prototype.hasOwnProperty.call(value, "value")
        )
          throw codedOfficeContentError(
            "XLSX_FORMULA_LITERALIZATION_BLOCKED",
            `Formula ${sheet.name}!${ref} cannot be replaced by a literal through a value edit. Edit its formula text instead.`,
          );
        return {
          ...(previous ?? {
            id: `xlsx:${sheet.id.replace(/^xlsx:sheet:/, "")}:${ref}`,
            ref,
            value: null,
          }),
          value: nextValue,
          ...(nextFormula
            ? {
                formula: nextFormula,
                formulaSupport: xlsxFormulaSupport(nextFormula),
              }
            : {}),
          ...("format" in value &&
          !sheetFormatsEquivalent(value.format, previous?.format)
            ? { format: value.format ?? {} }
            : {}),
        };
      });
      return {
        ...sheet,
        cells,
        merges: next.mergedRanges ?? sheet.merges,
        frozenRows: next.frozenRows ?? sheet.frozenRows,
        frozenColumns: next.frozenColumns ?? sheet.frozenColumns,
      };
    }),
  });
  return projection;
}

export function xlsxOperationsBetween(
  before: XlsxProjection,
  after: XlsxProjection,
): XlsxOperation[] {
  const beforeSheets = new Map(before.sheets.map((sheet) => [sheet.id, sheet]));
  const operations: XlsxOperation[] = [];
  for (const sheet of after.sheets) {
    const previous = beforeSheets.get(sheet.id);
    if (!previous)
      throw new Error(
        "Adding worksheets to a mounted Excel file is not available in strict native mode yet.",
      );
    const oldCells = new Map(previous.cells.map((cell) => [cell.ref, cell]));
    for (const cell of sheet.cells) {
      const old = oldCells.get(cell.ref);
      oldCells.delete(cell.ref);
      if (!old) {
        operations.push(
          cell.formula
            ? {
                kind: "set-formula",
                sheetId: sheet.id,
                ref: cell.ref,
                formula: cell.formula,
              }
            : {
                kind: "set-cell",
                sheetId: sheet.id,
                ref: cell.ref,
                value: cell.value,
              },
        );
        if (cell.format)
          operations.push({
            kind: "set-cell-format",
            sheetId: sheet.id,
            ref: cell.ref,
            format: { ...cell.format, __full: cell.format },
          });
        continue;
      }
      if (cell.formula !== old.formula) {
          if (!cell.formula)
            throw codedOfficeContentError(
              "XLSX_FORMULA_LITERALIZATION_BLOCKED",
              `Formula ${sheet.name}!${cell.ref} cannot be silently rewritten as a literal.`,
            );
        operations.push({
          kind: "set-formula",
          sheetId: sheet.id,
          ref: cell.ref,
          formula: cell.formula,
        });
      } else if (
        !cell.formula &&
        JSON.stringify(cell.value) !== JSON.stringify(old.value)
      ) {
        operations.push({
          kind: "set-cell",
          sheetId: sheet.id,
          ref: cell.ref,
          value: cell.value,
        });
      }
      if (!sheetFormatsEquivalent(cell.format, old.format)) {
        const oldFormat = old.format ?? {};
        const nextFormat = cell.format ?? {};
        const patch = Object.fromEntries(
          [...new Set([...Object.keys(oldFormat), ...Object.keys(nextFormat)])]
            .map((key) => [
              key,
              JSON.stringify(oldFormat[key]) === JSON.stringify(nextFormat[key])
                ? undefined
                : (nextFormat[key] ?? null),
            ])
            .filter((entry) => entry[1] !== undefined),
        );
        operations.push({
          kind: "set-cell-format",
          sheetId: sheet.id,
          ref: cell.ref,
          format: Object.keys(nextFormat).length
            ? { ...patch, __full: nextFormat }
            : {},
        });
      }
    }
    for (const ref of oldCells.keys())
      operations.push({ kind: "clear-cell", sheetId: sheet.id, ref });
    const oldMerges = new Set(previous.merges);
    const newMerges = new Set(sheet.merges);
    for (const range of oldMerges) {
      if (!newMerges.has(range))
        operations.push({ kind: "unmerge-cells", sheetId: sheet.id, range });
    }
    for (const range of newMerges) {
      if (!oldMerges.has(range))
        operations.push({ kind: "merge-cells", sheetId: sheet.id, range });
    }
    const previousFrozenRows = previous.frozenRows ?? 0;
    const previousFrozenColumns = previous.frozenColumns ?? 0;
    const nextFrozenRows = sheet.frozenRows ?? 0;
    const nextFrozenColumns = sheet.frozenColumns ?? 0;
    if (
      nextFrozenRows !== previousFrozenRows ||
      nextFrozenColumns !== previousFrozenColumns
    )
      operations.push({
        kind: "set-freeze-panes",
        sheetId: sheet.id,
        rows: nextFrozenRows,
        columns: nextFrozenColumns,
      });
  }
  return operations;
}

export function xlsxProjectionUpdateFromContent(
  content: unknown,
  base: XlsxProjection,
) {
  const projection = xlsxProjectionFromContent(content, base);
  return { projection, operations: xlsxOperationsBetween(base, projection) };
}

const pptxEditorContentSchema = z
  .object({
    slides: z.array(
      z
        .object({
          id: z.string(),
          title: z.string().optional(),
          speakerNotes: z.string().optional(),
          hidden: z.boolean().optional(),
          objects: z
            .array(
              z
                .object({
                  id: z.string().optional(),
                  type: z.string(),
                  content: z.unknown().optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function editorObject(value: Record<string, unknown>, fallbackId: string) {
  return {
    id: typeof value.id === "string" && value.id ? value.id : fallbackId,
    type: value.type as PptxProjection["slides"][number]["objects"][number]["type"],
    x: typeof value.x === "number" ? value.x : 80,
    y: typeof value.y === "number" ? value.y : 300,
    width: typeof value.width === "number" ? value.width : 600,
    height: typeof value.height === "number" ? value.height : 80,
    rotation: typeof value.rotation === "number" ? value.rotation : 0,
    content: value.content ?? { text: "" },
    ...value,
  };
}

/** The one Presentation editor-model -> PPTX projection transform. */
export function pptxProjectionFromContent(
  content: unknown,
  base: PptxProjection,
): PptxProjection {
  if (content == null) return base;
  const raw = pptxEditorContentSchema.parse(content);
  const baseById = new Map(base.slides.map((slide) => [slide.id, slide]));
  if (!raw.slides.length) return base;
  return pptxProjectionSchema.parse({
    ...base,
    slides: raw.slides.map((next, index) => {
      const slide = baseById.get(next.id);
      const incomingRawObjects = (next.objects ?? []).map(
        (object) => object as Record<string, unknown>,
      );
      const incomingObjects = (
        slide
          ? incomingRawObjects
          : incomingRawObjects.map((object, objectIndex) =>
              editorObject(object, `${next.id}:spectra:${objectIndex + 1}`),
            )
      ) as Array<PptxProjection["slides"][number]["objects"][number]>;
      const text = incomingObjects
        .filter((object) => object.type === "text")
        .map((object) => {
          const value = object.content as { text?: unknown } | string;
          return typeof value === "string"
            ? value
            : typeof value?.text === "string"
              ? value.text
              : "";
        });
      if (!slide)
        return {
          id: next.id,
          index,
          title: next.title ?? "",
          text,
          objects: incomingObjects,
          hasTransition: false,
          hasTiming: false,
          ...(next.hidden ? { hidden: true } : {}),
          speakerNotes: next.speakerNotes ?? "",
        };
      const incomingById = new Map(
        incomingObjects.map((object) => [object.id, object]),
      );
      const objects = slide.objects.map((object) => {
        const incoming = incomingById.get(object.id);
        incomingById.delete(object.id);
        return incoming
          ? {
              ...object,
              ...incoming,
              content: incoming.content ?? object.content,
            }
          : object;
      });
      objects.push(
        ...[...incomingById.values()].map((object, objectIndex) =>
          editorObject(object, `${next.id}:spectra:${objectIndex + 1}`),
        ),
      );
      return {
        ...slide,
        index,
        title: next.title ?? slide.title,
        hidden: next.hidden === true || undefined,
        speakerNotes: next.speakerNotes ?? slide.speakerNotes,
        text: text.length ? text : slide.text,
        objects,
      };
    }),
  });
}

export function pptxOperationsBetween(
  before: PptxProjection,
  after: PptxProjection,
): PptxOperation[] {
  const previous = new Map(before.slides.map((slide) => [slide.id, slide]));
  const operations: PptxOperation[] = [];
  const kept = new Set(after.slides.map((slide) => slide.id));
  for (const old of before.slides)
    if (!kept.has(old.id))
      operations.push({ kind: "remove-slide", slideId: old.id });
  const layoutForNewSlideAt = (index: number) => {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = previous.get(after.slides[cursor]!.id);
      if (candidate?.layoutPartName) return candidate.layoutPartName;
    }
    return before.slides.find((slide) => slide.layoutPartName)?.layoutPartName;
  };
  after.slides.forEach((slide, slideIndex) => {
    const old = previous.get(slide.id);
    if (!old) {
      const text = slide.objects
        .filter((object) => object.type === "text")
        .map((object) => {
          const value = object.content as { text?: unknown } | undefined;
          return typeof value?.text === "string" ? value.text : "";
        })
        .filter((line) => line.trim() && line.trim() !== slide.title.trim());
      const layoutPartName = layoutForNewSlideAt(slideIndex);
      operations.push({
        kind: "add-slide",
        slideId: slide.id,
        ...(layoutPartName ? { layoutPartName } : {}),
        ...(slide.title ? { title: slide.title } : {}),
        ...(text.length ? { text } : {}),
      });
      if (slide.speakerNotes)
        operations.push({
          kind: "set-notes",
          slideId: slide.id,
          text: slide.speakerNotes,
        });
      if (slide.hidden)
        operations.push({
          kind: "set-slide-hidden",
          slideId: slide.id,
          hidden: true,
        });
      return;
    }
    if (slide.title !== old.title)
      operations.push({
        kind: "set-title",
        slideId: slide.id,
        text: slide.title,
      });
    if (slide.speakerNotes !== old.speakerNotes)
      operations.push({
        kind: "set-notes",
        slideId: slide.id,
        text: slide.speakerNotes,
      });
    if (Boolean(slide.hidden) !== Boolean(old.hidden))
      operations.push({
        kind: "set-slide-hidden",
        slideId: slide.id,
        hidden: Boolean(slide.hidden),
      });
    const oldObjects = new Map(
      old.objects.map((object) => [object.id, object]),
    );
    for (const object of slide.objects) {
      const previousObject = oldObjects.get(object.id);
      const value = object.content as
        { text?: unknown; nativeShapeId?: unknown } | undefined;
      const nextText = typeof value?.text === "string" ? value.text : "";
      if (!previousObject) {
        if (object.type === "text" && nextText)
          operations.push({
            kind: "add-text-box",
            slideId: slide.id,
            text: nextText,
          });
        continue;
      }
      const previousValue = previousObject.content as
        { text?: unknown } | undefined;
      const previousText =
        typeof previousValue?.text === "string" ? previousValue.text : "";
      const nativeShapeId =
        typeof value?.nativeShapeId === "string"
          ? value.nativeShapeId
          : undefined;
      if (nativeShapeId && nextText !== previousText && !object.locked)
        operations.push({
          kind: "set-text",
          slideId: slide.id,
          paragraphIndex: 0,
          shapeId: nativeShapeId,
          text: nextText,
        });
      if (!nativeShapeId) continue;
      if ((object.altText ?? "") !== (previousObject.altText ?? ""))
        operations.push({
          kind: "set-alt-text",
          slideId: slide.id,
          shapeId: nativeShapeId,
          text: object.altText ?? "",
        });
      const moved = (["x", "y", "width", "height", "rotation"] as const).some(
        (key) => Math.abs(object[key] - previousObject[key]) > 0.5,
      );
      if (moved && !object.locked)
        operations.push({
          kind: "set-geometry",
          slideId: slide.id,
          shapeId: nativeShapeId,
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          rotation: object.rotation,
        });
    }
  });
  const orderNow = before.slides
    .filter((slide) => kept.has(slide.id))
    .map((slide) => slide.id);
  const orderNext = after.slides.map((slide) => slide.id);
  if (
    orderNext.length !== orderNow.length ||
    orderNext.some((id, index) => id !== orderNow[index])
  )
    operations.push({ kind: "reorder-slides", order: orderNext });
  return operations;
}

export function pptxProjectionUpdateFromContent(
  content: unknown,
  base: PptxProjection,
) {
  const projection = pptxProjectionFromContent(content, base);
  return { projection, operations: pptxOperationsBetween(base, projection) };
}
