"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

/*
 * Pages side by side (Word's "Side to side"). The words flow down one page and
 * on to the next as columns of a single multi-column box, each column exactly
 * one page's text block, so the editor stays one ProseMirror and the caret,
 * selection and collaboration need nothing new. Behind the columns lie the
 * sheets of paper, one per column, and the whole spread is scaled so a page
 * fits the desk's height: as many pages show as the window has room for.
 *
 * spectra-document-desk.css lays the columns out from the same paper
 * variables the page view prints with.
 */

/** Desk showing between two sheets, before the spread is scaled. */
export const SPREAD_GAP = 32;
/** Below this a page is too small to write on; the desk scrolls instead. */
const MIN_ZOOM = 0.5;

export type DocumentSpread = { pages: number; zoom: number };
export type DocumentCanvas = "page" | "spread" | "continuous";

/**
 * How this person last looked at this document. A view, not the document's
 * setup: it stays on this device and the default is the continuous page.
 */
export function useDocumentCanvas(artifactId: string) {
  const key = `spectra.document-canvas.${artifactId}`;
  const [canvas, setCanvasState] = useState<DocumentCanvas>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === "page" || stored === "spread" ? stored : "continuous";
    } catch {
      return "continuous";
    }
  });
  const setCanvas = useCallback((next: DocumentCanvas) => {
    setCanvasState(next);
    try {
      if (next === "continuous") window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, next);
    } catch {
      // Storage can be unavailable; the view still changes for this visit.
    }
  }, [key]);
  return [canvas, setCanvas] as const;
}

export function useDocumentSpread(
  editor: Editor | null,
  desk: RefObject<HTMLElement | null>,
  enabled: boolean,
): DocumentSpread {
  const [spread, setSpread] = useState<DocumentSpread>({ pages: 1, zoom: 1 });
  const applied = useRef(spread.zoom);
  applied.current = spread.zoom;
  const remeasure = useRef<() => void>(undefined);

  useEffect(() => {
    const host = desk.current;
    if (!enabled || !editor || !host) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const surface = editor.view.dom as HTMLElement;
        // Rects are scaled by the zoom this hook applied; undo it to compare
        // against the page's own size.
        const scale = applied.current;
        const box = surface.getBoundingClientRect();
        const page = { width: box.width / scale, height: box.height / scale };
        if (!page.width || !page.height) return;
        let reach = 0;
        try {
          reach = (editor.view.coordsAtPos(editor.state.doc.content.size).left - box.left) / scale;
        } catch {
          reach = 0;
        }
        const pages = Math.max(1, Math.floor(reach / (page.width + SPREAD_GAP)) + 1);
        const style = getComputedStyle(host);
        const foot = host.querySelector<HTMLElement>(".document-page-foot");
        const room =
          host.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom) -
          (foot ? foot.offsetHeight + parseFloat(getComputedStyle(foot).marginTop) : 0);
        const zoom = fit(page, pages, {
          width: host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          height: room,
        });
        setSpread((current) => (current.pages === pages && current.zoom === zoom ? current : { pages, zoom }));
      });
    };
    // The spread changes with the words, the window, a picture arriving and
    // its own scale (type set smaller breaks its lines elsewhere).
    remeasure.current = measure;
    const surface = editor.view.dom;
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    editor.on("update", measure);
    surface.addEventListener("load", measure, true);
    void document.fonts?.ready.then(measure);
    measure();
    // A wheel scrolls down a page; on a spread, down the pages is sideways.
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (host.scrollWidth <= host.clientWidth) return;
      event.preventDefault();
      host.scrollLeft += event.deltaY;
    };
    host.addEventListener("wheel", wheel, { passive: false });
    // The caret brings its whole page into view, not only itself: writing at
    // the edge of a page half off the window is writing blind.
    const follow = () => {
      if (!editor.view.hasFocus()) return;
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const box = surface.getBoundingClientRect();
        const pitch = box.width + SPREAD_GAP * applied.current;
        const caret = editor.view.coordsAtPos(editor.state.selection.head);
        const sheet = host.querySelectorAll(".document-spread-sheet")[Math.floor((caret.left - box.left) / pitch)];
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        sheet?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: still ? "auto" : "smooth" });
      });
    };
    editor.on("selectionUpdate", follow);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      editor.off("update", measure);
      editor.off("selectionUpdate", follow);
      surface.removeEventListener("load", measure, true);
      host.removeEventListener("wheel", wheel);
      remeasure.current = undefined;
    };
  }, [desk, editor, enabled]);
  useEffect(() => remeasure.current?.(), [spread.zoom]);

  return spread;
}

/**
 * A page as tall as the desk allows; then, when the last page that fits is
 * mostly cut off, a little smaller still so it fits whole. The window shows
 * whole pages wherever it can, and the count follows the window.
 */
function fit(
  page: { width: number; height: number },
  pages: number,
  room: { width: number; height: number },
) {
  const round = (zoom: number) => Math.floor(zoom * 100) / 100;
  const tall = Math.min(1, Math.max(MIN_ZOOM, round(room.height / page.height)));
  const across = (room.width + SPREAD_GAP * tall) / ((page.width + SPREAD_GAP) * tall);
  const whole = Math.floor(across);
  if (pages <= whole || across - whole < 0.4) return tall;
  const snug = round(room.width / ((whole + 1) * page.width + whole * SPREAD_GAP));
  return snug >= Math.max(MIN_ZOOM, tall * 0.8) ? snug : tall;
}

/** The style that sizes the spread; the stylesheet does the arithmetic. */
export function spreadStyle(spread: DocumentSpread): CSSProperties {
  return {
    "--spread-pages": spread.pages,
    "--spread-gap": `${SPREAD_GAP}px`,
    "--spread-zoom": spread.zoom,
    zoom: spread.zoom,
  } as CSSProperties;
}

/**
 * The paper under the columns: one sheet per page, each carrying the running
 * head and foot and its folio, as printed.
 */
export function DocumentSpreadSheets({
  pages,
  header,
  footer,
}: {
  pages: number;
  header?: string;
  footer?: string;
}) {
  // A Word footer that is only a page field arrives as its printed number;
  // the folio already is that number, so it is not repeated as text.
  const running = footer && !/^\s*\d+\s*$/.test(footer) ? footer : undefined;
  return (
    <div className="document-spread-sheets" aria-hidden>
      {Array.from({ length: pages }, (_, index) => (
        <div
          key={index}
          className="document-spread-sheet"
          style={{ "--sheet": index } as CSSProperties}
        >
          {header ? <p data-slot="header">{header}</p> : null}
          <p data-slot="folio">
            {running ? <span>{running}</span> : null}
            {index + 1}
          </p>
        </div>
      ))}
    </div>
  );
}
