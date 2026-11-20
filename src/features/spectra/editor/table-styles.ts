export type TableLines = "grid" | "horizontal" | "outer" | "none";

/**
 * Ready-made looks for a whole table. Each sets the lines and every cell's
 * fill, so a table can be restyled in one step and Word draws it the same.
 * Plain data: the editor, the AI's Markdown and the server all read it.
 */
export const TABLE_STYLES = {
  grid: { label: "Grid", lines: "grid", header: null, band: null },
  header: { label: "Shaded header", lines: "grid", header: "#D9E2F3", band: null },
  banded: { label: "Banded rows", lines: "horizontal", header: "#D9E2F3", band: "#F2F2F2" },
  rows: { label: "Rows only", lines: "horizontal", header: null, band: null },
  outside: { label: "Outside only", lines: "outer", header: null, band: null },
  plain: { label: "No lines", lines: "none", header: null, band: null },
} as const satisfies Record<string, { label: string; lines: TableLines; header: string | null; band: string | null }>;

export type TableStyleName = keyof typeof TABLE_STYLES;
