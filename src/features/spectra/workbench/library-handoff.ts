/*
 * Files another page hands to the Library ("Copy into Library" on School):
 * the page fetches the bytes, leaves them here, and moves to the Library,
 * which imports them through its own flow once it is open. Client navigation
 * keeps this module alive between the two pages; a full reload drops the
 * handoff, and the page that made it says so.
 */

type Handoff = { file: File; at: number };

const MAX_AGE_MS = 60_000;
let pending: Handoff[] = [];
const listeners = new Set<() => void>();

export function handOffToLibrary(file: File) {
  pending.push({ file, at: Date.now() });
  for (const listener of listeners) listener();
}

/** The files waiting for the Library, oldest first. Each is taken once. */
export function takeLibraryHandoffs(): File[] {
  const now = Date.now();
  const files = pending.filter((entry) => now - entry.at < MAX_AGE_MS).map((entry) => entry.file);
  pending = [];
  return files;
}

/** The Library listens while it is open, so a handoff made beside it lands at once. */
export function onLibraryHandoff(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
