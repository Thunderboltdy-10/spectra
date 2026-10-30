"use client";

import { useEffect, useState, type RefObject } from "react";
import { getSpectraArtifact, getSpectraThreadMessages } from "../data/api";
import type { PresentedWorkType } from "./presentation";
import { cornerPreview, threadPreview, workPreview, type WorkPreview } from "./work-preview";
import { fileViewKind } from "../files/file-kind";
import { readOfficeBytes } from "../files/office-preview-client";
import { useBusyArtifacts } from "../collaboration/artifact-ai-activity";

/*
 * Previews for cards. Catalogs carry no content, so each card's work is read
 * once, its preview kept for as long as the work is unchanged (keyed by its
 * last update), and the content itself let go. Reads wait their turn, a few at
 * a time, so a board of two hundred cards never fires two hundred requests at
 * once.
 */

export type PreviewSource = { _id: string; blueprintKey: PresentedWorkType; updatedAt: number; title?: string };

const cache = new Map<string, WorkPreview | null>();
const lastFinished = new Map<string, WorkPreview | null>();
const keyOf = (work: PreviewSource) => `${work._id}:${work.updatedAt}`;
/** The files a card draws from their own bytes: a PDF's first page, a sheet's corner, a deck's slides. */
function fileFace(work: PreviewSource) {
  if (work.blueprintKey !== "resource" || !work.title) return null;
  const kind = fileViewKind(undefined, work.title);
  return kind === "pdf" || kind === "sheet" || kind === "slides" ? kind : null;
}
/** Other files are named by their kind, which needs no read. */
const readable = (work: PreviewSource) => work.blueprintKey !== "resource" || fileFace(work) !== null;
/** Larger files keep the name of their kind: a card is not worth reading that much. */
const FILE_FACE_LIMIT = 12_000_000;
/** The width a PDF's first page is drawn at, about twice a card's. */
const PAGE_WIDTH = 480;
/** How many of a thread's latest messages it takes to find its last exchange. */
const THREAD_TAIL = 6;

async function previewFor(work: PreviewSource, signal: AbortSignal) {
  if (work.blueprintKey === "thread_reference") {
    const { messages } = await getSpectraThreadMessages(work._id, undefined, THREAD_TAIL);
    return threadPreview(messages);
  }
  const face = fileFace(work);
  if (face) return filePreview(work._id, face, signal);
  const { artifact } = await getSpectraArtifact(work._id, { signal });
  return workPreview(work.blueprintKey, artifact.content);
}

/** A file's face from its kept copy; nothing when there is no copy or it is too big. */
async function filePreview(workId: string, face: "pdf" | "sheet" | "slides", signal: AbortSignal): Promise<WorkPreview | null> {
  const response = await fetch(`/api/spectra/native?artifactId=${encodeURIComponent(workId)}`, { signal });
  if (!response.ok || Number(response.headers.get("content-length")) > FILE_FACE_LIMIT) {
    void response.body?.cancel();
    return null;
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > FILE_FACE_LIMIT) return null;
  if (face === "pdf") return pdfFace(bytes);
  const read = await readOfficeBytes({ kind: face, bytes }, signal);
  if (read.kind === "slides") return workPreview("presentation", read.deck);
  if (read.kind !== "sheet") return null;
  const sheet = read.sheets.find((candidate) => candidate.id === read.activeSheetId) ?? read.sheets[0];
  return sheet ? cornerPreview(sheet.cells, (cell) => (cell as { text?: string }).text?.slice(0, 40) ?? "") : null;
}

/** A PDF's first page, drawn once at card size and kept as a picture. */
async function pdfFace(bytes: ArrayBuffer): Promise<WorkPreview | null> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, disableFontFace: true });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: PAGE_WIDTH / Math.max(1, page.getViewport({ scale: 1 }).width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return { kind: "page", image: canvas.toDataURL("image/webp", 0.82), pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}

const PARALLEL_READS = 4;
let reading = 0;
const waiting: Array<() => void> = [];

/** Take a read slot, waiting for one when all are busy; a finished read hands its slot straight on. */
async function acquire() {
  if (reading < PARALLEL_READS) reading += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else reading -= 1;
}

/** Read one work's preview into the cache, unless the reader stopped wanting it while it waited. */
async function readPreview(work: PreviewSource, signal: AbortSignal) {
  await acquire();
  try {
    if (signal.aborted || cache.has(keyOf(work))) return;
    const preview = await previewFor(work, signal);
    if (!signal.aborted) {
      cache.set(keyOf(work), preview);
      lastFinished.set(work._id, preview);
    }
  } catch {
    if (!signal.aborted) cache.set(keyOf(work), null);
  } finally {
    release();
  }
}

/** `undefined` while the work is being read. */
function previewOf(work: PreviewSource): WorkPreview | null | undefined {
  return readable(work) ? cache.get(keyOf(work)) ?? lastFinished.get(work._id) : null;
}

/** Previews for a short, fixed set of cards, read as soon as they are known. */
export function useWorkPreviews(works: readonly PreviewSource[] | null) {
  const [, setVersion] = useState(0);
  const busy = useBusyArtifacts(works?.map((work) => work._id) ?? []);
  const signature = works?.map(keyOf).join("|") ?? "";

  useEffect(() => {
    if (!works) return;
    const controller = new AbortController();
    const missing = works.filter((work) => !busy.has(work._id) && readable(work) && !cache.has(keyOf(work)));
    for (const work of missing)
      void readPreview(work, controller.signal).finally(() => {
        if (!controller.signal.aborted) setVersion((version) => version + 1);
      });
    return () => controller.abort();
    // `signature` names exactly the works and versions in `works`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, busy]);

  return (work: PreviewSource) => busy.has(work._id) ? lastFinished.get(work._id) : previewOf(work);
}

/** One card's preview, read only once the card comes near the screen. */
export function useWorkPreview(work: PreviewSource, target: RefObject<Element | null>) {
  const [, setVersion] = useState(0);
  const busy = useBusyArtifacts([work._id]).has(work._id);
  const key = keyOf(work);

  useEffect(() => {
    const element = target.current;
    if (!element || busy || !readable(work) || cache.has(key)) return;
    const controller = new AbortController();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void readPreview(work, controller.signal).finally(() => {
          if (!controller.signal.aborted) setVersion((version) => version + 1);
        });
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      controller.abort();
    };
    // `key` names the work and its version; `target` is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, busy]);

  return busy ? lastFinished.get(work._id) : previewOf(work);
}
