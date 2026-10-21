import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/*
 * The words onto the next sheet, on the page view (spectra-document-desk.css
 * draws the sheets). After each layout the blocks are measured; one that
 * would run over a sheet's bottom margin, or start inside it, is moved to the
 * top of the next sheet by a gap set before it. The gaps are decorations, so
 * the document itself never changes and collaborators see their own breaks.
 * A block taller than a sheet stays where it is, as a picture does in Word
 * until it is made smaller.
 */

const PX_PER = { mm: 96 / 25.4, cm: 96 / 2.54, in: 96, px: 1 } as const;
/** Gaps closer than this to the ones in place are the same layout. */
const SETTLED_PX = 1;

/** A CSS length such as `297mm`, in CSS pixels; 0 when it is not one. */
export function lengthPx(value: string) {
  const match = /^\s*([\d.]+)\s*(mm|cm|in|px)\s*$/.exec(value);
  return match ? Number(match[1]) * PX_PER[match[2] as keyof typeof PX_PER] : 0;
}

type Gap = { pos: number; height: number };
type PageFlowState = { gaps: Gap[]; decorations: DecorationSet };
const pageFlowKey = new PluginKey<PageFlowState>("pageFlow");

function gapWidget(height: number) {
  const element = document.createElement("div");
  element.className = "page-flow-gap";
  element.style.height = `${height}px`;
  element.contentEditable = "false";
  element.setAttribute("aria-hidden", "true");
  return element;
}

function decorate(state: EditorState, gaps: Gap[]) {
  return DecorationSet.create(
    state.doc,
    gaps.map(({ pos, height }) =>
      Decoration.widget(pos, () => gapWidget(height), { side: -1, key: `page-gap-${height.toFixed(1)}` }),
    ),
  );
}

/** Where each block lands on the sheets, and the gaps that keep it whole. */
function measureGaps(view: EditorView, current: Gap[]): Gap[] {
  const surface = view.dom as HTMLElement;
  if (!surface.closest("[data-layout='page']")) return [];
  const style = getComputedStyle(surface);
  const sheet = lengthPx(style.getPropertyValue("--spectra-page-height"));
  if (!sheet) return [];
  const margin = parseFloat(style.paddingTop) || 0;
  const usable = sheet - 2 * margin;
  const page = surface.closest<HTMLElement>(".document-page");
  const scale = (page && Number(getComputedStyle(page).zoom)) || 1;
  const origin = surface.getBoundingClientRect().top;
  const placed = new Map(current.map((gap) => [gap.pos, gap.height]));

  const gaps: Gap[] = [];
  let removed = 0;
  let added = 0;
  view.state.doc.forEach((_node, pos) => {
    removed += placed.get(pos) ?? 0;
    const element = view.nodeDOM(pos);
    if (!(element instanceof HTMLElement)) return;
    const box = element.getBoundingClientRect();
    const top = (box.top - origin) / scale - removed + added;
    const bottom = (box.bottom - origin) / scale - removed + added;
    const end = (Math.floor(top / sheet) + 1) * sheet - margin;
    const runsOver = bottom > end + 0.5 && bottom - top <= usable;
    if (top < end - 0.5 && !runsOver) return;
    const height = end + 2 * margin - top;
    if (height <= 0.5) return;
    gaps.push({ pos, height });
    added += height;
  });
  return gaps;
}

function settled(a: Gap[], b: Gap[]) {
  return a.length === b.length && a.every((gap, index) => gap.pos === b[index]!.pos && Math.abs(gap.height - b[index]!.height) < SETTLED_PX);
}

export const PageFlow = Extension.create({
  name: "pageFlow",
  addProseMirrorPlugins() {
    return [
      new Plugin<PageFlowState>({
        key: pageFlowKey,
        state: {
          init: (_, state) => ({ gaps: [], decorations: DecorationSet.create(state.doc, []) }),
          apply(transaction, value, _old, state) {
            const next = transaction.getMeta(pageFlowKey) as Gap[] | undefined;
            if (next) return { gaps: next, decorations: decorate(state, next) };
            if (!transaction.docChanged) return value;
            const gaps = value.gaps.map((gap) => ({ ...gap, pos: transaction.mapping.map(gap.pos, -1) }));
            return { gaps, decorations: value.decorations.map(transaction.mapping, transaction.doc) };
          },
        },
        props: {
          decorations: (state) => pageFlowKey.getState(state)?.decorations,
        },
        view(view) {
          let frame = 0;
          const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              if (!view.dom.isConnected) return;
              const current = pageFlowKey.getState(view.state)?.gaps ?? [];
              const gaps = measureGaps(view, current);
              if (!settled(gaps, current)) view.dispatch(view.state.tr.setMeta(pageFlowKey, gaps).setMeta("addToHistory", false));
            });
          };
          // Words, pictures arriving, the window and the view changing all move the breaks.
          const resize = new ResizeObserver(measure);
          resize.observe(view.dom);
          view.dom.addEventListener("load", measure, true);
          measure();
          return {
            update(next, previous) {
              if (next.state.doc !== previous.doc) measure();
            },
            destroy() {
              cancelAnimationFrame(frame);
              resize.disconnect();
              view.dom.removeEventListener("load", measure, true);
            },
          };
        },
      }),
    ];
  },
});
