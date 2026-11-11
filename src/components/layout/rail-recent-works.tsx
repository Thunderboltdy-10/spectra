"use client";

import { useConvex, useConvexAuth } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { presentWork, workTypeMeta, type PresentedWorkType } from "@/features/spectra/artifacts/presentation";
import { formatRelativeTime } from "@/features/spectra/components/spectra-view-model";
import { spectraBus } from "@/features/spectra/events";
import { editedWorks, subscribeEditedWorks } from "@/features/spectra/today/recent-edits";

/*
 * The works touched last, above the threads. This is read once and again when
 * something says it moved, not subscribed to: every checkpoint of every work
 * would otherwise run it again. An edit on this device shows straight away,
 * before the server has heard of it. Searching looks through these first, then
 * asks once for the rest of the Library by name.
 */

const SHOWN = 5;
const FETCHED = 12;
const REFRESH_MS = 20_000;
const SEARCH_AFTER_MS = 260;
const FOUND = 8;

type RecentWork = { workId: string; title: string; typeKey: string | null; activityAt: number };

const presented = (work: RecentWork) => presentWork((work.typeKey && work.typeKey in workTypeMeta ? work.typeKey : "document") as PresentedWorkType, work.title);

export function RailRecentWorks() {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const pathname = usePathname();
  const [works, setWorks] = useState<RecentWork[] | null>(null);
  const lastRead = useRef(0);
  const edited = useSyncExternalStore(subscribeEditedWorks, editedWorks, editedWorks);
  const editedSeen = useRef(edited);
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<RecentWork[] | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const read = useCallback(
    (force: boolean) => {
      if (!isAuthenticated) return;
      const now = Date.now();
      if (!force && now - lastRead.current < REFRESH_MS) return;
      lastRead.current = now;
      void convex
        .query(api.orgTree.recentWorks, { limit: FETCHED })
        .then((rows) => setWorks(rows))
        .catch(() => setWorks((current) => current ?? []));
    },
    [convex, isAuthenticated],
  );

  useEffect(() => {
    // Leaving a work is when its last edits have reached the server.
    const moved = editedSeen.current !== edited;
    editedSeen.current = edited;
    read(moved);
  }, [edited, pathname, read]);

  useEffect(() => {
    const again = () => read(true);
    const focus = () => read(false);
    const offs = [spectraBus.on("threads.changed", again), spectraBus.on("workspaces.changed", again)];
    window.addEventListener("focus", focus);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("focus", focus);
    };
  }, [read]);

  const shown = useMemo(
    () =>
      (works ?? [])
        .map((work) => ({ ...work, activityAt: Math.max(work.activityAt, edited[work.workId] ?? 0) }))
        .sort((a, b) => b.activityAt - a.activityAt)
        .slice(0, SHOWN),
    [edited, works],
  );

  const wanted = term.trim().toLowerCase();
  useEffect(() => {
    setFound(null);
    if (wanted.length < 2 || !isAuthenticated) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void convex
        .query(api.orgTree.search, { term: wanted, kinds: ["work"], limit: FOUND })
        .then(({ results }) => {
          if (!live) return;
          setFound(
            results.flatMap((row) =>
              row.sourceId ? [{ workId: row.sourceId, title: row.name, typeKey: row.typeKey ?? null, activityAt: row.updatedAt ?? 0 }] : [],
            ),
          );
        })
        .catch(() => live && setFound([]));
    }, SEARCH_AFTER_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [convex, isAuthenticated, wanted]);

  const matches = useMemo(() => {
    if (!wanted) return null;
    const recent = (works ?? []).filter((work) => work.title.toLowerCase().includes(wanted));
    const seen = new Set(recent.map((work) => work.workId));
    return [...recent, ...(found ?? []).filter((work) => !seen.has(work.workId))].slice(0, FOUND);
  }, [found, wanted, works]);

  const closeSearch = () => {
    setSearching(false);
    setTerm("");
  };

  if (works !== null && !shown.length && !searching) return null;
  const listed = matches ?? shown;
  return (
    <section aria-label="Recent artifacts" className="mb-3">
      <div className="flex h-7 items-center gap-1 pl-2.5 pr-1">
        <h2 className="min-w-0 flex-1 truncate text-micro font-medium text-[var(--text-tertiary)]">Recent</h2>
        <Tooltip label={searching ? "Stop searching" : "Search your artifacts"} side="right">
          <button
            type="button"
            aria-label={searching ? "Stop searching" : "Search your artifacts"}
            aria-expanded={searching}
            onClick={() => {
              if (searching) return closeSearch();
              setSearching(true);
              requestAnimationFrame(() => field.current?.focus());
            }}
            className="grid size-6 place-items-center rounded-chip text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-desk-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <Icon name={searching ? "close" : "search"} size={13} />
          </button>
        </Tooltip>
      </div>
      {searching ? (
        <div className="mb-1 px-1">
          <input
            ref={field}
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeSearch();
              }
            }}
            onBlur={() => {
              if (!term.trim()) setSearching(false);
            }}
            placeholder="Find artifact by name"
            aria-label="Find artifact by name"
            className="h-8 w-full rounded-control border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 text-caption text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)]"
          />
        </div>
      ) : null}
      {matches && !matches.length ? (
        <p className="px-2.5 py-1 text-caption leading-5 text-[var(--text-tertiary)]">
          {wanted.length >= 2 && found === null ? "Looking…" : "Nothing by that name."}
        </p>
      ) : works === null ? (
        <ul aria-hidden className="space-y-px">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="flex h-8 items-center gap-2.5 px-2.5">
              <span className="size-4 rounded-chip bg-[var(--bg-tertiary)]" />
              <span className="h-2.5 animate-pulse rounded-full bg-[var(--bg-tertiary)]" style={{ width: `${60 + ((index * 23) % 30)}%` }} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-px">
          {listed.map((work) => (
            <li key={work.workId}>
              <Link
                href={`/library/${encodeURIComponent(work.workId)}`}
                prefetch={false}
                data-rail-recent-work={work.workId}
                title={work.activityAt ? `${work.title}, ${formatRelativeTime(work.activityAt)}` : work.title}
                className="flex h-8 w-full items-center gap-2.5 rounded-control px-2.5 text-caption text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-desk-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                <Icon name={presented(work).glyph} size={15} className="shrink-0" style={{ color: presented(work).color }} />
                <span className="min-w-0 flex-1 truncate">{work.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
