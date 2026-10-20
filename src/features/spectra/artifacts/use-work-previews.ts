"use client";

import { useEffect, useState, type RefObject } from "react";
import { getSpectraArtifact, getSpectraThreadMessages } from "../data/api";
import type { PresentedWorkType } from "./presentation";
import { threadPreview, workPreview, type WorkPreview } from "./work-preview";

/*
 * Previews for cards. Catalogs carry no content, so each card's work is read
 * once, its preview kept for as long as the work is unchanged (keyed by its
 * last update), and the content itself let go. Reads wait their turn, a few at
 * a time, so a board of two hundred cards never fires two hundred requests at
 * once.
 */

export type PreviewSource = { _id: string; blueprintKey: PresentedWorkType; updatedAt: number };

const cache = new Map<string, WorkPreview | null>();
const keyOf = (work: PreviewSource) => `${work._id}:${work.updatedAt}`;
/** Files are their bytes; a preview of them is their kind, which needs no read. */
const readable = (work: PreviewSource) => work.blueprintKey !== "resource";
/** How many of a thread's latest messages it takes to find its last exchange. */
const THREAD_TAIL = 6;

async function previewFor(work: PreviewSource, signal: AbortSignal) {
  if (work.blueprintKey === "thread_reference") {
    const { messages } = await getSpectraThreadMessages(work._id, undefined, THREAD_TAIL);
    return threadPreview(messages);
  }
  const { artifact } = await getSpectraArtifact(work._id, { signal });
  return workPreview(work.blueprintKey, artifact.content);
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
    if (!signal.aborted) cache.set(keyOf(work), preview);
  } catch {
    if (!signal.aborted) cache.set(keyOf(work), null);
  } finally {
    release();
  }
}

/** `undefined` while the work is being read. */
function previewOf(work: PreviewSource): WorkPreview | null | undefined {
  return readable(work) ? cache.get(keyOf(work)) : null;
}

/** Previews for a short, fixed set of cards, read as soon as they are known. */
export function useWorkPreviews(works: readonly PreviewSource[] | null) {
  const [, setVersion] = useState(0);
  const signature = works?.map(keyOf).join("|") ?? "";

  useEffect(() => {
    if (!works) return;
    const controller = new AbortController();
    const missing = works.filter((work) => readable(work) && !cache.has(keyOf(work)));
    for (const work of missing)
      void readPreview(work, controller.signal).finally(() => {
        if (!controller.signal.aborted) setVersion((version) => version + 1);
      });
    return () => controller.abort();
    // `signature` names exactly the works and versions in `works`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return previewOf;
}

/** One card's preview, read only once the card comes near the screen. */
export function useWorkPreview(work: PreviewSource, target: RefObject<Element | null>) {
  const [, setVersion] = useState(0);
  const key = keyOf(work);

  useEffect(() => {
    const element = target.current;
    if (!element || !readable(work) || cache.has(key)) return;
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
  }, [key]);

  return previewOf(work);
}
