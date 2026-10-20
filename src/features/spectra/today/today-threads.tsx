"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { threadClick } from "../components/side-open";
import { formatRelativeTime } from "../components/spectra-view-model";
import type { SpectraThread } from "../data/api";
import { plainTextFromStored } from "../rich-content/adapters";
import { threadHeading } from "../threads/threads-model";
import { WorkingMark } from "@/components/ui/skeleton";
import { threadHref } from "../chat/home-routes";

/*
 * Threads to pick up: each one a note of where it got to (its summary), what
 * it made, and whether Spectra is still on it. One press opens it beside
 * Home, where the island replies to it.
 */

export function TodayThreads({ threads, moving }: { threads: SpectraThread[] | null; moving: ReadonlySet<string> }) {
  if (!threads)
    return (
      <div data-life-ghost role="status" aria-label="Loading threads" className="grid gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="today-thread space-y-2">
            <span data-life-ghost-bar className="block h-3 w-3/5 animate-pulse rounded-full bg-[var(--bg-tertiary)]" />
            <span data-life-ghost-bar className="block h-2.5 w-11/12 animate-pulse rounded-full bg-[var(--bg-secondary)]" />
            <span data-life-ghost-bar className="block h-2.5 w-2/3 animate-pulse rounded-full bg-[var(--bg-secondary)]" />
          </div>
        ))}
      </div>
    );
  if (!threads.length) return <p className="text-caption text-[var(--text-secondary)]">Threads you start from the dock below appear here, ready to pick up.</p>;
  return (
    <ul className="grid gap-3">
      {threads.map((thread) => {
        const working = moving.has(thread._id);
        const heading = threadHeading(thread.title, plainTextFromStored(thread.summaryShort || thread.previewText || ""));
        const made = thread.contexts?.artifacts ?? [];
        return (
          <li key={thread._id} className="min-w-0">
            <Link
              href={threadHref(thread._id)}
              prefetch={false}
              onClick={threadClick(thread)}
              data-working={working || undefined}
              className="today-thread group"
            >
              <span className="flex items-baseline gap-3">
                <span data-row-title className="min-w-0 flex-1 truncate font-display text-subhead font-medium leading-snug text-[var(--text-primary)]">
                  {heading.title}
                </span>
                <span className="shrink-0 text-micro tabular-nums text-[var(--text-tertiary)]">
                  {working ? "Working" : formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}
                </span>
              </span>
              <span data-row-summary className="mt-1 line-clamp-2 min-h-[2.6em] text-caption leading-[1.3em] text-[var(--text-secondary)]">
                {heading.summary || "No messages yet."}
              </span>
              <span className="mt-2.5 flex min-w-0 items-center gap-1.5">
                {working ? <WorkingMark /> : null}
                {made.slice(0, 2).map((artifact) => (
                  <span key={artifact.id} className="today-chip">
                    <Icon name="document" size={11} className="shrink-0 text-[var(--type-document)]" />
                    <span className="truncate">{artifact.title}</span>
                  </span>
                ))}
                {made.length > 2 ? <span className="text-micro text-[var(--text-tertiary)]">and {made.length - 2} more</span> : null}
                <span className="ml-auto text-micro font-medium text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Continue
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
