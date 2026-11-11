/*
 * When this device last edited each work. The server hears of an edit at its
 * next checkpoint, or later for work kept on the computer; the sidebar should
 * not wait for that to say what was touched last.
 */

const KEY = "spectra.recent-edits.v1";
const KEPT = 40;
const NOTE_EVERY_MS = 15_000;

type Edited = Readonly<Record<string, number>>;
const EMPTY: Edited = Object.freeze({});

let current: Edited | null = null;
const listeners = new Set<() => void>();

function load(): Edited {
  if (current) return current;
  current = EMPTY;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) current = JSON.parse(stored) as Edited;
  } catch {}
  return current;
}

export function editedWorks(): Edited {
  return typeof window === "undefined" ? EMPTY : load();
}

export function subscribeEditedWorks(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function noteWorkEdited(workId: string) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const edited = load();
  if (now - (edited[workId] ?? 0) < NOTE_EVERY_MS) return;
  const entries = Object.entries({ ...edited, [workId]: now }).sort((a, b) => b[1] - a[1]).slice(0, KEPT);
  current = Object.fromEntries(entries);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  listeners.forEach((listener) => listener());
}
