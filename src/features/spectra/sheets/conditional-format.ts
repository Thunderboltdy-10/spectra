import {
  normalizeRange,
  parseRange,
  rangeAddresses,
  type SheetScalar,
  type SheetConditionalFormat,
} from "./model";

/*
 * Conditional formats, evaluated once for every surface that draws a sheet:
 * the editor's grid and the read-only Office viewer. Rules apply in Excel's
 * order (lowest priority number first); the first rule to set a property on a
 * cell keeps it, and `stopIfTrue` ends the walk for that cell. Colours are any
 * CSS colour, a workbook's `#RRGGBB` or a design token, so scales blend with
 * `color-mix` rather than parsing hex.
 */

export type ConditionalCellStyle = {
  backgroundColor?: string;
  color?: string;
  /** A data bar: its colour and how much of the cell it fills, 0–1. */
  bar?: { color: string; ratio: number };
};

/** How far one rule reads. A rule over more cells than this is not drawn. */
export const CONDITIONAL_FORMAT_CELL_LIMIT = 20_000;

type Bounds = { rows: number; columns: number };

function percent(amount: number) {
  return Math.round(Math.max(0, Math.min(1, amount)) * 1000) / 10;
}

/** `amount` of the way from `start` to `end`, as a CSS colour. */
export function blendColors(start: string, end: string, amount: number) {
  const share = percent(amount);
  if (share <= 0) return start;
  if (share >= 100) return end;
  return `color-mix(in srgb, ${end} ${share}%, ${start})`;
}

function percentile(sorted: readonly number[], fraction: number) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function scaleColor(rule: Extract<SheetConditionalFormat, { kind: "color_scale" }>, value: number, sorted: readonly number[]) {
  const minimum = sorted[0]!;
  const maximum = sorted.at(-1)!;
  if (maximum === minimum) return rule.midpointColor ?? rule.maximumColor;
  if (!rule.midpointColor) return blendColors(rule.minimumColor, rule.maximumColor, (value - minimum) / (maximum - minimum));
  const middle = percentile(sorted, 0.5);
  if (value <= middle)
    return middle === minimum ? rule.midpointColor : blendColors(rule.minimumColor, rule.midpointColor, (value - minimum) / (middle - minimum));
  return maximum === middle ? rule.midpointColor : blendColors(rule.midpointColor, rule.maximumColor, (value - middle) / (maximum - middle));
}

function cellIsMatches(rule: Extract<SheetConditionalFormat, { kind: "cell_is" }>, value: number) {
  const second = rule.secondValue ?? rule.value;
  switch (rule.operator) {
    case "greater_than": return value > rule.value;
    case "less_than": return value < rule.value;
    case "greater_equal": return value >= rule.value;
    case "less_equal": return value <= rule.value;
    case "not_equal_to": return value !== rule.value;
    case "between": return value >= Math.min(rule.value, second) && value <= Math.max(rule.value, second);
    default: return value === rule.value;
  }
}

/**
 * The style every formatted cell takes. `resolve` gives a cell's shown value
 * (a formula's result, not its text); `bounds` clamps a rule to the part of
 * the sheet in use, so a rule over a whole column reads only real rows.
 */
export function conditionalFormatStyles(
  rules: readonly SheetConditionalFormat[] | undefined,
  resolve: (address: string) => SheetScalar | undefined,
  bounds?: Bounds,
): Map<string, ConditionalCellStyle> {
  const styles = new Map<string, ConditionalCellStyle>();
  const stopped = new Set<string>();
  const ordered = (rules ?? [])
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => (left.rule.priority ?? Number.MAX_SAFE_INTEGER) - (right.rule.priority ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ rule }) => rule);
  for (const rule of ordered) {
    const parsed = parseRange(rule.range);
    if (!parsed) continue;
    const range = normalizeRange(parsed);
    if (bounds) {
      range.end = { row: Math.min(range.end.row, bounds.rows - 1), column: Math.min(range.end.column, bounds.columns - 1) };
      if (range.end.row < range.start.row || range.end.column < range.start.column) continue;
    }
    const area = (range.end.row - range.start.row + 1) * (range.end.column - range.start.column + 1);
    if (area > CONDITIONAL_FORMAT_CELL_LIMIT) continue;
    const entries = rangeAddresses(range).flatMap((address) => {
      if (stopped.has(address)) return [];
      const value = resolve(address);
      return value === undefined || value === null || value === "" ? [] : [{ address, value }];
    });
    const apply = (address: string, style: ConditionalCellStyle) => {
      const current = styles.get(address) ?? {};
      styles.set(address, {
        ...style,
        ...current,
      });
      if (rule.stopIfTrue) stopped.add(address);
    };
    if (rule.kind === "text_contains") {
      const needle = rule.text.toLowerCase();
      if (!needle) continue;
      for (const { address, value } of entries)
        if (String(value).toLowerCase().includes(needle))
          apply(address, { backgroundColor: rule.fillColor, ...(rule.textColor ? { color: rule.textColor } : {}) });
      continue;
    }
    const numeric = entries.flatMap(({ address, value }) =>
      typeof value === "number" && Number.isFinite(value) ? [{ address, value }] : [],
    );
    if (!numeric.length) continue;
    if (rule.kind === "color_scale") {
      const sorted = numeric.map((entry) => entry.value).sort((left, right) => left - right);
      for (const { address, value } of numeric) apply(address, { backgroundColor: scaleColor(rule, value, sorted) });
      continue;
    }
    if (rule.kind === "data_bar") {
      // Excel's default bar runs from the lowest value (or zero) to the
      // highest, and never draws a bar shorter than a tenth of the cell.
      const low = Math.min(0, ...numeric.map((entry) => entry.value));
      const high = Math.max(...numeric.map((entry) => entry.value));
      for (const { address, value } of numeric)
        apply(address, { bar: { color: rule.color, ratio: high === low ? 1 : 0.1 + 0.9 * ((value - low) / (high - low)) } });
      continue;
    }
    for (const { address, value } of numeric)
      if (cellIsMatches(rule, value))
        apply(address, { backgroundColor: rule.fillColor, ...(rule.textColor ? { color: rule.textColor } : {}) });
  }
  return styles;
}

/** The inline style a conditional format paints over a cell's own. */
export function conditionalCellCss(style: ConditionalCellStyle | undefined) {
  if (!style) return {};
  return {
    ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.bar
      ? {
          backgroundImage: `linear-gradient(90deg, ${style.bar.color}, color-mix(in srgb, ${style.bar.color} 25%, transparent))`,
          backgroundSize: `${percent(style.bar.ratio)}% 72%`,
          backgroundPosition: "left center",
          backgroundRepeat: "no-repeat",
        }
      : {}),
  };
}
