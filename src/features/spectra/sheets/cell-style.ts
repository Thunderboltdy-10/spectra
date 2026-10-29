import type { CSSProperties } from "react";
import type { SheetBorderEdge, SheetCell } from "./model";

/*
 * How a cell's stored format paints, shared by the Sheets grid and the
 * read-only workbook viewer so a file looks the same in both.
 */

/** CSS for one border edge, or nothing when the edge is unset. */
function borderCss(edge: SheetBorderEdge | null | undefined) {
  if (!edge) return undefined;
  const width =
    edge.style === "thick"
      ? "3px"
      : edge.style === "medium" || edge.style === "double"
        ? "2px"
        : "1px";
  const line =
    edge.style === "dashed"
      ? "dashed"
      : edge.style === "dotted" || edge.style === "hair"
        ? "dotted"
        : edge.style === "double"
          ? "double"
          : "solid";
  return `${width} ${line} ${edge.color ?? "var(--text-primary)"}`;
}

/**
 * Everything a cell's stored format asks the grid to paint.
 *
 * This used to be an inline object that honoured eight of the sixteen fields the
 * model can hold, so a border, a rotation, a wrap or a real font stack was
 * stored, exported and never drawn — the format commands wrote state nothing
 * could see. One helper now covers every field, which also means a fixture can
 * assert what a format command does without mounting the grid.
 */
export function cellVisualStyle(
  format: SheetCell["format"],
  zoom: number,
): CSSProperties {
  // Text sits on the cell's floor unless told otherwise, as the toolbar says.
  if (!format) return { alignItems: "flex-end" };
  const borders = format.borders;
  const decoration = [
    format.underline ? "underline" : null,
    format.strike ? "line-through" : null,
  ].filter(Boolean);
  return {
    fontWeight: format.bold ? 700 : undefined,
    fontStyle: format.italic ? "italic" : undefined,
    textDecoration: decoration.length ? decoration.join(" ") : undefined,
    textAlign: format.align,
    alignItems:
      format.verticalAlign === "top"
        ? "flex-start"
        : format.verticalAlign === "middle"
          ? "center"
          : "flex-end",
    justifyContent:
      format.align === "center"
        ? "center"
        : format.align === "right"
          ? "flex-end"
          : undefined,
    whiteSpace: format.wrap ? "pre-wrap" : undefined,
    // Wrapped text needs a line box narrower than the cell to break inside it.
    lineHeight: format.wrap ? 1.25 : undefined,
    paddingLeft: format.indent ? 8 + format.indent * 8 : undefined,
    // Rotation is stated the way the Excel dialog states it: positive is
    // counter-clockwise, which is the opposite sign to CSS.
    transform: format.rotation ? `rotate(${-format.rotation}deg)` : undefined,
    fontFamily:
      format.fontFamily === "serif"
        ? "var(--font-serif), ui-sans-serif, system-ui, sans-serif"
        : format.fontFamily === "mono"
          ? "ui-monospace, SFMono-Regular, Consolas, monospace"
          : format.fontFamily === "sans"
            ? "var(--font-sans), ui-sans-serif, system-ui, sans-serif"
            : format.fontFamily,
    fontSize: format.fontSize ? format.fontSize * zoom : undefined,
    borderTop: borderCss(borders?.top),
    borderRight: borderCss(borders?.right),
    borderBottom: borderCss(borders?.bottom),
    borderLeft: borderCss(borders?.left),
  };
}
