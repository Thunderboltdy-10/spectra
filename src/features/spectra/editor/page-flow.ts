import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/*
 * The words onto the next sheet, on the page view (spectra-document-desk.css
 * draws the sheets). After each layout the blocks are measured, and where one
 * crosses a sheet's bottom margin a gap carries the rest to the top of the
 * next sheet, as Word lays out a page:
 *
 * - A paragraph is split at the first line that doesn't fit, by a full-width
 *   spacer at the start of that line. The line before still ends in a soft
 *   wrap, so justified text stays justified. Widow and orphan control keeps at
 *   least two lines on each side.
 * - A table is split between rows, and its header row is drawn again at the
 *   top of the next sheet.
 * - A heading keeps with the first line after it; a page break, and a
 *   paragraph that starts a new page, start a new sheet.
 * - Anything else that doesn't fit moves whole to the next sheet. A block
 *   taller than a sheet stays where it is, as a picture does in Word until it
 *   is made smaller.
 *
 * The gaps are decorations, so the document itself never changes and
 * collaborators see their own breaks.
 */

const PX_PER = { mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, px: 1 } as const;
/** Gaps closer than this to the ones in place are the same layout. */
const SETTLED_PX = 1;

/** A CSS length such as `297mm`, in CSS pixels; 0 when it is not one. */
export function lengthPx(value: string) {
  const match = /^\s*([\d.]+)\s*(mm|cm|in|pt|px)\s*$/.exec(value);
  return match ? Number(match[1]) * PX_PER[match[2] as keyof typeof PX_PER] : 0;
}

/**
 * A gap before a block, inside a paragraph at the start of a line, or before
 * a table row (with the header row drawn again under it).
 */
export type Gap =
  | { kind: "block"; pos: number; height: number }
  | { kind: "line"; pos: number; height: number }
  | { kind: "row"; pos: number; height: number; columns: number; header?: { pos: number; key: string } };

type PageFlowState = { gaps: Gap[]; decorations: DecorationSet };
const pageFlowKey = new PluginKey<PageFlowState>("pageFlow");

function blockGap(height: number) {
  const element = document.createElement("div");
  element.className = "page-flow-gap";
  element.style.height = `${height}px`;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function lineGap(height: number) {
  const element = document.createElement("span");
  element.className = "page-flow-gap page-flow-line-gap";
  element.style.height = `${height}px`;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function rowGap(height: number, columns: number) {
  const row = document.createElement("tr");
  row.className = "page-flow-gap page-flow-row-gap";
  row.setAttribute("aria-hidden", "true");
  const cell = document.createElement("td");
  cell.colSpan = Math.max(1, columns);
  cell.style.height = `${height}px`;
  row.append(cell);
  return row;
}

/** The header row drawn again at the top of a sheet; a picture of it, never edited there. */
function repeatedHeader(view: EditorView, pos: number) {
  const source = view.nodeDOM(pos);
  const row = source instanceof HTMLElement ? (source.cloneNode(true) as HTMLElement) : document.createElement("tr");
  row.classList.add("page-flow-gap", "page-flow-header-repeat");
  row.setAttribute("aria-hidden", "true");
  for (const element of [row, ...row.querySelectorAll<HTMLElement>("[contenteditable], [id]")]) {
    element.removeAttribute("id");
    element.removeAttribute("contenteditable");
  }
  return row;
}

function decorate(state: EditorState, view: EditorView | null, gaps: Gap[]) {
  const decorations: Decoration[] = [];
  for (const gap of gaps) {
    const size = gap.height.toFixed(1);
    if (gap.kind === "block") {
      decorations.push(Decoration.widget(gap.pos, () => blockGap(gap.height), { side: -1, key: `page-gap-${size}`, ignoreSelection: true }));
    } else if (gap.kind === "line") {
      decorations.push(
        Decoration.widget(gap.pos, () => lineGap(gap.height), { side: -1, key: `page-line-${size}`, ignoreSelection: true, marks: [] }),
      );
    } else {
      decorations.push(
        Decoration.widget(gap.pos, () => rowGap(gap.height, gap.columns), { side: -2, key: `page-row-${size}-${gap.columns}`, ignoreSelection: true }),
      );
      const header = gap.header;
      if (header && view)
        decorations.push(
          Decoration.widget(gap.pos, () => repeatedHeader(view, header.pos), { side: -1, key: `page-head-${header.key}`, ignoreSelection: true }),
        );
    }
  }
  return DecorationSet.create(state.doc, decorations);
}

type Line = { top: number; bottom: number; rawTop: number; rawBottom: number; textblock: { pos: number; node: ProseMirrorNode }; index: number };

/** The sheets: their height, margins and how the page view is scaled. */
type Sheets = { sheet: number; marginTop: number; marginBottom: number; usable: number };

const pageOf = (sheets: Sheets, y: number) => Math.floor(y / sheets.sheet);
/** Where the writing area of the sheet holding `y` ends. */
const endOf = (sheets: Sheets, y: number) => (pageOf(sheets, y) + 1) * sheets.sheet - sheets.marginBottom;
/** Where the next sheet's writing starts. */
const nextTop = (sheets: Sheets, y: number) => (pageOf(sheets, y) + 1) * sheets.sheet + sheets.marginTop;
/** True when `y` is already the top of a sheet's writing. */
const atSheetTop = (sheets: Sheets, y: number) => y <= pageOf(sheets, y) * sheets.sheet + sheets.marginTop + 0.5;
/** True when a box from `top` to `bottom` crosses the end of its sheet's writing, or starts past it. */
const overflows = (sheets: Sheets, top: number, bottom: number) => {
  const end = endOf(sheets, top);
  return top >= end - 0.5 || bottom > end + 0.5;
};

/** Where each block lands on the sheets, and the gaps that carry the words over. */
export function measureGaps(view: EditorView): Gap[] {
  const surface = view.dom as HTMLElement;
  if (!surface.closest("[data-layout='page']")) return [];
  const style = getComputedStyle(surface);
  const sheet = lengthPx(style.getPropertyValue("--spectra-page-height"));
  if (!sheet) return [];
  // Word's top and bottom margins need not match.
  const marginTop = parseFloat(style.paddingTop) || 0;
  const marginBottom = parseFloat(style.paddingBottom) || 0;
  const sheets: Sheets = { sheet, marginTop, marginBottom, usable: sheet - marginTop - marginBottom };
  if (sheets.usable <= 0) return [];
  const page = surface.closest<HTMLElement>(".document-page");
  const scale = (page && Number(getComputedStyle(page).zoom)) || 1;
  const origin = surface.getBoundingClientRect().top;
  const local = (y: number) => (y - origin) / scale;

  // The gaps in place now, so every measure reads as if they were not there.
  const placed = [...surface.querySelectorAll<HTMLElement>(".page-flow-gap")]
    .map((element) => {
      const box = element.getBoundingClientRect();
      return { top: local(box.top), height: box.height / scale };
    })
    .filter((gap) => gap.height > 0)
    .sort((left, right) => left.top - right.top);
  const unshift = (y: number) => {
    let removed = 0;
    for (const gap of placed) {
      if (gap.top + gap.height > y + 0.5) break;
      removed += gap.height;
    }
    return y - removed;
  };
  const isPlaced = (top: number, height: number) =>
    placed.some((gap) => Math.abs(gap.top - top) < 0.5 && Math.abs(gap.height - height) < 0.5);

  /** Every line of the text in `node` at `pos`, as laid out now. */
  const linesOf = (node: ProseMirrorNode, pos: number, added: number): Line[] => {
    const textblocks: Array<{ pos: number; node: ProseMirrorNode }> = [];
    if (node.isTextblock) textblocks.push({ pos, node });
    else
      node.descendants((child, offset) => {
        if (child.isTextblock) {
          textblocks.push({ pos: pos + 1 + offset, node: child });
          return false;
        }
        // A table inside a list or a quote moves as a whole.
        return child.type.name !== "table";
      });
    const lines: Line[] = [];
    for (const textblock of textblocks) {
      const element = view.nodeDOM(textblock.pos);
      if (!(element instanceof HTMLElement) || !textblock.node.content.size) continue;
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()]
        .map((rect) => ({ top: local(rect.top), bottom: local(rect.bottom) }))
        .filter((rect) => rect.bottom - rect.top > 0.5 && !isPlaced(rect.top, rect.bottom - rect.top))
        .sort((left, right) => left.top - right.top);
      const own: Array<{ top: number; bottom: number }> = [];
      for (const rect of rects) {
        const line = own.at(-1);
        // Boxes on one line overlap it; a box starting below its middle is the next line.
        if (line && rect.top < (line.top + line.bottom) / 2) line.bottom = Math.max(line.bottom, rect.bottom);
        else own.push({ ...rect });
      }
      own.forEach((line, index) =>
        lines.push({
          rawTop: line.top,
          rawBottom: line.bottom,
          top: unshift(line.top) + added,
          bottom: unshift(line.bottom) + added,
          textblock,
          index,
        }),
      );
    }
    return lines;
  };

  /** The document position where a laid-out line starts. */
  const lineStart = (line: Line) => {
    const start = line.textblock.pos + 1;
    const end = line.textblock.pos + line.textblock.node.nodeSize - 1;
    let low = start;
    let high = end;
    // The first position drawn on this line or below it.
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      let top: number;
      try {
        top = local(view.coordsAtPos(middle, 1).top);
      } catch {
        return null;
      }
      if (top >= line.rawTop - 1) high = middle;
      else low = middle + 1;
    }
    return low > start && low < end ? low : null;
  };

  /** Before the list item a paragraph opens, or before the paragraph itself. */
  const itemStart = (pos: number) => {
    const $pos = view.state.doc.resolve(pos);
    return $pos.depth > 0 && $pos.index() === 0 && /Item$/.test($pos.parent.type.name) ? $pos.before() : pos;
  };

  const gaps: Gap[] = [];
  let added = 0;
  let startNextSheet = false;
  const blocks: Array<{ node: ProseMirrorNode; pos: number }> = [];
  view.state.doc.forEach((node, pos) => blocks.push({ node, pos }));

  blocks.forEach(({ node, pos }, index) => {
    const element = view.nodeDOM(pos);
    if (!(element instanceof HTMLElement)) return;
    const box = element.getBoundingClientRect();
    let top = unshift(local(box.top)) + added;
    const height = box.height / scale;
    const pushWhole = () => {
      if (atSheetTop(sheets, top)) return false;
      const gap = nextTop(sheets, top) - top;
      if (gap <= 0.5) return false;
      gaps.push({ kind: "block", pos, height: gap });
      added += gap;
      top += gap;
      return true;
    };

    // A page break, or a paragraph that starts a new page.
    const breaks = node.type.name === "pageBreak" || node.attrs.pageBreak === true || node.type.name === "sectionBreak";
    if (startNextSheet || node.attrs.pageBreakBefore === true) pushWhole();
    startNextSheet = breaks;
    if (breaks) return;

    let bottom = top + height;
    if (!overflows(sheets, top, bottom)) {
      // A heading keeps with the first line of what follows it.
      if (node.type.name === "heading") {
        const next = blocks[index + 1];
        const nextElement = next && view.nodeDOM(next.pos);
        if (next && nextElement instanceof HTMLElement && next.node.type.name !== "pageBreak") {
          const firstLine = linesOf(next.node, next.pos, added)[0];
          const nextBox = nextElement.getBoundingClientRect();
          const nextTopY = unshift(local(nextBox.top)) + added;
          const firstBottom = firstLine?.bottom ?? nextTopY + Math.min(nextBox.height / scale, 24);
          if (overflows(sheets, top, firstBottom) && firstBottom - top <= sheets.usable) pushWhole();
        }
      }
      return;
    }

    // Starts inside the bottom margin: the whole block goes over.
    if (top >= endOf(sheets, top) - 0.5) {
      if (height <= sheets.usable || atSheetTop(sheets, nextTop(sheets, top))) pushWhole();
      return;
    }

    if (node.type.name === "table") {
      splitTable(node, pos);
      return;
    }

    const splittable = node.type.name === "paragraph" || ["bulletList", "orderedList", "taskList", "blockquote", "callout"].includes(node.type.name);
    if (!splittable || !splitLines(node, pos)) {
      if (height <= sheets.usable) pushWhole();
    }
    bottom = top + height;

    /**
     * Splits a paragraph (or a list's paragraphs) at the first line that doesn't
     * fit, and again on each sheet after. True when its lines are placed: split,
     * or all on this sheet with only the space after them running into the
     * margin, which Word drops at the foot of a page.
     */
    function splitLines(node: ProseMirrorNode, pos: number) {
      const lines = linesOf(node, pos, added);
      if (!lines.length) return false;
      let shift = 0;
      let split = false;
      // The last line moved to a sheet's top: a line that still doesn't fit
      // after it (taller than a sheet) runs over rather than breaking again.
      let lastBreak = -1;
      let overflowed = false;
      for (let at = 0; at < lines.length; at += 1) {
        const line = lines[at]!;
        if (!overflows(sheets, line.top + shift, line.bottom + shift)) continue;
        overflowed = true;
        // Widow and orphan control: never one line alone at the foot or the head of a sheet.
        const own = lines.filter((other) => other.textblock === line.textblock);
        const first = lines.indexOf(own[0]!);
        let breakAt = at;
        if (own.length >= 3 && first + own.length - breakAt === 1) breakAt -= 1;
        if (breakAt - first === 1) breakAt = first;
        if (breakAt <= lastBreak) continue;
        const target = lines[breakAt]!;
        const targetTop = target.top + shift;
        if (breakAt === 0) {
          // Nothing of this block fits: it goes over whole, then splits again if it must.
          if (!split && pushWhole()) {
            shift += gaps.at(-1)!.height;
            split = true;
            lastBreak = 0;
            at = -1;
          }
          continue;
        }
        // A whole paragraph goes over with its bullet: the gap goes before its list item.
        const startPos = breakAt === first ? itemStart(target.textblock.pos) : lineStart(target);
        if (startPos === null) continue;
        const gap = Math.max(nextTop(sheets, targetTop) - targetTop, target.bottom - target.top);
        if (gap <= 0.5) continue;
        gaps.push({ kind: breakAt === first ? "block" : "line", pos: startPos, height: gap });
        lastBreak = breakAt;
        shift += gap;
        added += gap;
        split = true;
        at = breakAt;
      }
      return split || !overflowed;
    }

    /** Splits a table between rows, drawing its header row again at the top of the next sheet. */
    function splitTable(table: ProseMirrorNode, pos: number) {
      const rows: Array<{ node: ProseMirrorNode; pos: number; top: number; bottom: number; columns: number }> = [];
      table.forEach((row, offset) => {
        const rowPos = pos + 1 + offset;
        const rowElement = view.nodeDOM(rowPos);
        if (!(rowElement instanceof HTMLElement)) return;
        const rowBox = rowElement.getBoundingClientRect();
        let columns = 0;
        for (const cell of rowElement.children) columns += (cell as HTMLTableCellElement).colSpan || 1;
        rows.push({
          node: row,
          pos: rowPos,
          top: unshift(local(rowBox.top)) + added,
          bottom: unshift(local(rowBox.bottom)) + added,
          columns,
        });
      });
      if (!rows.length) return;
      const headed = rows[0]!.node.firstChild?.type.name === "tableHeader" && rows.length > 1;
      const headerHeight = headed ? rows[0]!.bottom - rows[0]!.top : 0;
      const header = headed ? { pos: rows[0]!.pos, key: `${rows[0]!.node.textContent.length}-${hash(rows[0]!.node.textContent)}` } : undefined;
      let shift = 0;
      let rowsOnSheet = 0;
      for (let at = 0; at < rows.length; at += 1) {
        const row = rows[at]!;
        const rowTop = row.top + shift;
        const rowBottom = row.bottom + shift;
        if (!overflows(sheets, rowTop, rowBottom)) {
          if (!(headed && at === 0)) rowsOnSheet += 1;
          continue;
        }
        if (rowBottom - rowTop > sheets.usable - headerHeight) {
          rowsOnSheet += 1;
          continue;
        }
        if (rowsOnSheet === 0 && shift === 0) {
          // Not even the first row fits under the header: the table starts on the next sheet.
          if (pushWhole()) {
            shift += gaps.at(-1)!.height;
            at -= 1;
          }
          continue;
        }
        const gap = nextTop(sheets, rowTop) - rowTop;
        gaps.push({ kind: "row", pos: row.pos, height: gap, columns: row.columns, ...(header ? { header } : {}) });
        shift += gap + headerHeight;
        added += gap + headerHeight;
        rowsOnSheet = 1;
      }
    }
  });
  return gaps;
}

function hash(text: string) {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) | 0;
  return (value >>> 0).toString(36);
}

function settled(a: Gap[], b: Gap[]) {
  return (
    a.length === b.length &&
    a.every((gap, index) => {
      const other = b[index]!;
      return (
        gap.kind === other.kind &&
        gap.pos === other.pos &&
        Math.abs(gap.height - other.height) < SETTLED_PX &&
        (gap.kind !== "row" || (other.kind === "row" && gap.header?.key === other.header?.key))
      );
    })
  );
}

export const PageFlow = Extension.create({
  name: "pageFlow",
  addProseMirrorPlugins() {
    let flowView: EditorView | null = null;
    return [
      new Plugin<PageFlowState>({
        key: pageFlowKey,
        state: {
          init: (_, state) => ({ gaps: [], decorations: DecorationSet.create(state.doc, []) }),
          apply(transaction, value, _old, state) {
            const next = transaction.getMeta(pageFlowKey) as Gap[] | undefined;
            if (next) return { gaps: next, decorations: decorate(state, flowView, next) };
            if (!transaction.docChanged) return value;
            const gaps = value.gaps.map((gap) => ({ ...gap, pos: transaction.mapping.map(gap.pos, -1) }));
            return { gaps, decorations: value.decorations.map(transaction.mapping, transaction.doc) };
          },
        },
        props: {
          decorations: (state) => pageFlowKey.getState(state)?.decorations,
        },
        view(view) {
          flowView = view;
          let frame = 0;
          const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              if (!view.dom.isConnected) return;
              const current = pageFlowKey.getState(view.state)?.gaps ?? [];
              const gaps = measureGaps(view);
              if (!settled(gaps, current)) view.dispatch(view.state.tr.setMeta(pageFlowKey, gaps).setMeta("addToHistory", false));
            });
          };
          // Words, pictures and fonts arriving, the window and the view changing all move the breaks.
          const resize = new ResizeObserver(measure);
          resize.observe(view.dom);
          view.dom.addEventListener("load", measure, true);
          document.fonts?.addEventListener?.("loadingdone", measure);
          measure();
          return {
            update(next, previous) {
              if (next.state.doc !== previous.doc) measure();
            },
            destroy() {
              cancelAnimationFrame(frame);
              resize.disconnect();
              view.dom.removeEventListener("load", measure, true);
              document.fonts?.removeEventListener?.("loadingdone", measure);
              flowView = null;
            },
          };
        },
      }),
    ];
  },
});
