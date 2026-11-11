export type CatalogPage<T> = { items: T[]; isDone: boolean; continueCursor: string | null };
export type CatalogSnapshot<T> = {
  items: T[];
  status: "idle" | "loading" | "ready" | "error";
  isDone: boolean;
  error: string | null;
};
type Entry<T> = {
  snapshot: CatalogSnapshot<T>;
  cursor?: string;
  fetchedAt: number;
  generation: number;
  listeners: Set<() => void>;
  active?: { controller: AbortController; promise: Promise<void> };
};

/** A visible result page may require many empty server progress requests.
 * Coalesce the entire operation, not just the first HTTP request or a timer
 * window. Only the server's isDone can declare the catalogue complete.
 */
export function createCatalogPageCache<T extends { _id: string }>(
  fetchPage: (key: string, cursor: string | undefined, signal: AbortSignal) => Promise<CatalogPage<T>>,
  ttlMs = 5 * 60_000,
  /** Keeps the list across reloads under this browser storage key, for as long as it is fresh. */
  keptAs?: string,
) {
  const entries = new Map<string, Entry<T>>();
  const keep = (key: string, entry: Entry<T>) => {
    if (!keptAs || entry.snapshot.status !== "ready") return;
    try {
      window.localStorage.setItem(keptAs, JSON.stringify({ key, items: entry.snapshot.items, isDone: entry.snapshot.isDone, cursor: entry.cursor, fetchedAt: entry.fetchedAt }));
    } catch {
      // Storage can be full or blocked; the list is just read again.
    }
  };
  const forget = () => {
    if (!keptAs) return;
    try {
      window.localStorage.removeItem(keptAs);
    } catch {
      // As above.
    }
  };
  const kept = (key: string): Pick<Entry<T>, "snapshot" | "cursor" | "fetchedAt"> | null => {
    if (!keptAs || typeof window === "undefined") return null;
    try {
      const value = JSON.parse(window.localStorage.getItem(keptAs) ?? "null") as { key: string; items: T[]; isDone: boolean; cursor?: string; fetchedAt: number } | null;
      if (!value || value.key !== key || Date.now() - value.fetchedAt >= ttlMs) return null;
      return { snapshot: { items: value.items, status: "ready", isDone: value.isDone, error: null }, cursor: value.cursor, fetchedAt: value.fetchedAt };
    } catch {
      return null;
    }
  };
  const empty = (): CatalogSnapshot<T> => ({ items: [], status: "idle", isDone: false, error: null });
  const entryFor = (key: string) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { snapshot: empty(), fetchedAt: 0, generation: 0, listeners: new Set(), ...kept(key) };
      entries.set(key, entry);
    }
    return entry;
  };
  const notify = (entry: Entry<T>, snapshot: CatalogSnapshot<T>) => {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
  };
  const reset = (entry: Entry<T>) => {
    entry.generation++;
    entry.active?.controller.abort();
    entry.active = undefined;
    entry.cursor = undefined;
    entry.fetchedAt = 0;
    forget();
    notify(entry, empty());
  };
  const load = (key: string, options: { more?: boolean; force?: boolean; all?: boolean } = {}): Promise<void> => {
    const entry = entryFor(key);
    // Focus, polling and multiple mounted consumers reuse a pending scan.
    // Mutation/account invalidation calls reset explicitly to cancel old work.
    if (entry.active) return entry.active.promise;
    const fresh = Date.now() - entry.fetchedAt < ttlMs;
    if (!options.force && fresh && entry.snapshot.status === "ready" && ((!options.more && !options.all) || entry.snapshot.isDone))
      return Promise.resolve();
    if (options.force || !fresh || entry.snapshot.status === "error") reset(entry);
    const generation = entry.generation;
    const controller = new AbortController();
    const loading: CatalogSnapshot<T> = { ...entry.snapshot, status: "loading", error: null };
    // Defer execution one microtask so active exists before notifications or
    // a synchronous fetch mock can reenter load.
    const promise = Promise.resolve().then(async () => {
      let cursor = entry.cursor;
      try {
        for (;;) {
          if (generation !== entry.generation || controller.signal.aborted) return;
          const page = await fetchPage(key, cursor, controller.signal);
          if (generation !== entry.generation) return;
          if (!page.isDone && (!page.continueCursor || page.continueCursor === cursor))
            throw new Error("Workspace discovery did not advance. Try again.");
          if (page.items.length || page.isDone) {
            const rows = new Map(entry.snapshot.items.map(row => [row._id, row]));
            for (const row of page.items) rows.set(row._id, row);
            entry.cursor = page.continueCursor ?? undefined;
            entry.fetchedAt = Date.now();
            const keepLoading = options.all && !page.isDone;
            notify(entry, { items: [...rows.values()], status: keepLoading ? "loading" : "ready", isDone: page.isDone, error: null });
            keep(key, entry);
            if (keepLoading) { cursor = page.continueCursor!; continue; }
            return;
          }
          cursor = page.continueCursor!;
        }
      } catch (error) {
        if (generation !== entry.generation) return;
        notify(entry, { ...entry.snapshot, status: "error", isDone: false,
          error: error instanceof Error ? error.message : "Could not load workspaces." });
      } finally {
        if (generation === entry.generation) entry.active = undefined;
      }
    });
    entry.active = { controller, promise };
    notify(entry, loading);
    return promise;
  };
  return {
    getSnapshot: (key: string) => entryFor(key).snapshot,
    subscribe: (key: string, listener: () => void) => {
      const entry = entryFor(key);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0 && entry.active) {
          entry.generation++;
          entry.active.controller.abort();
          entry.active = undefined;
          entry.snapshot = { ...entry.snapshot, status: entry.fetchedAt ? "ready" : "idle", error: null };
        }
      };
    },
    load,
    invalidate: () => {
      for (const entry of entries.values()) reset(entry);
    },
    // Account/session transitions dispose the old rows as well as in-flight
    // work. A late response cannot publish into the next identity's entry.
    retainScope: (prefix: string) => {
      for (const [key, entry] of entries) if (!key.startsWith(prefix)) {
        reset(entry);
        entries.delete(key);
      }
    },
  };
}
