import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CellSelection } from "@tiptap/pm/tables";

import { TABLE_STYLES, type TableLines, type TableStyleName } from "./table-styles";

export { TABLE_STYLES, type TableLines, type TableStyleName };

const HEX = /^#[0-9a-f]{6}$/i;

/** The table the caret or cell selection is in, with its position. */
export function tableAtSelection(editor: Editor): { node: ProseMirrorNode; position: number } | undefined {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "table") return { node, position: $from.before(depth) };
  }
  return undefined;
}

/** How the table's lines are drawn now, as the editor shows them. */
export function tableLines(node: ProseMirrorNode): TableLines {
  if (["grid", "horizontal", "outer", "none"].includes(node.attrs.lines)) return node.attrs.lines;
  return node.attrs.borderless ? "none" : "grid";
}

/** The fill of the cell at the caret, or of every selected cell when they share one. */
export function selectedCellFill(editor: Editor): string | undefined {
  const fills = new Set<string | null>();
  const selection = editor.state.selection;
  if (selection instanceof CellSelection) selection.forEachCell((cell) => fills.add(cell.attrs.background ?? null));
  else {
    const { $from } = selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        fills.add(node.attrs.background ?? null);
        break;
      }
    }
  }
  const [fill] = fills;
  return fills.size === 1 && typeof fill === "string" ? fill : undefined;
}

/** Sets the table's lines and their colour, in one undoable step. */
export function setTableLines(editor: Editor, change: { lines?: TableLines; lineColor?: string | null }) {
  const table = tableAtSelection(editor);
  if (!table) return false;
  const lines = change.lines ?? tableLines(table.node);
  const lineColor = change.lineColor === undefined ? table.node.attrs.lineColor : change.lineColor && HEX.test(change.lineColor) ? change.lineColor : null;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(table.position, undefined, {
    ...table.node.attrs,
    lines,
    lineColor,
    borderless: lines === "none",
  }));
  return true;
}

/** Fills the selected cells (or the caret's cell); null clears the fill. */
export function setCellFill(editor: Editor, color: string | null) {
  const table = tableAtSelection(editor);
  if (!table) return false;
  const fill = color && HEX.test(color) ? color.toUpperCase() : null;
  const transaction = editor.state.tr;
  const selection = editor.state.selection;
  const cells: number[] = [];
  if (selection instanceof CellSelection) selection.forEachCell((_cell, position) => cells.push(position));
  else {
    const { $from } = selection;
    for (let depth = $from.depth; depth > 0; depth -= 1)
      if (["tableCell", "tableHeader"].includes($from.node(depth).type.name)) {
        cells.push($from.before(depth));
        break;
      }
  }
  for (const position of cells) {
    const cell = transaction.doc.nodeAt(position);
    if (cell) transaction.setNodeMarkup(position, undefined, { ...cell.attrs, background: fill });
  }
  // The table now says what its fills are, so clearing the last one reaches Word too.
  const tableNode = transaction.doc.nodeAt(table.position);
  if (tableNode && !tableNode.attrs.fillsSet)
    transaction.setNodeMarkup(table.position, undefined, { ...tableNode.attrs, fillsSet: true });
  editor.view.dispatch(transaction);
  return true;
}

/** Gives the whole table one of the ready-made looks. */
export function applyTableStyle(editor: Editor, name: string) {
  const style = TABLE_STYLES[name as TableStyleName];
  const table = tableAtSelection(editor);
  if (!style || !table) return false;
  const transaction = editor.state.tr;
  let bodyRow = 0;
  table.node.forEach((row, rowOffset, rowIndex) => {
    const header = rowIndex === 0 && row.firstChild?.type.name === "tableHeader";
    const fill = header ? style.header : style.band && bodyRow % 2 === 1 ? style.band : null;
    if (!header) bodyRow += 1;
    row.forEach((cell, cellOffset) => {
      const position = table.position + 1 + rowOffset + 1 + cellOffset;
      transaction.setNodeMarkup(position, undefined, { ...cell.attrs, background: fill });
    });
  });
  transaction.setNodeMarkup(table.position, undefined, {
    ...table.node.attrs,
    lines: style.lines,
    lineColor: null,
    borderless: style.lines === "none",
    fillsSet: true,
  });
  editor.view.dispatch(transaction);
  return true;
}
