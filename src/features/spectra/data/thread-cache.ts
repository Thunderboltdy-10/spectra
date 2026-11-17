"use client";

import { getSpectraThread, type SpectraThreadDetail } from "./api";

/*
 * Threads already read show at once the next time they open (the island's
 * card, the side panel, the thread page) while a fresh copy is read behind
 * them. The most recent few are also kept in this browser across reloads.
 * The server stays the only real copy: a kept thread is only ever shown
 * until the fresh one arrives, never written back.
 */
const KEEP_KEY = "spectra:thread-cache:v1";
const KEEP_COUNT = 8;
const KEEP_MAX_BYTES = 180_000;
const MEMORY_COUNT = 24;
const FRESH_MS = 15_000;

type Entry = { detail: SpectraThreadDetail; at: number };
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<SpectraThreadDetail>>();
let loadedKept = false;

function loadKept() {
  if (loadedKept || typeof window === "undefined") return;
  loadedKept = true;
  try {
    const rows = JSON.parse(window.localStorage.getItem(KEEP_KEY) ?? "[]") as Array<[string, Entry]>;
    for (const [id, entry] of rows) if (!memory.has(id) && entry?.detail) memory.set(id, entry);
  } catch {
    // Blocked or corrupt storage: threads are just read again.
  }
}

function saveKept() {
  if (typeof window === "undefined") return;
  try {
    const rows: Array<[string, Entry]> = [];
    let bytes = 0;
    for (const [id, entry] of [...memory.entries()].sort((a, b) => b[1].at - a[1].at)) {
      if (rows.length >= KEEP_COUNT) break;
      const size = JSON.stringify(entry).length;
      if (size > KEEP_MAX_BYTES || bytes + size > KEEP_MAX_BYTES * 3) continue;
      bytes += size;
      rows.push([id, entry]);
    }
    window.localStorage.setItem(KEEP_KEY, JSON.stringify(rows));
  } catch {
    // Storage full or blocked: memory still holds them for this visit.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveKept();
  }, 1_500);
}

/** The thread as last read, if any, to show while a fresh copy loads. */
export function cachedThread(threadId: string): SpectraThreadDetail | null {
  loadKept();
  return memory.get(threadId)?.detail ?? null;
}

export function rememberThread(threadId: string, detail: SpectraThreadDetail) {
  memory.delete(threadId);
  memory.set(threadId, { detail, at: Date.now() });
  while (memory.size > MEMORY_COUNT) memory.delete(memory.keys().next().value!);
  scheduleSave();
}

/** Another account signed in: nothing kept may show. */
export function clearThreadCache() {
  memory.clear();
  pending.clear();
  loadedKept = true;
}

export function forgetThread(threadId: string) {
  memory.delete(threadId);
  scheduleSave();
}

/** Reads the thread (one request at a time per thread) and keeps it. */
export function readThread(threadId: string): Promise<SpectraThreadDetail> {
  const inFlight = pending.get(threadId);
  if (inFlight) return inFlight;
  const request = getSpectraThread(threadId)
    .then((detail) => {
      rememberThread(threadId, detail);
      return detail;
    })
    .finally(() => pending.delete(threadId));
  pending.set(threadId, request);
  return request;
}

/** Warms a thread about to be shown (a hovered island tab). */
export function prefetchThread(threadId: string) {
  if (!threadId) return;
  loadKept();
  const entry = memory.get(threadId);
  if (entry && Date.now() - entry.at < FRESH_MS) return;
  void readThread(threadId).catch(() => undefined);
}
