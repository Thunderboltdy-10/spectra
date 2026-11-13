"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight } from "@/components/icons/glyph-icons";

/*
 * Any section of a shelf folds under its heading, and stays folded wherever
 * that kind of section shows (every class's "Past tasks", say) until it is
 * opened again. Kept in this browser only: it is how the person likes to look,
 * not their data.
 */

const FOLDED_KEY = "spectra.library.folded";
const listeners = new Set<() => void>();
let cache: { raw: string | null; keys: ReadonlySet<string> } = { raw: null, keys: new Set() };

function read(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(FOLDED_KEY);
  } catch {
    return cache.keys;
  }
  if (raw === cache.raw) return cache.keys;
  let keys: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) keys = parsed.filter((key): key is string => typeof key === "string");
  } catch {
    keys = [];
  }
  cache = { raw, keys: new Set(keys) };
  return cache.keys;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === FOLDED_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const NOTHING: ReadonlySet<string> = new Set();

/** Whether a section is folded, and the way to fold or open it. */
export function useShelfFold(key: string) {
  const folded = useSyncExternalStore(subscribe, read, () => NOTHING).has(key);
  const toggle = useCallback(() => {
    const next = new Set(read());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    try {
      window.localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
    } catch {
      // Without storage the fold lasts as long as the page.
      cache = { raw: cache.raw, keys: next };
    }
    listeners.forEach((listener) => listener());
  }, [key]);
  return [folded, toggle] as const;
}

/** A heading that folds its section; extras (a count, a toggle) sit after the name. */
export function ShelfSection({
  foldKey,
  title,
  count,
  extra,
  level = 2,
  id,
  label,
  className,
  children,
}: {
  foldKey: string;
  title: ReactNode;
  count?: number;
  extra?: ReactNode;
  level?: 2 | 3;
  id?: string;
  /** Names the section when the heading has no id to point at. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [folded, toggle] = useShelfFold(foldKey);
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={id} aria-label={id ? undefined : label} className={className} data-folded={folded || undefined}>
      <Heading id={id} className="library-shelf-heading">
        <button type="button" className="library-shelf-fold" aria-expanded={!folded} onClick={toggle}>
          <ChevronRight aria-hidden className="library-shelf-fold-mark" />
          <span>{title}</span>
          {count ? <span className="school-heading-count">{count}</span> : null}
        </button>
        {extra && !folded ? <span className="library-shelf-heading-extra">{extra}</span> : null}
      </Heading>
      {folded ? null : children}
    </section>
  );
}
