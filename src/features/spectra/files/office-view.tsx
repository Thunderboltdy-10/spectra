"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { EmptyState, ProblemState } from "@/components/ui/page-state";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { SlideCanvas } from "../components/presentation-slide-canvas";
import { SpectraRichContent } from "../components/spectra-rich-content";
import type { SpectraArtifactAsset } from "../data/api";
import { launchFrom, useLifeLanding } from "../life/use-life";
import { presentationSlideLabel, type PresentationContent } from "../presentation/model";
import type { SpectraRichContentAst } from "../rich-content/ast";
import { cellVisualStyle } from "../sheets/cell-style";
import { columnName } from "../sheets/model";
import type { OfficeViewKind } from "./file-kind";
import { isPreviewMediaId, SHEET_PREVIEW_LIMITS, type OfficePreview, type OfficePreviewMedia, type SheetPreview, type SheetPreviewMerge, type SheetPreviewSheet } from "./office-preview";
import { loadOfficePreview, OfficePreviewRefusal } from "./office-preview-client";
import { OfficeGhost } from "./office-ghost";

/*
 * A Word, PowerPoint or Excel file, read-only inside Spectra (EDITORS.md,
 * "Shared rich content"): a document on the shared prose renderer, a deck as
 * thumbnails and the current slide, a workbook as a grid with its sheet tabs.
 * Loaded lazily by the file viewer, so the page that lists files never carries
 * the readers.
 */

type LoadState =
  | { status: "loading" }
  | { status: "ready"; preview: OfficePreview; urls: ReadonlyMap<string, string> }
  | { status: "refused"; message: string };

function objectUrls(media: readonly OfficePreviewMedia[]) {
  const urls = new Map<string, string>();
  if (typeof URL.createObjectURL !== "function") return urls;
  for (const item of media) urls.set(item.id, URL.createObjectURL(new Blob([item.bytes], { type: item.mediaType })));
  return urls;
}

export default function OfficeView({ kind, url, filename, bytes }: { kind: OfficeViewKind; url: string; filename: string; bytes?: number }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    loadOfficePreview({ kind, url, bytes }, controller.signal).then(
      (preview) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", preview, urls: objectUrls(preview.kind === "sheet" ? [] : preview.media) });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "refused", message: error instanceof OfficePreviewRefusal ? error.message : "Spectra couldn't read this file." });
      },
    );
    return () => controller.abort();
  }, [kind, url, bytes]);
  useEffect(() => {
    if (state.status !== "ready") return;
    return () => {
      for (const objectUrl of state.urls.values()) URL.revokeObjectURL(objectUrl);
    };
  }, [state]);

  if (state.status === "loading") return <OfficeGhost kind={kind} filename={filename} />;
  if (state.status === "refused")
    return <ProblemState compact title={`${filename} didn't show here.`} detail={`${state.message} Open it in a new tab instead.`} className="h-full" />;
  const { preview, urls } = state;
  if (preview.kind === "document") return <DocumentView ast={preview.ast} urls={urls} />;
  if (preview.kind === "slides") return <SlidesView deck={preview.deck} media={preview.media} urls={urls} />;
  return <WorkbookView workbook={preview} />;
}

/** Points each placeholder picture at its object URL. */
function withMedia<T>(value: T, urls: ReadonlyMap<string, string>): T {
  if (Array.isArray(value)) return value.map((item) => withMedia(item, urls)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, key === "url" && isPreviewMediaId(item) ? (urls.get(item) ?? "") : withMedia(item, urls)]),
  ) as T;
}

function DocumentView({ ast, urls }: { ast: SpectraRichContentAst; urls: ReadonlyMap<string, string> }) {
  const shown = useMemo(() => withMedia(ast, urls), [ast, urls]);
  return (
    <div className="file-viewer-document" data-file-view="document">
      {shown.blocks.length ? (
        <article className="file-viewer-page">
          <SpectraRichContent ast={shown} />
        </article>
      ) : (
        <EmptyState compact icon="document" title="This document is empty." />
      )}
    </div>
  );
}

function SlidesView({ deck, media, urls }: { deck: PresentationContent; media: readonly OfficePreviewMedia[]; urls: ReadonlyMap<string, string> }) {
  const assets = useMemo<SpectraArtifactAsset[]>(
    () => media.flatMap((item) => (urls.get(item.id) ? [{ assetId: item.id, status: "active", downloadUrl: urls.get(item.id), mediaType: item.mediaType } as SpectraArtifactAsset] : [])),
    [media, urls],
  );
  const [index, setIndex] = useState(0);
  // The first slide simply appears with the viewer; every later one grows out
  // of what was there or what was pressed (LIFE.md, shared elements).
  const [landing, setLanding] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLOListElement>(null);
  const count = deck.slides.length;
  const slide = deck.slides[Math.min(index, count - 1)];
  useLifeLanding(stageRef, landing);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    railRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView?.({ block: "nearest" });
  }, [index]);
  const go = useCallback(
    (next: number, from?: Element | null) => {
      const target = Math.max(0, Math.min(count - 1, next));
      if (target === index) return;
      launchFrom(from ?? stageRef.current);
      setIndex(target);
      setLanding(deck.slides[target]!.id);
    },
    [count, deck.slides, index],
  );
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Home") go(0);
    else if (event.key === "End") go(count - 1);
    else if (step[event.key]) go(index + step[event.key]!);
    else return;
    event.preventDefault();
  };
  if (!slide) return <EmptyState compact icon="slides" title="This deck has no slides." />;
  return (
    <div
      ref={rootRef}
      className="file-viewer-slides"
      data-file-view="slides"
      role="group"
      aria-roledescription="slides"
      aria-label="Slides. Use the arrow keys to move between them."
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <ol ref={railRef} className="file-viewer-slide-rail" aria-label="All slides">
        {deck.slides.map((candidate, position) => (
          <li key={candidate.id}>
            <button
              type="button"
              className="file-viewer-thumb"
              aria-current={position === index ? "true" : undefined}
              aria-label={`Slide ${position + 1}: ${presentationSlideLabel(candidate, position)}`}
              data-slide-hidden={candidate.hidden || undefined}
              onClick={(event) => go(position, event.currentTarget)}
            >
              <span aria-hidden className="file-viewer-thumb-number">{position + 1}</span>
              <span aria-hidden className="file-viewer-thumb-canvas">
                <SlideCanvas slide={candidate} deck={deck} assets={assets} readOnly compact />
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="file-viewer-slide-main">
        <div ref={stageRef} className="file-viewer-stage" data-slide-id={slide.id}>
          <SlideCanvas key={slide.id} slide={slide} deck={deck} assets={assets} readOnly compact showSlideNumber />
        </div>
        <div className="file-viewer-slide-bar">
          <IconButton icon="chevronLeft" label="Previous slide" shortcut="ArrowLeft" size="compact" disabled={index === 0} onClick={() => go(index - 1)} />
          <p aria-live="polite" className="text-caption tabular-nums text-[var(--text-secondary)]">
            Slide {index + 1} of {count}
          </p>
          <IconButton icon="chevronRight" label="Next slide" shortcut="ArrowRight" size="compact" disabled={index === count - 1} onClick={() => go(index + 1)} />
        </div>
        {slide.speakerNotes ? (
          <section className="file-viewer-notes" aria-label="Speaker notes">
            <h3 className="text-micro font-semibold text-[var(--text-secondary)]">Speaker notes</h3>
            <p className="whitespace-pre-wrap text-caption text-[var(--text-primary)]">{slide.speakerNotes}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** The grid's own default sizes, so a workbook reads the same here as in Sheets. */
const COLUMN_WIDTH = 122;
const ROW_HEIGHT = 31;
const HEADER_HEIGHT = 28;
const HEADER_WIDTH = 48;
const OVERSCAN = 240;

function offsets(count: number, size: (index: number) => number) {
  const starts = new Float64Array(count + 1);
  for (let index = 0; index < count; index += 1) starts[index + 1] = starts[index]! + size(index);
  return starts;
}

/** The first index whose span ends after `position`. */
function indexAt(starts: Float64Array, position: number) {
  let low = 0;
  let high = starts.length - 2;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (starts[middle + 1]! <= position) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low);
}

function WorkbookView({ workbook }: { workbook: SheetPreview }) {
  const [activeId, setActiveId] = useState(workbook.activeSheetId);
  const sheet = workbook.sheets.find((candidate) => candidate.id === activeId) ?? workbook.sheets[0];
  if (!sheet) return <EmptyState compact icon="sheet" title="This workbook has no visible sheets." />;
  const select = (id: string) => setActiveId(id);
  const onTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const position = workbook.sheets.indexOf(sheet);
    const next = event.key === "ArrowRight" ? position + 1 : event.key === "ArrowLeft" ? position - 1 : -2;
    const target = workbook.sheets[next];
    if (!target) return;
    event.preventDefault();
    select(target.id);
    [...event.currentTarget.querySelectorAll<HTMLElement>("[data-sheet-id]")].find((tab) => tab.dataset.sheetId === target.id)?.focus();
  };
  return (
    <div className="file-viewer-workbook" data-file-view="sheet">
      <SheetGrid key={sheet.id} sheet={sheet} />
      {sheet.clipped ? (
        <p role="note" className="file-viewer-clip-note">
          Showing the first {SHEET_PREVIEW_LIMITS.rows.toLocaleString("en-US")} rows and {SHEET_PREVIEW_LIMITS.columns} columns. Open it in a new tab to see the rest.
        </p>
      ) : null}
      <div role="tablist" aria-label="Sheets" className="file-viewer-sheet-tabs" onKeyDown={onTabKey}>
        {workbook.sheets.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            data-sheet-id={candidate.id}
            aria-selected={candidate.id === sheet.id}
            tabIndex={candidate.id === sheet.id ? 0 : -1}
            className="file-viewer-sheet-tab"
            style={candidate.tabColor ? ({ "--sheet-tab-colour": candidate.tabColor } as CSSProperties) : undefined}
            onClick={() => select(candidate.id)}
          >
            {candidate.name}
          </button>
        ))}
      </div>
    </div>
  );
}

type Viewport = { left: number; top: number; width: number; height: number };

function SheetGrid({ sheet }: { sheet: SheetPreviewSheet }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ left: 0, top: 0, width: 960, height: 640 });
  const hiddenRows = useMemo(() => new Set(sheet.hiddenRows), [sheet.hiddenRows]);
  const hiddenColumns = useMemo(() => new Set(sheet.hiddenColumns), [sheet.hiddenColumns]);
  const columns = useMemo(
    () => offsets(sheet.columnCount, (column) => (hiddenColumns.has(column) ? 0 : (sheet.columnWidths[String(column)] ?? COLUMN_WIDTH))),
    [hiddenColumns, sheet.columnCount, sheet.columnWidths],
  );
  const rows = useMemo(
    () => offsets(sheet.rowCount, (row) => (hiddenRows.has(row) ? 0 : (sheet.rowHeights[String(row)] ?? ROW_HEIGHT))),
    [hiddenRows, sheet.rowCount, sheet.rowHeights],
  );
  const frozenRows = Math.min(sheet.frozenRows, sheet.rowCount);
  const frozenColumns = Math.min(sheet.frozenColumns, sheet.columnCount);
  const frozenHeight = rows[frozenRows]!;
  const frozenWidth = columns[frozenColumns]!;
  // Every cell a merge covers, and the merge each anchor starts.
  const { covered, anchors } = useMemo(() => {
    const covered = new Set<string>();
    const anchors = new Map<string, SheetPreviewMerge>();
    for (const merge of sheet.merges) {
      anchors.set(`${merge.row}:${merge.column}`, merge);
      for (let row = merge.row; row < merge.row + merge.rows; row += 1)
        for (let column = merge.column; column < merge.column + merge.columns; column += 1) covered.add(`${row}:${column}`);
    }
    return { covered, anchors };
  }, [sheet.merges]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setViewport({
        left: element.scrollLeft,
        top: element.scrollTop,
        width: element.clientWidth || 960,
        height: element.clientHeight || 640,
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // The body's window, in the body's own coordinates (past the frozen panes).
  const firstRow = Math.max(frozenRows, indexAt(rows, viewport.top + frozenHeight - OVERSCAN));
  const lastRow = Math.min(sheet.rowCount - 1, indexAt(rows, viewport.top + viewport.height + OVERSCAN));
  const firstColumn = Math.max(frozenColumns, indexAt(columns, viewport.left + frozenWidth - OVERSCAN));
  const lastColumn = Math.min(sheet.columnCount - 1, indexAt(columns, viewport.left + viewport.width + OVERSCAN));

  const cell = (row: number, column: number, originRow: number, originColumn: number) => {
    const key = `${row}:${column}`;
    const merge = anchors.get(key);
    if (covered.has(key) && !merge) return null;
    const lastRowIndex = merge ? row + merge.rows : row + 1;
    const lastColumnIndex = merge ? column + merge.columns : column + 1;
    const width = columns[Math.min(lastColumnIndex, sheet.columnCount)]! - columns[column]!;
    const height = rows[Math.min(lastRowIndex, sheet.rowCount)]! - rows[row]!;
    if (!width || !height) return null;
    const address = `${columnName(column)}${row + 1}`;
    const value = sheet.cells[address];
    const format = value?.format;
    return (
      <div
        key={key}
        data-address={address}
        className={cn("file-viewer-cell", format?.wrap && "is-wrapped")}
        data-gridlines={sheet.showGridlines || undefined}
        style={{
          left: columns[column]! - columns[originColumn]!,
          top: rows[row]! - rows[originRow]!,
          width,
          height,
          ...cellVisualStyle(format, 1),
          textAlign: format?.align ?? (value?.numeric ? "right" : undefined),
          justifyContent: format?.align === "center" ? "center" : format?.align === "right" || (!format?.align && value?.numeric) ? "flex-end" : undefined,
          color: format?.textColor,
          backgroundColor: format?.fillColor,
        }}
      >
        {value?.text}
      </div>
    );
  };

  /** One pane: the window's cells, drawn from the pane's origin. The pane holds rows and columns from its origin up to `zoneRows`/`zoneColumns`. */
  const range = (fromRow: number, toRow: number, fromColumn: number, toColumn: number, originRow: number, originColumn: number, zoneRows: number, zoneColumns: number) => {
    const cells = [];
    for (let row = fromRow; row <= toRow; row += 1) {
      if (hiddenRows.has(row)) continue;
      for (let column = fromColumn; column <= toColumn; column += 1) {
        if (hiddenColumns.has(column)) continue;
        const drawn = cell(row, column, originRow, originColumn);
        if (drawn) cells.push(drawn);
      }
    }
    // A merge whose anchor sits outside the window still covers part of it.
    for (const merge of sheet.merges) {
      const anchorInside = merge.row >= fromRow && merge.row <= toRow && merge.column >= fromColumn && merge.column <= toColumn;
      const overlaps = merge.row <= toRow && merge.row + merge.rows - 1 >= fromRow && merge.column <= toColumn && merge.column + merge.columns - 1 >= fromColumn;
      const inZone = merge.row >= originRow && merge.row < zoneRows && merge.column >= originColumn && merge.column < zoneColumns;
      if (!anchorInside && overlaps && inZone) {
        const drawn = cell(merge.row, merge.column, originRow, originColumn);
        if (drawn) cells.push(drawn);
      }
    }
    return cells;
  };

  const bodyWidth = columns[sheet.columnCount]! - frozenWidth;
  const bodyHeight = rows[sheet.rowCount]! - frozenHeight;
  const columnHeaders = (from: number, to: number, origin: number) => {
    const headers = [];
    for (let column = from; column <= to; column += 1) {
      const width = columns[column + 1]! - columns[column]!;
      if (!width) continue;
      headers.push(
        <div key={column} className="file-viewer-header" style={{ left: columns[column]! - columns[origin]!, width, height: HEADER_HEIGHT }}>
          {columnName(column)}
        </div>,
      );
    }
    return headers;
  };
  const rowHeaders = (from: number, to: number, origin: number) => {
    const headers = [];
    for (let row = from; row <= to; row += 1) {
      const height = rows[row + 1]! - rows[row]!;
      if (!height) continue;
      headers.push(
        <div key={row} className="file-viewer-header" style={{ top: rows[row]! - rows[origin]!, height, width: HEADER_WIDTH }}>
          {row + 1}
        </div>,
      );
    }
    return headers;
  };

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={`${sheet.name}, read-only`}
      className="file-viewer-grid"
      tabIndex={0}
      style={{
        gridTemplateColumns: `${HEADER_WIDTH}px ${frozenWidth}px ${bodyWidth}px`,
        gridTemplateRows: `${HEADER_HEIGHT}px ${frozenHeight}px ${bodyHeight}px`,
      }}
    >
      <div className="file-viewer-pane is-corner" style={{ gridArea: "1 / 1 / 2 / 2" }} />
      <div className="file-viewer-pane is-top is-left" style={{ gridArea: "1 / 2 / 2 / 3" }}>{columnHeaders(0, frozenColumns - 1, 0)}</div>
      <div className="file-viewer-pane is-top" style={{ gridArea: "1 / 3 / 2 / 4" }}>{columnHeaders(firstColumn, lastColumn, frozenColumns)}</div>
      <div className="file-viewer-pane is-left is-top-frozen" style={{ gridArea: "2 / 1 / 3 / 2", top: HEADER_HEIGHT }}>{rowHeaders(0, frozenRows - 1, 0)}</div>
      <div className="file-viewer-pane is-left" style={{ gridArea: "3 / 1 / 4 / 2" }}>{rowHeaders(firstRow, lastRow, frozenRows)}</div>
      <div className="file-viewer-pane is-frozen-corner" style={{ gridArea: "2 / 2 / 3 / 3", top: HEADER_HEIGHT, left: HEADER_WIDTH }}>
        {range(0, frozenRows - 1, 0, frozenColumns - 1, 0, 0, frozenRows, frozenColumns)}
      </div>
      <div className="file-viewer-pane is-frozen-rows" style={{ gridArea: "2 / 3 / 3 / 4", top: HEADER_HEIGHT }}>
        {range(0, frozenRows - 1, firstColumn, lastColumn, 0, frozenColumns, frozenRows, sheet.columnCount)}
      </div>
      <div className="file-viewer-pane is-frozen-columns" style={{ gridArea: "3 / 2 / 4 / 3", left: HEADER_WIDTH }}>
        {range(firstRow, lastRow, 0, frozenColumns - 1, frozenRows, 0, sheet.rowCount, frozenColumns)}
      </div>
      <div className="file-viewer-pane is-body" style={{ gridArea: "3 / 3 / 4 / 4" }}>
        {range(firstRow, lastRow, firstColumn, lastColumn, frozenRows, frozenColumns, sheet.rowCount, sheet.columnCount)}
      </div>
    </div>
  );
}
