"use client";

import type { Editor } from "@tiptap/core";
import { Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useState, type RefObject } from "react";
import { lengthPx } from "../editor/page-flow";
import type { DocumentCanvas } from "./document-spread";

/*
 * The document's status rail: a line at the very foot of the studio with the
 * counts a writer checks (the page they are on, words, characters) and the
 * view (flowing like a note, pages like Word, or pages side by side), with the
 * zoom of the pages beside it. The view is how this person looks at the
 * document on this device, never the document's own setup.
 */

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const ZOOM_KEY = "spectra.document-zoom";

/** The pages the words fill; `current` is the one in view, when one page is. */
export type DocumentPageCount = { current?: number; total: number };

/** The zoom the pages are shown at, kept on this device for every document. */
export function useDocumentZoom() {
  const [zoom, setZoomState] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(ZOOM_KEY));
      return ZOOM_STEPS.includes(stored as (typeof ZOOM_STEPS)[number]) ? stored : 1;
    } catch {
      return 1;
    }
  });
  const setZoom = useCallback((next: number) => {
    setZoomState(next);
    try {
      if (next === 1) window.localStorage.removeItem(ZOOM_KEY);
      else window.localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Storage can be unavailable; the zoom still changes for this visit.
    }
  }, []);
  return [zoom, setZoom] as const;
}

function stepZoom(zoom: number, direction: 1 | -1) {
  const index = ZOOM_STEPS.findIndex((step) => step >= zoom);
  const at = index < 0 ? ZOOM_STEPS.length - 1 : index;
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, at + direction))];
  return next ?? zoom;
}

/**
 * How much smaller a sheet is drawn so it fits the desk's width, as in a side
 * panel: 1 when it fits as it is. The rail's zoom applies on top of it.
 */
export function useSheetFit(desk: RefObject<HTMLElement | null>, enabled: boolean) {
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const host = desk.current;
    if (!enabled || !host) {
      setFit(1);
      return;
    }
    const measure = () => {
      const style = getComputedStyle(host);
      const sheet = lengthPx(style.getPropertyValue("--spectra-page-width"));
      const room = host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const next = sheet && room > 0 ? Math.min(1, Math.floor((room / sheet) * 100) / 100) : 1;
      setFit((current) => (current === next ? current : next));
    };
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    measure();
    return () => resize.disconnect();
  }, [desk, enabled]);
  return fit;
}

/**
 * Pages on the page view: how many sheets the words fill and which one the
 * reader is looking at, from the paper's height and the desk's scroll.
 * Ctrl and the wheel zoom the pages there, as in Word.
 */
export function usePageCount(
  editor: Editor | null,
  desk: RefObject<HTMLElement | null>,
  enabled: boolean,
  /** The scale the sheet is drawn at; `zoom` is the step the wheel moves from. */
  scale: number,
  zoom: number,
  setZoom: (zoom: number) => void,
): { current: number; total: number } | null {
  const [count, setCount] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    const host = desk.current;
    if (!enabled || !editor || !host) {
      setCount(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Found on the desk rather than through the editor, which may not be mounted yet.
        const surface = host.querySelector<HTMLElement>(".ProseMirror");
        if (!surface) return;
        const style = getComputedStyle(surface);
        const sheet = lengthPx(style.getPropertyValue("--spectra-page-height"));
        if (!sheet) return;
        const top = surface.getBoundingClientRect().top;
        const last = surface.lastElementChild?.getBoundingClientRect().bottom ?? top;
        const written = (last - top) / scale + parseFloat(style.paddingBottom);
        const total = Math.max(1, Math.ceil(written / sheet));
        const view = host.getBoundingClientRect();
        const reading = (view.top + view.height * 0.35 - top) / scale;
        const current = Math.max(1, Math.min(total, Math.floor(reading / sheet) + 1));
        setCount((previous) =>
          previous?.current === current && previous.total === total ? previous : { current, total },
        );
      });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    // The paper grows with the words and with the gaps that carry them to the next sheet.
    const paper = host.querySelector(".document-page");
    if (paper) resize.observe(paper);
    host.addEventListener("scroll", measure, { passive: true });
    editor.on("update", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      host.removeEventListener("scroll", measure);
      editor.off("update", measure);
    };
  }, [desk, editor, enabled, scale]);

  useEffect(() => {
    const host = desk.current;
    if (!enabled || !host) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      setZoom(stepZoom(zoom, event.deltaY < 0 ? 1 : -1));
    };
    host.addEventListener("wheel", wheel, { passive: false });
    return () => host.removeEventListener("wheel", wheel);
  }, [desk, enabled, setZoom, zoom]);

  return count;
}

const VIEWS: { id: DocumentCanvas; label: string; hint: string }[] = [
  { id: "continuous", label: "Flowing", hint: "One open page that grows with the words" },
  { id: "page", label: "Pages", hint: "Sheets of paper, as printed" },
  { id: "spread", label: "Side by side", hint: "Pages laid next to each other" },
];

export function DocumentStatusRail({
  canvas,
  setCanvas,
  spreadReason,
  pages,
  words,
  characters,
  zoom,
  shownZoom,
  setZoom,
}: {
  canvas: DocumentCanvas;
  setCanvas: (canvas: DocumentCanvas) => void;
  /** Why pages side by side are not offered here, when they are not. */
  spreadReason?: string;
  pages: DocumentPageCount | null;
  words: number;
  characters: number;
  /** The zoom chosen here, and the scale the sheet is drawn at once fitted to the desk. */
  zoom: number;
  shownZoom: number;
  setZoom: (zoom: number) => void;
}) {
  const minutes = Math.round(words / 200);
  return (
    <footer className="document-rail" aria-label="Document status">
      <p className="document-rail-counts" aria-live="polite">
        {pages ? (
          <span>
            {pages.current ? `Page ${pages.current} of ${pages.total}` : `${pages.total} ${pages.total === 1 ? "page" : "pages"}`}
          </span>
        ) : null}
        <span title={minutes >= 1 ? `About ${minutes} min to read` : undefined}>
          {words.toLocaleString()} {words === 1 ? "word" : "words"}
        </span>
        <span data-count="characters">
          {characters.toLocaleString()} {characters === 1 ? "character" : "characters"}
        </span>
      </p>
      <div className="document-rail-view">
        {canvas === "page" ? (
          <div className="document-rail-zoom" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" disabled={zoom <= ZOOM_STEPS[0]} onClick={() => setZoom(stepZoom(zoom, -1))}>
              <Minus aria-hidden />
            </button>
            <button type="button" title="Back to 100%" onClick={() => setZoom(1)}>
              {Math.round(shownZoom * 100)}%
            </button>
            <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => setZoom(stepZoom(zoom, 1))}>
              <Plus aria-hidden />
            </button>
          </div>
        ) : null}
        <div className="document-rail-views" role="radiogroup" aria-label="View">
          {VIEWS.map((view) => {
            const unavailable = view.id === "spread" && spreadReason;
            return (
              <button
                key={view.id}
                type="button"
                role="radio"
                aria-checked={canvas === view.id}
                disabled={Boolean(unavailable)}
                title={unavailable || view.hint}
                onClick={() => setCanvas(view.id)}
              >
                {view.label}
              </button>
            );
          })}
        </div>
      </div>
    </footer>
  );
}
