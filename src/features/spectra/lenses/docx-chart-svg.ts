import { parseXml, type XmlElement } from "@ariadng/office/xml";

/**
 * A Word chart drawn from the values Word cached in its chart part.
 *
 * Spectra never edits a chart: the part stays exactly as Word wrote it. This
 * turns its cached series into an SVG picture so the chart shows where it sits
 * in the document. Scatter, line, column and bar charts are drawn with their
 * axis titles, legend, error bars and trendlines; anything else is a frame at
 * the chart's own size that says to edit it in Word.
 */

const MAX_POINTS = 20_000;
const PALETTE = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#264478", "#9E480E", "#636363", "#997300"];
const SCHEME: Record<string, string> = {
  accent1: "#4472C4", accent2: "#ED7D31", accent3: "#A5A5A5", accent4: "#FFC000", accent5: "#5B9BD5", accent6: "#70AD47",
  tx1: "#000000", dk1: "#000000", tx2: "#44546A", dk2: "#44546A", bg1: "#FFFFFF", lt1: "#FFFFFF", bg2: "#E7E6E6", lt2: "#E7E6E6",
};
const FONT = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

type Marker = "none" | "circle" | "square" | "diamond" | "triangle" | "x" | "plus" | "star" | "dash" | "dot";
type ErrorBars = { direction: "x" | "y"; type: "both" | "plus" | "minus"; plus: (index: number, value: number) => number; minus: (index: number, value: number) => number };
type Trendline = { kind: "linear" | "exp" | "log" | "poly" | "power" | "movingAvg"; order: number; period: number; color?: string; name?: string };
type Series = {
  name: string;
  color: string;
  line: boolean;
  marker: Marker;
  markerSize: number;
  smooth: boolean;
  x: Array<number | null>;
  y: Array<number | null>;
  errorBars: ErrorBars[];
  trendlines: Trendline[];
};
type Axis = { title?: string; min?: number; max?: number; majorUnit?: number; format?: string; reversed: boolean; deleted: boolean; gridlines: boolean; log?: number };
export type WordChart = {
  kind: "scatter" | "line" | "column" | "bar";
  stacked: "none" | "stacked" | "percent";
  title?: string;
  categories: string[];
  series: Series[];
  x: Axis;
  y: Axis;
  legend?: "b" | "t" | "r" | "l" | "tr";
};

const isChart = (element: XmlElement, name: string) => element.localName === name;
const child = (element: XmlElement | undefined, name: string) => element?.elements().find((candidate) => candidate.localName === name);
const children = (element: XmlElement | undefined, name: string) => element?.elements().filter((candidate) => candidate.localName === name) ?? [];
const value = (element: XmlElement | undefined, name: string) => child(element, name)?.getAttribute("val") ?? undefined;
const numberValue = (element: XmlElement | undefined, name: string) => {
  const raw = value(element, name);
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function descendants(element: XmlElement): XmlElement[] {
  return element.elements().flatMap((candidate) => [candidate, ...descendants(candidate)]);
}

/** The words of a rich title: every `a:t` in order. */
function richText(element: XmlElement | undefined) {
  if (!element) return undefined;
  const paragraphs = descendants(element).filter((candidate) => candidate.localName === "p");
  const text = (paragraphs.length ? paragraphs : [element])
    .map((paragraph) => descendants(paragraph).filter((candidate) => candidate.localName === "t").map((t) => t.text()).join(""))
    .join(" ")
    .trim();
  return text || undefined;
}

function titleText(title: XmlElement | undefined) {
  const tx = child(title, "tx");
  return richText(child(tx, "rich")) ?? cachedStrings(child(tx, "strRef"))[0];
}

/** Cached point values, placed at their own index. */
function cachedPoints(cache: XmlElement | undefined) {
  if (!cache) return [] as string[];
  const count = Math.min(numberValue(cache, "ptCount") ?? 0, MAX_POINTS);
  const points: string[] = Array.from({ length: count }, () => "");
  for (const point of children(cache, "pt")) {
    const index = Number(point.getAttribute("idx"));
    if (!Number.isInteger(index) || index < 0 || index >= MAX_POINTS) continue;
    points[index] = child(point, "v")?.text() ?? "";
  }
  return points;
}

function cachedStrings(source: XmlElement | undefined) {
  if (!source) return [];
  const cache = child(source, "strCache") ?? child(source, "numCache") ?? (["strLit", "numLit"].includes(source.localName) ? source : undefined);
  return cachedPoints(cache);
}

function cachedNumbers(source: XmlElement | undefined) {
  if (!source) return [] as Array<number | null>;
  const reference = child(source, "numRef") ?? child(source, "strRef") ?? child(source, "numLit") ?? child(source, "strLit");
  const cache = reference && (child(reference, "numCache") ?? child(reference, "strCache") ?? (reference.localName.endsWith("Lit") ? reference : undefined));
  return cachedPoints(cache).map((text) => {
    if (text === "") return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  });
}

function categoryLabels(source: XmlElement | undefined) {
  if (!source) return [];
  const reference = child(source, "strRef") ?? child(source, "numRef") ?? child(source, "multiLvlStrRef") ?? child(source, "strLit") ?? child(source, "numLit");
  if (!reference) return [];
  if (reference.localName === "multiLvlStrRef") {
    const level = child(child(reference, "multiLvlStrCache"), "lvl");
    return cachedPoints(level);
  }
  return cachedStrings(reference);
}

function colorOf(fill: XmlElement | undefined): string | undefined {
  if (!fill) return undefined;
  const rgb = child(fill, "srgbClr")?.getAttribute("val");
  if (rgb && /^[0-9a-f]{6}$/iu.test(rgb)) return `#${rgb.toUpperCase()}`;
  const scheme = child(fill, "schemeClr")?.getAttribute("val");
  if (scheme && SCHEME[scheme]) return SCHEME[scheme];
  const preset = child(fill, "prstClr")?.getAttribute("val");
  if (preset && /^[a-z]+$/iu.test(preset)) return preset;
  return undefined;
}

function shapeLine(shape: XmlElement | undefined) {
  const line = child(shape, "ln");
  if (!line) return { shown: undefined as boolean | undefined, color: undefined as string | undefined };
  if (child(line, "noFill")) return { shown: false, color: undefined };
  return { shown: true, color: colorOf(child(line, "solidFill")) };
}

function errorBarsOf(series: XmlElement, scatter: boolean): ErrorBars[] {
  return children(series, "errBars").flatMap((bars) => {
    const direction = value(bars, "errDir") === "x" && scatter ? "x" : "y";
    const type = (value(bars, "errBarType") ?? "both") as ErrorBars["type"];
    const kind = value(bars, "errValType") ?? "fixedVal";
    const amount = numberValue(bars, "val") ?? 1;
    if (kind === "cust") {
      const plus = cachedNumbers(child(bars, "plus"));
      const minus = cachedNumbers(child(bars, "minus"));
      return [{ direction, type, plus: (index) => plus[index] ?? 0, minus: (index) => minus[index] ?? 0 }];
    }
    if (kind === "fixedVal") return [{ direction, type, plus: () => amount, minus: () => amount }];
    if (kind === "percentage") return [{ direction, type, plus: (_index, point) => Math.abs(point) * amount / 100, minus: (_index, point) => Math.abs(point) * amount / 100 }];
    return [];
  });
}

function trendlinesOf(series: XmlElement): Trendline[] {
  return children(series, "trendline").flatMap((trendline) => {
    const kind = value(trendline, "trendlineType") as Trendline["kind"] | undefined;
    if (!kind || !["linear", "exp", "log", "poly", "power", "movingAvg"].includes(kind)) return [];
    const name = child(trendline, "name")?.text().trim();
    return [{
      kind,
      order: Math.max(2, Math.min(6, numberValue(trendline, "order") ?? 2)),
      period: Math.max(2, Math.min(255, numberValue(trendline, "period") ?? 2)),
      ...(shapeLine(child(trendline, "spPr")).color ? { color: shapeLine(child(trendline, "spPr")).color } : {}),
      ...(name ? { name } : {}),
    }];
  });
}

function axisOf(element: XmlElement | undefined): Axis {
  const scaling = child(element, "scaling");
  const title = titleText(child(element, "title"));
  const format = child(element, "numFmt")?.getAttribute("formatCode") ?? undefined;
  const log = numberValue(scaling, "logBase");
  return {
    ...(title ? { title } : {}),
    ...(numberValue(scaling, "min") !== undefined ? { min: numberValue(scaling, "min") } : {}),
    ...(numberValue(scaling, "max") !== undefined ? { max: numberValue(scaling, "max") } : {}),
    ...(numberValue(element, "majorUnit") ? { majorUnit: numberValue(element, "majorUnit") } : {}),
    ...(format ? { format } : {}),
    ...(log && log > 1 ? { log } : {}),
    reversed: value(scaling, "orientation") === "maxMin",
    deleted: value(element, "delete") === "1" || value(element, "delete") === "true",
    gridlines: Boolean(child(element, "majorGridlines")),
  };
}

const MARKERS = new Set<Marker>(["none", "circle", "square", "diamond", "triangle", "x", "plus", "star", "dash", "dot"]);

/** Reads a chart part. `null` when it is not a chart this renderer draws. */
export function parseWordChart(xml: string): WordChart | null {
  let root: XmlElement;
  try {
    root = parseXml(xml).root;
  } catch {
    return null;
  }
  if (root.localName !== "chartSpace") return null;
  const chart = child(root, "chart");
  const plotArea = child(chart, "plotArea");
  if (!plotArea) return null;
  const groups = plotArea.elements().filter((element) => element.localName.endsWith("Chart"));
  const supported = groups.filter((group) => ["scatterChart", "lineChart", "barChart"].some((name) => isChart(group, name)));
  if (!supported.length || supported.length !== groups.length) return null;
  const kinds = new Set(supported.map((group) => group.localName));
  if (kinds.size > 1 && !(kinds.size === 2 && kinds.has("scatterChart") && kinds.has("lineChart"))) return null;
  const first = supported[0]!;
  const scatter = isChart(first, "scatterChart");
  const bar = isChart(first, "barChart");
  const grouping = value(first, "grouping");
  const kind: WordChart["kind"] = scatter ? "scatter" : bar ? (value(first, "barDir") === "bar" ? "bar" : "column") : "line";
  let categories: string[] = [];
  const series: Series[] = [];
  for (const group of supported) {
    const groupScatter = isChart(group, "scatterChart");
    const style = value(group, "scatterStyle");
    for (const element of children(group, "ser")) {
      const index = numberValue(element, "idx") ?? series.length;
      const shape = child(element, "spPr");
      const line = shapeLine(shape);
      const fill = colorOf(child(shape, "solidFill"));
      const markerElement = child(element, "marker");
      const symbol = value(markerElement, "symbol") as Marker | undefined;
      const markerColor = colorOf(child(child(markerElement, "spPr"), "solidFill")) ?? shapeLine(child(markerElement, "spPr")).color;
      const color = (bar ? fill : line.color) ?? fill ?? markerColor ?? PALETTE[index % PALETTE.length]!;
      const name = cachedStrings(child(child(element, "tx"), "strRef"))[0] ?? child(child(element, "tx"), "v")?.text() ?? `Series ${index + 1}`;
      const ySource = groupScatter ? child(element, "yVal") : child(element, "val");
      const xSource = groupScatter ? child(element, "xVal") : child(element, "cat");
      const y = cachedNumbers(ySource);
      let x: Array<number | null>;
      if (groupScatter) {
        const numeric = cachedNumbers(xSource);
        x = numeric.length && numeric.some((point) => point !== null) ? numeric : y.map((_point, point) => point + 1);
      } else {
        const labels = categoryLabels(xSource);
        if (labels.length > categories.length) categories = labels;
        x = y.map((_point, point) => point);
      }
      const defaultLine = groupScatter ? !["marker", "none"].includes(style ?? "") : !bar;
      series.push({
        name,
        color,
        line: !bar && (line.shown ?? defaultLine),
        marker: bar ? "none" : symbol && MARKERS.has(symbol) ? symbol : groupScatter ? "circle" : "none",
        markerSize: Math.max(2, Math.min(72, numberValue(markerElement, "size") ?? 5)),
        smooth: value(element, "smooth") === "1" || (groupScatter && style?.startsWith("smooth") === true),
        x,
        y,
        errorBars: errorBarsOf(element, groupScatter),
        trendlines: trendlinesOf(element),
      });
    }
  }
  if (!series.length) return null;
  const axes = plotArea.elements().filter((element) => ["valAx", "catAx", "dateAx"].includes(element.localName));
  const horizontal = (element: XmlElement) => ["b", "t"].includes(value(element, "axPos") ?? "");
  let xAxis = axes.find(horizontal);
  let yAxis = axes.find((element) => !horizontal(element));
  if (kind === "bar") [xAxis, yAxis] = [axes.find((element) => element.localName !== "valAx"), axes.find((element) => element.localName === "valAx")];
  const legend = child(chart, "legend");
  const legendPosition = value(legend, "legendPos") as WordChart["legend"];
  // A title Word writes itself is the only series' name.
  const title = titleText(child(chart, "title")) ?? (child(chart, "title") && series.length === 1 ? series[0]!.name : undefined);
  return {
    kind,
    stacked: grouping === "percentStacked" ? "percent" : grouping === "stacked" ? "stacked" : "none",
    ...(title ? { title } : {}),
    categories,
    series,
    x: axisOf(xAxis),
    y: axisOf(yAxis),
    ...(legend ? { legend: legendPosition && ["b", "t", "r", "l", "tr"].includes(legendPosition) ? legendPosition : "r" } : {}),
  };
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round = (number: number) => Math.round(number * 100) / 100;

/** Numbers as the axis format asks: `0.00`, `0%`, `General`. */
export function formatChartNumber(number: number, format = "General") {
  const code = format.split(";")[0] ?? "General";
  const percent = code.includes("%");
  const shown = percent ? number * 100 : number;
  const decimals = /0\.(0+)/u.exec(code)?.[1]?.length ?? (/(?:^|[^.])0(?:[^.]|$)/u.test(code) && !/General/iu.test(code) ? 0 : undefined);
  const scientific = /E\+/iu.test(code);
  let text: string;
  if (scientific) text = shown.toExponential(decimals ?? 2).replace("e", "E");
  else if (decimals !== undefined) text = shown.toFixed(decimals);
  else {
    const magnitude = Math.abs(shown);
    text = magnitude !== 0 && (magnitude >= 1e11 || magnitude < 1e-5)
      ? shown.toExponential(2).replace("e", "E")
      : String(Number(shown.toPrecision(10)));
  }
  if (/#,##/u.test(code)) {
    const [whole, fraction] = text.split(".");
    text = whole!.replace(/\B(?=(\d{3})+(?!\d))/gu, ",") + (fraction ? `.${fraction}` : "");
  }
  return `${text.replace(/^-0(\.0+)?$/u, "0$1")}${percent ? "%" : ""}`;
}

function niceStep(span: number, ticks: number) {
  const raw = span / Math.max(1, ticks);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
}

/** Word's automatic bounds: zero kept when the data sit well above it, ends on whole steps. */
function scaleFor(values: number[], axis: Axis, ticks: number, includeZero: boolean) {
  const finite = values.filter(Number.isFinite);
  let low = finite.length ? Math.min(...finite) : 0;
  let high = finite.length ? Math.max(...finite) : 1;
  if (axis.log) {
    const positive = finite.filter((point) => point > 0);
    const base = axis.log;
    const lowPower = Math.floor(Math.log(Math.min(...(positive.length ? positive : [1]))) / Math.log(base));
    const highPower = Math.ceil(Math.log(Math.max(...(positive.length ? positive : [base]))) / Math.log(base));
    const min = axis.min ?? base ** lowPower;
    const max = axis.max ?? base ** Math.max(highPower, lowPower + 1);
    const steps: number[] = [];
    for (let power = Math.round(Math.log(min) / Math.log(base)); base ** power <= max * 1.0001 && steps.length < 40; power += 1) steps.push(base ** power);
    return { min, max, ticks: steps, log: base };
  }
  if (includeZero && low > 0 && (high - low) / high > 1 / 6) low = 0;
  if (includeZero && high < 0 && (low - high) / low > 1 / 6) high = 0;
  if (low === high) {
    low -= Math.abs(low) * 0.1 || 1;
    high += Math.abs(high) * 0.1 || 1;
  }
  const step = axis.majorUnit && axis.majorUnit > 0 ? axis.majorUnit : niceStep(high - low, ticks);
  const min = axis.min ?? Math.floor(low / step + 1e-9) * step;
  let max = axis.max ?? Math.ceil(high / step - 1e-9) * step;
  if (max <= min) max = min + step;
  const list: number[] = [];
  for (let tick = Math.ceil(min / step - 1e-9) * step; tick <= max + step * 1e-6 && list.length < 200; tick += step) list.push(Number(tick.toPrecision(12)));
  return { min, max, ticks: list, log: undefined as number | undefined };
}

function textWidth(text: string, size: number) {
  return text.length * size * 0.52;
}

function markerPath(marker: Marker, x: number, y: number, size: number) {
  const r = size / 2;
  switch (marker) {
    case "square": return `<rect x="${round(x - r)}" y="${round(y - r)}" width="${round(size)}" height="${round(size)}"/>`;
    case "diamond": return `<path d="M${round(x)} ${round(y - r)}L${round(x + r)} ${round(y)}L${round(x)} ${round(y + r)}L${round(x - r)} ${round(y)}Z"/>`;
    case "triangle": return `<path d="M${round(x)} ${round(y - r)}L${round(x + r)} ${round(y + r)}L${round(x - r)} ${round(y + r)}Z"/>`;
    case "x": return `<path d="M${round(x - r)} ${round(y - r)}L${round(x + r)} ${round(y + r)}M${round(x + r)} ${round(y - r)}L${round(x - r)} ${round(y + r)}" fill="none" stroke-width="1.25"/>`;
    case "plus": return `<path d="M${round(x - r)} ${round(y)}L${round(x + r)} ${round(y)}M${round(x)} ${round(y - r)}L${round(x)} ${round(y + r)}" fill="none" stroke-width="1.25"/>`;
    case "star": return `<path d="M${round(x - r)} ${round(y - r)}L${round(x + r)} ${round(y + r)}M${round(x + r)} ${round(y - r)}L${round(x - r)} ${round(y + r)}M${round(x)} ${round(y - r)}L${round(x)} ${round(y + r)}" fill="none" stroke-width="1.25"/>`;
    case "dash": return `<rect x="${round(x - r)}" y="${round(y - 1)}" width="${round(size)}" height="2"/>`;
    case "dot": return `<circle cx="${round(x)}" cy="${round(y)}" r="1.5"/>`;
    case "none": return "";
    default: return `<circle cx="${round(x)}" cy="${round(y)}" r="${round(r)}"/>`;
  }
}

/** Least squares fit of y against the given basis. */
function fit(points: Array<[number, number]>, basis: (x: number) => number[]) {
  const rows = points.map(([x]) => basis(x));
  const size = rows[0]?.length ?? 0;
  if (!size || points.length < size) return undefined;
  const matrix = Array.from({ length: size }, (_row, i) => Array.from({ length: size + 1 }, (_cell, j) =>
    j < size ? rows.reduce((sum, row) => sum + row[i]! * row[j]!, 0) : rows.reduce((sum, row, k) => sum + row[i]! * points[k]![1], 0)));
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) pivot = row;
    if (Math.abs(matrix[pivot]![column]!) < 1e-12) return undefined;
    [matrix[column], matrix[pivot]] = [matrix[pivot]!, matrix[column]!];
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row]![column]! / matrix[column]![column]!;
      for (let cell = column; cell <= size; cell += 1) matrix[row]![cell]! -= factor * matrix[column]![cell]!;
    }
  }
  return matrix.map((row, index) => row[size]! / row[index]!);
}

function trendCurve(trendline: Trendline, points: Array<[number, number]>): ((x: number) => number) | undefined {
  switch (trendline.kind) {
    case "linear": {
      const c = fit(points, (x) => [1, x]);
      return c && ((x) => c[0]! + c[1]! * x);
    }
    case "poly": {
      const c = fit(points, (x) => Array.from({ length: trendline.order + 1 }, (_term, power) => x ** power));
      return c && ((x) => c.reduce((sum, coefficient, power) => sum + coefficient * x ** power, 0));
    }
    case "exp": {
      const usable = points.filter(([, y]) => y > 0).map(([x, y]) => [x, Math.log(y)] as [number, number]);
      const c = fit(usable, (x) => [1, x]);
      return c && ((x) => Math.exp(c[0]! + c[1]! * x));
    }
    case "log": {
      const usable = points.filter(([x]) => x > 0).map(([x, y]) => [Math.log(x), y] as [number, number]);
      const c = fit(usable, (x) => [1, x]);
      return c && ((x) => (x > 0 ? c[0]! + c[1]! * Math.log(x) : NaN));
    }
    case "power": {
      const usable = points.filter(([x, y]) => x > 0 && y > 0).map(([x, y]) => [Math.log(x), Math.log(y)] as [number, number]);
      const c = fit(usable, (x) => [1, x]);
      return c && ((x) => (x > 0 ? Math.exp(c[0]!) * x ** c[1]! : NaN));
    }
    default:
      return undefined;
  }
}

/** A frame at the chart's size, for a chart this renderer does not draw. */
export function chartPlaceholderSvg(width: number, height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}" role="img" aria-label="Chart from Word"><rect x="0.5" y="0.5" width="${round(width - 1)}" height="${round(height - 1)}" fill="#FAFAFA" stroke="#BFBFBF" stroke-dasharray="4 3"/><text x="${round(width / 2)}" y="${round(height / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-size="13" fill="#595959">Chart from Word. Edit it in Word.</text></svg>`;
}

/** Draws the chart at its size in the document (CSS pixels). */
export function wordChartSvg(chart: WordChart, width: number, height: number) {
  const out: string[] = [];
  const font = 12;
  const ink = "#595959";
  const grid = "#D9D9D9";
  const horizontalBars = chart.kind === "bar";
  const categorical = chart.kind !== "scatter";
  let top = 8;
  let bottom = height - 8;
  let left = 8;
  let right = width - 8;
  if (chart.title) {
    out.push(`<text x="${round(width / 2)}" y="${round(top + 16)}" text-anchor="middle" font-size="16" fill="${ink}">${escapeXml(chart.title)}</text>`);
    top += 26;
  }
  const legendEntries = chart.series.flatMap((series) => [
    { name: series.name, color: series.color, line: series.line, marker: series.marker, bar: !categorical || chart.kind === "line" ? false : true },
    ...series.trendlines.map((trendline) => ({ name: trendline.name ?? `${trendlineName(trendline)} (${series.name})`, color: trendline.color ?? series.color, line: true, marker: "none" as Marker, bar: false })),
  ]);
  if (chart.legend && legendEntries.length) {
    const entryWidths = legendEntries.map((entry) => textWidth(entry.name, font) + 26);
    if (chart.legend === "r" || chart.legend === "l" || chart.legend === "tr") {
      const column = Math.min(width * 0.35, Math.max(...entryWidths));
      const x = chart.legend === "l" ? left : right - column;
      let y = (top + bottom) / 2 - (legendEntries.length * 18) / 2;
      for (const entry of legendEntries) {
        out.push(legendKey(entry, x, y + 9), `<text x="${round(x + 24)}" y="${round(y + 13)}" font-size="${font}" fill="${ink}">${escapeXml(entry.name)}</text>`);
        y += 18;
      }
      if (chart.legend === "l") left += column + 8;
      else right -= column + 8;
    } else {
      const lines: Array<Array<{ entry: (typeof legendEntries)[number]; width: number }>> = [[]];
      let used = 0;
      legendEntries.forEach((entry, index) => {
        const entryWidth = entryWidths[index]! + 10;
        if (used + entryWidth > width - 16 && lines.at(-1)!.length) { lines.push([]); used = 0; }
        lines.at(-1)!.push({ entry, width: entryWidth });
        used += entryWidth;
      });
      const block = lines.length * 18;
      let y = chart.legend === "t" ? top : bottom - block;
      for (const line of lines) {
        const total = line.reduce((sum, item) => sum + item.width, 0);
        let x = (width - total) / 2;
        for (const { entry, width: entryWidth } of line) {
          out.push(legendKey(entry, x, y + 9), `<text x="${round(x + 24)}" y="${round(y + 13)}" font-size="${font}" fill="${ink}">${escapeXml(entry.name)}</text>`);
          x += entryWidth;
        }
        y += 18;
      }
      if (chart.legend === "t") top += block + 6;
      else bottom -= block + 6;
    }
  }

  // Value ranges.
  const stackedTotals = (() => {
    if (chart.stacked === "none" || !categorical) return undefined;
    const length = Math.max(...chart.series.map((series) => series.y.length));
    const positive = Array.from({ length }, (_value, index) => chart.series.reduce((sum, series) => sum + Math.max(0, series.y[index] ?? 0), 0));
    const negative = Array.from({ length }, (_value, index) => chart.series.reduce((sum, series) => sum + Math.min(0, series.y[index] ?? 0), 0));
    return { positive, negative };
  })();
  const yValues: number[] = [];
  const xValues: number[] = [];
  for (const series of chart.series) {
    series.y.forEach((point, index) => {
      if (point === null) return;
      yValues.push(point);
      const x = series.x[index];
      if (x !== null && x !== undefined) xValues.push(x);
      for (const bars of series.errorBars) {
        const target = bars.direction === "y" ? yValues : xValues;
        const base = bars.direction === "y" ? point : x ?? 0;
        if (bars.type !== "minus") target.push(base + Math.abs(bars.plus(index, base)));
        if (bars.type !== "plus") target.push(base - Math.abs(bars.minus(index, base)));
      }
    });
  }
  if (stackedTotals) {
    yValues.length = 0;
    if (chart.stacked === "percent") yValues.push(0, 1);
    else yValues.push(...stackedTotals.positive, ...stackedTotals.negative, 0);
  }
  const valueAxis = horizontalBars ? chart.x : chart.y;
  const categoryAxis = horizontalBars ? chart.y : chart.x;
  const valueSpan = horizontalBars ? right - left : bottom - top;
  const valueScale = scaleFor(yValues, chart.stacked === "percent" ? { ...valueAxis, format: valueAxis.format ?? "0%" } : valueAxis, Math.max(3, Math.round(valueSpan / 50)), categorical);
  const xScale = categorical ? undefined : scaleFor(xValues, chart.x, Math.max(3, Math.round((right - left) / 80)), false);
  const categoryCount = Math.max(1, chart.categories.length, ...chart.series.map((series) => series.y.length));
  const valueLabels = valueScale.ticks.map((tick) => formatChartNumber(tick, chart.stacked === "percent" ? valueAxis.format ?? "0%" : valueAxis.format));

  // Axis titles and tick label room.
  const yTitle = horizontalBars ? categoryAxis.title : valueAxis.title;
  const xTitle = horizontalBars ? valueAxis.title : categoryAxis.title;
  if (yTitle && !(horizontalBars ? categoryAxis : valueAxis).deleted) {
    out.push(`<text transform="translate(${round(left + 12)} ${round((top + bottom) / 2)}) rotate(-90)" text-anchor="middle" font-size="13" fill="${ink}">${escapeXml(yTitle)}</text>`);
    left += 22;
  }
  if (xTitle && !(horizontalBars ? valueAxis : categoryAxis).deleted) {
    out.push(`<text x="${round((left + right) / 2)}" y="${round(bottom - 4)}" text-anchor="middle" font-size="13" fill="${ink}">${escapeXml(xTitle)}</text>`);
    bottom -= 22;
  }
  const yLabels = horizontalBars ? chart.categories : xScale ? valueLabels : valueLabels;
  const yLabelWidth = (horizontalBars ? categoryAxis : valueAxis).deleted ? 0 : Math.min(width * 0.3, Math.max(0, ...yLabels.map((label) => textWidth(label, font))) + 8);
  left += yLabelWidth;
  const xAxisDeleted = (horizontalBars ? valueAxis : categoryAxis).deleted;
  if (!xAxisDeleted) bottom -= font + 8;
  right -= 6;
  if (right - left < 20 || bottom - top < 20) return chartPlaceholderSvg(width, height);

  const project = (scale: { min: number; max: number; log?: number }, point: number, from: number, to: number, reversed: boolean) => {
    const position = scale.log
      ? (Math.log(Math.max(point, Number.MIN_VALUE)) - Math.log(scale.min)) / (Math.log(scale.max) - Math.log(scale.min))
      : (point - scale.min) / (scale.max - scale.min);
    return reversed ? to + (from - to) * (1 - position) : from + (to - from) * position;
  };
  const valueAt = (point: number) => horizontalBars
    ? project(valueScale, point, left, right, valueAxis.reversed)
    : project(valueScale, point, bottom, top, valueAxis.reversed);
  const band = (horizontalBars ? bottom - top : right - left) / categoryCount;
  const categoryAt = (index: number) => horizontalBars
    ? (categoryAxis.reversed ? bottom - band * (index + 0.5) : top + band * (index + 0.5))
    : (categoryAxis.reversed ? right - band * (index + 0.5) : left + band * (index + 0.5));
  const xAt = (point: number) => xScale ? project(xScale, point, left, right, chart.x.reversed) : categoryAt(point);

  // Gridlines and value labels.
  valueScale.ticks.forEach((tick, index) => {
    const at = valueAt(tick);
    if (horizontalBars) {
      if (valueAxis.gridlines) out.push(`<line x1="${round(at)}" y1="${round(top)}" x2="${round(at)}" y2="${round(bottom)}" stroke="${grid}"/>`);
      if (!valueAxis.deleted) out.push(`<text x="${round(at)}" y="${round(bottom + font + 4)}" text-anchor="middle" font-size="${font}" fill="${ink}">${escapeXml(valueLabels[index]!)}</text>`);
    } else {
      if (valueAxis.gridlines) out.push(`<line x1="${round(left)}" y1="${round(at)}" x2="${round(right)}" y2="${round(at)}" stroke="${grid}"/>`);
      if (!valueAxis.deleted) out.push(`<text x="${round(left - 6)}" y="${round(at + 4)}" text-anchor="end" font-size="${font}" fill="${ink}">${escapeXml(valueLabels[index]!)}</text>`);
    }
  });
  if (xScale) {
    xScale.ticks.forEach((tick) => {
      const at = xAt(tick);
      if (chart.x.gridlines) out.push(`<line x1="${round(at)}" y1="${round(top)}" x2="${round(at)}" y2="${round(bottom)}" stroke="${grid}"/>`);
      if (!chart.x.deleted) out.push(`<text x="${round(at)}" y="${round(bottom + font + 4)}" text-anchor="middle" font-size="${font}" fill="${ink}">${escapeXml(formatChartNumber(tick, chart.x.format))}</text>`);
    });
  } else if (!categoryAxis.deleted && chart.categories.length) {
    const room = horizontalBars ? font + 2 : Math.max(...chart.categories.map((label) => textWidth(label, font))) + 6;
    // Labels are kept apart by their own size; a blank category has none.
    let last = -Infinity;
    chart.categories.forEach((label, index) => {
      if (!label.trim()) return;
      const at = categoryAt(index);
      if (Math.abs(at - last) < room) return;
      last = at;
      out.push(horizontalBars
        ? `<text x="${round(left - 6)}" y="${round(at + 4)}" text-anchor="end" font-size="${font}" fill="${ink}">${escapeXml(label)}</text>`
        : `<text x="${round(at)}" y="${round(bottom + font + 4)}" text-anchor="middle" font-size="${font}" fill="${ink}">${escapeXml(label)}</text>`);
    });
  }
  // Axis lines at the value zero (or the low end).
  const zero = valueAt(Math.min(Math.max(0, valueScale.min), valueScale.max));
  out.push(horizontalBars
    ? `<line x1="${round(zero)}" y1="${round(top)}" x2="${round(zero)}" y2="${round(bottom)}" stroke="#BFBFBF"/>`
    : `<line x1="${round(left)}" y1="${round(categorical || valueScale.log ? bottom : zero)}" x2="${round(right)}" y2="${round(categorical || valueScale.log ? bottom : zero)}" stroke="#BFBFBF"/>`);

  // Bars.
  if (chart.kind === "column" || chart.kind === "bar") {
    const groups = chart.stacked === "none" ? chart.series.length : 1;
    const gap = 0.6;
    const barSize = band / (groups + gap);
    const positiveBase = new Array<number>(categoryCount).fill(0);
    const negativeBase = new Array<number>(categoryCount).fill(0);
    chart.series.forEach((series, seriesIndex) => {
      series.y.forEach((raw, index) => {
        if (raw === null) return;
        const total = chart.stacked === "percent" ? (stackedTotals!.positive[index]! - stackedTotals!.negative[index]!) || 1 : 1;
        const point = raw / total;
        let from = 0;
        let to = point;
        if (chart.stacked !== "none") {
          const base = point >= 0 ? positiveBase : negativeBase;
          from = base[index]!;
          to = from + point;
          base[index] = to;
        }
        const center = categoryAt(index);
        const offset = chart.stacked === "none" ? (seriesIndex - (groups - 1) / 2) * barSize : 0;
        const a = valueAt(from);
        const b = valueAt(to);
        out.push(horizontalBars
          ? `<rect x="${round(Math.min(a, b))}" y="${round(center + offset - barSize / 2)}" width="${round(Math.abs(b - a))}" height="${round(barSize)}" fill="${series.color}"/>`
          : `<rect x="${round(center + offset - barSize / 2)}" y="${round(Math.min(a, b))}" width="${round(barSize)}" height="${round(Math.abs(b - a))}" fill="${series.color}"/>`);
      });
    });
  }

  // Lines, markers, error bars and trendlines.
  const clip = `<clipPath id="plot"><rect x="${round(left)}" y="${round(top)}" width="${round(right - left)}" height="${round(bottom - top)}"/></clipPath>`;
  const plotted: string[] = [];
  if (chart.kind === "scatter" || chart.kind === "line") {
    for (const series of chart.series) {
      const points = series.y.flatMap((point, index) => {
        const x = series.x[index];
        return point === null || x === null || x === undefined ? [] : [[x, point, index] as const];
      });
      if (series.line && points.length > 1) {
        const coordinates = points.map(([x, y]) => [xAt(x), valueAt(y)] as const);
        plotted.push(`<path d="${series.smooth ? smoothPath(coordinates) : coordinates.map(([x, y], index) => `${index ? "L" : "M"}${round(x)} ${round(y)}`).join("")}" fill="none" stroke="${series.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`);
      }
      for (const bars of series.errorBars) {
        const paths = points.map(([x, y, index]) => {
          const base = bars.direction === "y" ? y : x;
          const high = bars.type === "minus" ? base : base + Math.abs(bars.plus(index, base));
          const low = bars.type === "plus" ? base : base - Math.abs(bars.minus(index, base));
          return bars.direction === "y"
            ? `M${round(xAt(x))} ${round(valueAt(low))}L${round(xAt(x))} ${round(valueAt(high))}`
            : `M${round(xAt(low))} ${round(valueAt(y))}L${round(xAt(high))} ${round(valueAt(y))}`;
        });
        if (paths.length) plotted.push(`<path d="${paths.join("")}" stroke="${series.color}" stroke-width="1" fill="none"/>`);
      }
      if (series.marker !== "none" && points.length <= 5_000)
        plotted.push(`<g fill="${series.color}" stroke="${series.color}">${points.map(([x, y]) => markerPath(series.marker, xAt(x), valueAt(y), series.markerSize + 1)).join("")}</g>`);
    }
  }
  for (const series of chart.series) {
    for (const trendline of series.trendlines) {
      const points = series.y.flatMap((point, index) => {
        const x = categorical ? index + 1 : series.x[index];
        return point === null || x === null || x === undefined ? [] : [[x, point] as [number, number]];
      });
      const color = trendline.color ?? series.color;
      if (trendline.kind === "movingAvg") {
        const averaged = points.slice(trendline.period - 1).map((_point, index) => {
          const window = points.slice(index, index + trendline.period);
          return [window.at(-1)![0], window.reduce((sum, [, y]) => sum + y, 0) / window.length] as [number, number];
        });
        if (averaged.length > 1) plotted.push(`<path d="${averaged.map(([x, y], index) => `${index ? "L" : "M"}${round(xAt(categorical ? x - 1 : x))} ${round(valueAt(y))}`).join("")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
        continue;
      }
      const curve = trendCurve(trendline, points);
      if (!curve || points.length < 2) continue;
      const xs = points.map(([x]) => x);
      const from = Math.min(...xs);
      const to = Math.max(...xs);
      const steps = trendline.kind === "linear" ? 1 : 80;
      const path = Array.from({ length: steps + 1 }, (_step, index) => from + ((to - from) * index) / steps)
        .map((x) => [x, curve(x)] as const)
        .filter(([, y]) => Number.isFinite(y))
        .map(([x, y], index) => `${index ? "L" : "M"}${round(xAt(categorical ? x - 1 : x))} ${round(valueAt(y))}`)
        .join("");
      if (path) plotted.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    }
  }
  if (plotted.length) out.push(`<g clip-path="url(#plot)">${plotted.join("")}</g>`);

  const label = chart.title ?? chart.series.map((series) => series.name).join(", ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}" role="img" aria-label="${escapeXml(`Chart: ${label}`)}" font-family="${FONT}"><defs>${clip}</defs><rect width="100%" height="100%" fill="#FFFFFF"/>${out.join("")}</svg>`;
}

function trendlineName(trendline: Trendline) {
  return { linear: "Linear", exp: "Expon.", log: "Log.", poly: `Poly.`, power: "Power", movingAvg: `${trendline.period} per. Mov. Avg.` }[trendline.kind];
}

function legendKey(entry: { color: string; line: boolean; marker: Marker; bar: boolean }, x: number, y: number) {
  if (entry.bar) return `<rect x="${round(x + 4)}" y="${round(y - 5)}" width="10" height="10" fill="${entry.color}"/>`;
  const line = entry.line ? `<line x1="${round(x)}" y1="${round(y)}" x2="${round(x + 18)}" y2="${round(y)}" stroke="${entry.color}" stroke-width="2.25"/>` : "";
  const marker = entry.marker !== "none" ? `<g fill="${entry.color}" stroke="${entry.color}">${markerPath(entry.marker, x + 9, y, 6)}</g>` : "";
  return line + marker;
}

/** A Catmull-Rom curve through the points, as Word smooths a line. */
function smoothPath(points: ReadonlyArray<readonly [number, number]>) {
  if (points.length < 3) return points.map(([x, y], index) => `${index ? "L" : "M"}${round(x)} ${round(y)}`).join("");
  let path = `M${round(points[0]![0])} ${round(points[0]![1])}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[index + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    path += `C${round(c1[0]!)} ${round(c1[1]!)} ${round(c2[0]!)} ${round(c2[1]!)} ${round(p2[0])} ${round(p2[1])}`;
  }
  return path;
}

/** The chart part as an SVG picture at the given size, or a frame saying to edit it in Word. */
export function renderWordChartSvg(xml: string, width: number, height: number) {
  const chart = parseWordChart(xml);
  return chart ? wordChartSvg(chart, width, height) : chartPlaceholderSvg(width, height);
}
