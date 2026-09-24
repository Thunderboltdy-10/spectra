import {
  columnName, coordinateToAddress, formatCalculatedCell, normalizeRange, parseRange,
  type CellRange, type WorkbookSheet, type SheetChart, type SheetsCalculation,
} from "./model";

function chartCellValue(
  sheet: WorkbookSheet,
  calculated: SheetsCalculation,
  row: number,
  column: number,
) {
  const address = coordinateToAddress({ row, column });
  return (
    calculated.get(`${sheet.id}:${address}`)?.value ??
    sheet.cells[address]?.value ??
    null
  );
}

export function chartFirstRowIsHeader(
  sheet: WorkbookSheet,
  range: CellRange,
  calculated: SheetsCalculation,
) {
  for (
    let column = range.start.column;
    column <= range.end.column;
    column += 1
  ) {
    const value = chartCellValue(sheet, calculated, range.start.row, column);
    if (typeof value === "number") continue;
    if (value !== null && value !== undefined && String(value).trim() !== "")
      return true;
  }
  return false;
}

export function chartDataset(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: SheetsCalculation,
) {
  const range = parseRange(chart.sourceRange.split("!").at(-1) ?? "");
  if (!range) return { data: [], keys: [] as string[], category: "Category" };
  const normalized = normalizeRange(range);
  const hasHeader = chartFirstRowIsHeader(sheet, normalized, calculated);
  const headers: string[] = [];
  for (
    let column = normalized.start.column;
    column <= normalized.end.column;
    column += 1
  ) {
    if (hasHeader) {
      const address = coordinateToAddress({
        row: normalized.start.row,
        column,
      });
      headers.push(
        formatCalculatedCell(
          sheet.cells[address],
          calculated.get(`${sheet.id}:${address}`),
          "en-US",
        ) || columnName(column),
      );
    } else {
      headers.push(
        normalized.end.column === normalized.start.column
          ? "Value"
          : columnName(column),
      );
    }
  }
  const singleSeries = headers.length === 1;
  const data = [];
  const dataStart = hasHeader ? normalized.start.row + 1 : normalized.start.row;
  const rowCount = Math.max(0, normalized.end.row - dataStart + 1);
  let labelColumn = -1;
  if ((singleSeries || !hasHeader) && rowCount) {
    for (let column = normalized.start.column - 1; column >= 0; column -= 1) {
      let textCount = 0;
      for (let row = dataStart; row <= normalized.end.row; row += 1) {
        const value = chartCellValue(sheet, calculated, row, column);
        if (typeof value === "string" && value.trim() !== "") textCount += 1;
      }
      if (textCount >= Math.ceil(rowCount / 2)) {
        labelColumn = column;
        break;
      }
    }
  }
  for (let row = dataStart; row <= normalized.end.row; row += 1) {
    const side =
      labelColumn >= 0
        ? chartCellValue(sheet, calculated, row, labelColumn)
        : null;
    const categoryLabel =
      typeof side === "string" && side.trim()
        ? side
        : String(row - dataStart + 1);
    const entry: Record<string, string | number> =
      singleSeries || !hasHeader ? { Category: categoryLabel } : {};
    for (
      let column = normalized.start.column;
      column <= normalized.end.column;
      column += 1
    ) {
      const value = chartCellValue(sheet, calculated, row, column);
      entry[headers[column - normalized.start.column]!] =
        typeof value === "number" ? value : String(value ?? "");
    }
    data.push(entry);
  }
  if (singleSeries) return { data, category: "Category", keys: headers };
  if (hasHeader)
    return {
      data,
      category: headers[0] ?? "Category",
      keys: headers.slice(1),
    };
  return { data, category: "Category", keys: headers };
}

export function chartSummary(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: SheetsCalculation,
) {
  const dataset = chartDataset(sheet, chart, calculated);
  const values =
    chart.type === "histogram"
      ? numericValuesForRange(sheet, chart, calculated)
      : dataset.data.flatMap((entry) =>
          dataset.keys.flatMap((key) =>
            typeof entry[key] === "number" ? [entry[key] as number] : [],
          ),
        );
  if (!values.length)
    return {
      count: dataset.data.length,
      mean: null,
      min: null,
      max: null,
      standardDeviation: null,
    };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: dataset.data.length,
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    standardDeviation: Math.sqrt(
      values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
        values.length,
    ),
  };
}

function numericValuesForRange(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: SheetsCalculation,
) {
  const range = parseRange(chart.sourceRange.split("!").at(-1) ?? "");
  if (!range) return [];
  const normalized = normalizeRange(range);
  const hasHeader = chartFirstRowIsHeader(sheet, normalized, calculated);
  const values: number[] = [];
  for (
    let row = hasHeader ? normalized.start.row + 1 : normalized.start.row;
    row <= normalized.end.row;
    row += 1
  ) {
    for (
      let column = normalized.start.column;
      column <= normalized.end.column;
      column += 1
    ) {
      const address = coordinateToAddress({ row, column });
      const value =
        calculated.get(`${sheet.id}:${address}`)?.value ??
        sheet.cells[address]?.value;
      if (typeof value === "number" && Number.isFinite(value))
        values.push(value);
    }
  }
  return values;
}

export function histogramDataset(
  sheet: WorkbookSheet,
  chart: SheetChart,
  calculated: SheetsCalculation,
) {
  const values = numericValuesForRange(sheet, chart, calculated);
  if (!values.length) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum)
    return [{ bucket: String(minimum), count: values.length }];
  const binCount = Math.max(
    3,
    Math.min(30, Math.ceil(Math.sqrt(values.length))),
  );
  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: minimum + index * width,
    upper: index === binCount - 1 ? maximum : minimum + (index + 1) * width,
    count: 0,
  }));
  values.forEach((value) => {
    const index = Math.min(binCount - 1, Math.floor((value - minimum) / width));
    bins[index]!.count += 1;
  });
  const precision = Math.max(
    0,
    Math.min(6, Math.ceil(-Math.log10(Math.abs(width))) + 1),
  );
  return bins.map((bin) => ({
    bucket: `${bin.lower.toFixed(precision)} to ${bin.upper.toFixed(precision)}`,
    count: bin.count,
  }));
}

