import type { SpectraArtifact } from "../data/api";
import {
  calculateWorkbook,
  coordinateToAddress,
  normalizeSheetsContent,
  parseRange,
} from "../sheets/model";
import type {
  PresentationChartContent,
  PresentationContent,
  PresentationObject,
} from "./model";

export type LinkedChartStatus = "not-linked" | "available" | "pinned" | "unavailable";

export type LinkedChartResolution = {
  status: LinkedChartStatus;
  chart?: Pick<PresentationChartContent, "categories" | "series">;
  sourceRevision?: string;
  detail?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is number =>
        typeof candidate === "number" && Number.isFinite(candidate),
      )
    : [];
}

function stringValues(value: unknown) {
  return Array.isArray(value)
    ? value.map(String)
    : [];
}

function objectChart(object: PresentationObject): Pick<PresentationChartContent, "categories" | "series"> {
  const content = record(object.content);
  const categories = stringValues(content.categories);
  const series = Array.isArray(content.series)
    ? content.series.flatMap((candidate, index) => {
        const row = record(candidate);
        return [{
          ...(typeof row.id === "string" ? { id: row.id } : {}),
          name: typeof row.name === "string" ? row.name : `Series ${index + 1}`,
          categories: stringValues(row.categories).length
            ? stringValues(row.categories)
            : categories,
          values: numberValues(row.values),
        }];
      })
    : [];
  if (series.length) return { categories, series };
  const values = numberValues(content.values);
  return {
    categories,
    series: [{ name: "Series 1", categories, values }],
  };
}

function pinnedChart(object: PresentationObject): Pick<PresentationChartContent, "categories" | "series"> {
  const current = objectChart(object);
  const content = record(object.content);
  const pinnedSeries = Array.isArray(content.pinnedSeries)
    ? content.pinnedSeries.flatMap((candidate, index) => {
        const row = record(candidate);
        const values = numberValues(row.values);
        if (!values.length) return [];
        const categories = stringValues(row.categories);
        return [{
          ...(typeof row.id === "string" ? { id: row.id } : {}),
          name: typeof row.name === "string" ? row.name : `Series ${index + 1}`,
          categories: categories.length ? categories : current.categories,
          values,
        }];
      })
    : [];
  if (pinnedSeries.length) {
    return {
      categories: stringValues(content.pinnedCategories).length
        ? stringValues(content.pinnedCategories)
        : current.categories,
      series: pinnedSeries,
    };
  }
  const values = numberValues(content.pinnedValues);
  return values.length
    ? {
        categories: stringValues(content.pinnedCategories).length
          ? stringValues(content.pinnedCategories)
          : current.categories,
        series: [{
          name: current.series[0]?.name ?? "Series 1",
          categories: stringValues(content.pinnedCategories).length
            ? stringValues(content.pinnedCategories)
            : current.categories,
          values,
        }],
      }
    : current;
}

function cellValue(
  workbook: ReturnType<typeof normalizeSheetsContent>,
  calculated: ReturnType<typeof calculateWorkbook>,
  sheetId: string,
  ref: string,
) {
  return calculated.get(`${sheetId}:${ref}`)?.value ??
    workbook.sheets.find((sheet) => sheet.id === sheetId)?.cells[ref]?.value;
}

function cellText(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return fallback;
}

function readSheetRange(
  object: PresentationObject,
  source: SpectraArtifact,
): LinkedChartResolution {
  if (!source.content) {
    return {
      status: "unavailable",
      detail: "The permitted Sheets source has no committed content available.",
    };
  }
  const binding = object.sourceBinding;
  const rangeLabel = binding?.range?.trim() ?? "";
  const bang = rangeLabel.lastIndexOf("!");
  const sheetName = bang >= 0 ? rangeLabel.slice(0, bang).replace(/^'|'$/g, "").replaceAll("''", "'") : undefined;
  const address = bang >= 0 ? rangeLabel.slice(bang + 1) : rangeLabel;
  const range = parseRange(address);
  if (!range) {
    return {
      status: "unavailable",
      detail: "The linked Sheets range is not a readable cell range.",
    };
  }
  const workbook = normalizeSheetsContent(source.content);
  const sheet = sheetName
    ? workbook.sheets.find((candidate) => candidate.name === sheetName)
    : workbook.sheets.find((candidate) => candidate.id === workbook.activeSheetId) ?? workbook.sheets[0];
  if (!sheet) {
    return {
      status: "unavailable",
      detail: "The linked Sheets source no longer contains that sheet.",
    };
  }
  const calculated = calculateWorkbook(workbook);
  const rows: unknown[][] = [];
  for (let row = range.start.row; row <= range.end.row; row += 1) {
    const values: unknown[] = [];
    for (let column = range.start.column; column <= range.end.column; column += 1) {
      const ref = coordinateToAddress({ row, column });
      values.push(cellValue(workbook, calculated, sheet.id, ref));
    }
    rows.push(values);
  }
  const width = range.end.column - range.start.column + 1;
  const hasHeaderAndCategory = width >= 2 && rows.length >= 2;
  const categories = hasHeaderAndCategory
    ? rows.slice(1).map((row, index) => cellText(row[0], `Category ${index + 1}`))
    : rows.map((_row, index) => `Category ${index + 1}`);
  const series = (hasHeaderAndCategory
    ? Array.from({ length: width - 1 }, (_, offset) => offset + 1)
    : [0]
  ).map((column) => {
    const dataRows = hasHeaderAndCategory ? rows.slice(1) : rows;
    const header = hasHeaderAndCategory ? cellText(rows[0]?.[column], `Series ${column}`) : "Series 1";
    return {
      name: header,
      categories,
      values: dataRows.map((row) => row[column]).filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value),
      ),
    };
  });
  if (!series.some((candidate) => candidate.values.length)) {
    return {
      status: "unavailable",
      detail: "The linked Sheets range contains no committed numeric chart values.",
    };
  }
  return {
    status: "available",
    chart: { categories, series },
    ...(source.currentVersionId ? { sourceRevision: source.currentVersionId } : {}),
  };
}

export function resolveLinkedChart(
  object: PresentationObject,
  artifacts: readonly SpectraArtifact[],
): LinkedChartResolution {
  const binding = object.sourceBinding;
  if (!binding || binding.kind !== "sheets_range" || object.type !== "chart")
    return { status: "not-linked" };
  if (binding.live === false) {
    return {
      status: "pinned",
      chart: pinnedChart(object),
      ...(binding.versionId ? { sourceRevision: binding.versionId } : {}),
    };
  }
  const source = artifacts.find((candidate) => candidate._id === binding.artifactId);
  if (!source || source.blueprintKey !== "sheets" || source.status !== "active") {
    return {
      status: "unavailable",
      detail: "The permitted Sheets source is unavailable or access was revoked.",
    };
  }
  return readSheetRange(object, source);
}

export function linkedChartValues(
  object: PresentationObject,
  artifacts: readonly SpectraArtifact[],
) {
  const resolution = resolveLinkedChart(object, artifacts);
  if (resolution.status === "not-linked") return undefined;
  if (resolution.status === "unavailable") return null;
  return resolution.chart?.series.flatMap((series) => series.values) ?? [];
}

export function applyLinkedChartResolution(
  object: PresentationObject,
  resolution: LinkedChartResolution,
): PresentationObject {
  if (!resolution.chart || (resolution.status !== "available" && resolution.status !== "pinned"))
    return object;
  const current = record(object.content);
  return {
    ...object,
    content: {
      ...current,
      categories: resolution.chart.categories,
      series: resolution.chart.series,
    },
    ...(object.sourceBinding && resolution.sourceRevision
      ? { sourceBinding: { ...object.sourceBinding, versionId: resolution.sourceRevision } }
      : {}),
  };
}

export function refreshPresentationLinkedCharts(
  deck: PresentationContent,
  artifacts: readonly SpectraArtifact[],
) {
  const unavailable: string[] = [];
  let changed = false;
  const slides = deck.slides.map((slide) => {
    const objects = slide.objects.map((object) => {
      const resolution = resolveLinkedChart(object, artifacts);
      if (resolution.status === "unavailable") {
        if (object.sourceBinding?.kind === "sheets_range") unavailable.push(object.id);
        return object;
      }
      const next = applyLinkedChartResolution(object, resolution);
      if (next !== object) changed = true;
      return next;
    });
    return objects.some((object, index) => object !== slide.objects[index])
      ? { ...slide, objects }
      : slide;
  });
  return {
    deck: changed ? { ...deck, slides } : deck,
    unavailable,
  };
}
