import type { PresentationContent } from "../presentation/model";
import type { SheetsContent } from "../sheets/model";
import { z } from "zod";
import {
  pptxProjectionSchema,
  xlsxProjectionSchema,
  type PptxOperation,
  type PptxProjection,
  type XlsxOperation,
  type XlsxProjection,
} from "./projection-contracts";

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
  // A deck can have notes pages for some slides and none for others, so the
  // honesty flag is decided per slide rather than for the file. A slide with no
  // notes part is the case that used to lie: the note went into Spectra's own
  // state, the command reported success, and materialize had nowhere to write
  // it. Saying `unsupported` here is what lets the notes command refuse in
  // advance, in words, instead of accepting text it cannot deliver.
  return {
    theme: { id: "native-pptx", name: "PowerPoint theme" },
    settings: {
      aspectRatio:
        projection.nativeBinding.canvasWidthEmu && projection.nativeBinding.canvasHeightEmu &&
        projection.nativeBinding.canvasWidthEmu / projection.nativeBinding.canvasHeightEmu < 1.55
          ? "4:3"
          : "16:9",
      showSlideNumbers: true,
    },
    slides: projection.slides.map((slide) => {
      const notesUnsupported = !slide.notesPartName;
      return {
        id: slide.id,
        title: slide.title,
        ...(slide.layoutPartName ? { layoutId: slide.layoutPartName } : {}),
        // The lens reads the file's notes pages, so the studio has to receive
        // them. Dropping them here made an opened deck look as though it had no
        // speaker notes at all, and then saving could only ever write them back
        // as empty.
        ...(slide.speakerNotes ? { speakerNotes: slide.speakerNotes } : {}),
        objects: slide.objects,
        ...(slide.hasTransition || slide.hasTiming || notesUnsupported
          ? {
              nativeCompatibility: {
                ...(slide.hasTransition
                  ? { transition: "preserved" as const }
                  : {}),
                ...(slide.hasTiming ? { animations: "preserved" as const } : {}),
                ...(notesUnsupported
                  ? { speakerNotes: "unsupported" as const }
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
              })
              .passthrough(),
          ),
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
  const raw = xlsxEditorContentSchema.parse(content);
  const byId = new Map(raw.sheets.map((sheet) => [sheet.id, sheet]));
  const projection = xlsxProjectionSchema.parse({
    ...base,
    sheets: base.sheets.map((sheet) => {
      const next = byId.get(sheet.id);
      if (!next) return sheet;
      const previousByRef = new Map(sheet.cells.map((cell) => [cell.ref, cell]));
      const cells = Object.entries(next.cells).map(([rawRef, value]) => {
        const ref = rawRef.toUpperCase();
        const previous = previousByRef.get(ref);
        const nextValue = value.value === undefined ? previous?.value ?? null : value.value;
        if (
          previous?.formula &&
          !value.formula &&
          JSON.stringify(nextValue) !== JSON.stringify(previous.value)
        )
          throw new Error(
            `Formula ${sheet.name}!${ref} cannot be replaced by a literal through a value edit. Edit its formula text instead.`,
          );
        return {
          ...(previous ?? {
            id: `xlsx:${sheet.id.replace(/^xlsx:sheet:/, "")}:${ref}`,
            ref,
            value: null,
          }),
          value: nextValue,
          ...(value.formula
            ? {
                formula: value.formula.replace(/^=/, ""),
                formulaSupport: previous?.formulaSupport,
              }
            : previous?.formula
              ? {
                  formula: previous.formula,
                  formulaSupport: previous.formulaSupport,
                }
              : {}),
        };
      });
      return { ...sheet, cells };
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
            ? { kind: "set-formula", sheetId: sheet.id, ref: cell.ref, formula: cell.formula }
            : { kind: "set-cell", sheetId: sheet.id, ref: cell.ref, value: cell.value },
        );
        continue;
      }
      if (cell.formula !== old.formula) {
        if (!cell.formula)
          throw new Error(
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
    }
    for (const ref of oldCells.keys())
      operations.push({ kind: "clear-cell", sheetId: sheet.id, ref });
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

function editorObject(
  value: Record<string, unknown>,
  fallbackId: string,
) {
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
      const incomingRawObjects = (next.objects ?? []).map((object) => object as Record<string, unknown>);
      const incomingObjects = (slide ? incomingRawObjects : incomingRawObjects.map((object, objectIndex) =>
        editorObject(
          object,
          `${next.id}:spectra:${objectIndex + 1}`,
        ),
      )) as Array<PptxProjection["slides"][number]["objects"][number]>;
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
          speakerNotes: next.speakerNotes ?? "",
        };
      const incomingById = new Map(
        incomingObjects.map((object) => [object.id, object]),
      );
      const objects = slide.objects.map((object) => {
        const incoming = incomingById.get(object.id);
        incomingById.delete(object.id);
        return incoming
          ? { ...object, ...incoming, content: incoming.content ?? object.content }
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
      return;
    }
    if (slide.title !== old.title)
      operations.push({ kind: "set-title", slideId: slide.id, text: slide.title });
    if (slide.speakerNotes !== old.speakerNotes && old.notesPartName)
      operations.push({ kind: "set-notes", slideId: slide.id, text: slide.speakerNotes });
    const oldObjects = new Map(old.objects.map((object) => [object.id, object]));
    for (const object of slide.objects) {
      const previousObject = oldObjects.get(object.id);
      const value = object.content as
        | { text?: unknown; nativeShapeId?: unknown }
        | undefined;
      const nextText = typeof value?.text === "string" ? value.text : "";
      if (!previousObject) {
        if (object.type === "text" && nextText)
          operations.push({ kind: "add-text-box", slideId: slide.id, text: nextText });
        continue;
      }
      const previousValue = previousObject.content as { text?: unknown } | undefined;
      const previousText =
        typeof previousValue?.text === "string" ? previousValue.text : "";
      const nativeShapeId =
        typeof value?.nativeShapeId === "string" ? value.nativeShapeId : undefined;
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
