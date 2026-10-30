"use client";

import Link from "next/link";
import { useMemo } from "react";
import { aiWorking } from "../artifacts/ai-working";
import { useWorkPreviews } from "../artifacts/use-work-previews";
import { meaningfulSummary } from "../artifacts/work-preview";
import { openWorkInSide } from "../components/side-open";
import { WorkCard } from "../components/work-card";
import { formatRelativeTime } from "../components/spectra-view-model";
import { useClassBook } from "../school/use-class-book";
import type { SpectraArtifact } from "../data/api";
import { isActiveRunStatus, useRunTabs } from "../island/run-tabs";
import { daySentence, greeting } from "./today-model";
import { TodayBrief } from "./today-brief";
import { useDailyBrief } from "./use-daily-brief";
import { TodayThreads } from "./today-threads";
import { TodayWeek } from "./today-week";
import { useToday } from "./use-today";

/*
 * Home's day (docs/product/HOME.md): the week at a glance, then the work to
 * pick up beside the threads still going. It has no search box and no
 * composer of its own: everything new starts from the island, and a thread
 * started or opened here takes the page in its place (chat/home-lead).
 */

const placeOf = (work: SpectraArtifact) => work.placements?.[0]?.workspaceTitle ?? (work.placementStatus === "shared" ? "Shared with you" : "Inbox");

export function HomeDay({ onAllThreads }: { onAllThreads: () => void }) {
  const today = useToday();
  const { now, name, threads, works, agenda, agendaFailed, needsSchool } = today;
  const brief = useDailyBrief(today.now);
  const tabs = useRunTabs();
  const moving = useMemo(() => new Set(tabs.filter((tab) => isActiveRunStatus(tab.run.status)).map((tab) => tab.threadId)), [tabs]);
  const previewOf = useWorkPreviews(works);
  const book = useClassBook();

  // Moving threads lead, then the most recent.
  const shownThreads = useMemo(
    () => (threads ? [...threads].sort((a, b) => Number(moving.has(b._id)) - Number(moving.has(a._id))).slice(0, 3) : null),
    [moving, threads],
  );

  return (
      <div className="today mx-auto flex max-w-[1480px] flex-wrap gap-x-12 gap-y-14 px-4 pb-40 pt-4 sm:px-6">
        <header className="-mb-4 max-w-[760px]">
          <h1 className="page-greeting">{now ? greeting(new Date(now).getHours(), name) : " "}</h1>
          <p className="page-greeting-line mt-3 min-h-[1.6em]">{now ? daySentence({ moving: moving.size, agenda, now }) : ""}</p>
        </header>

        {needsSchool ? (
          <section aria-labelledby="today-join" className="today-join w-full max-w-[760px]">
            <h2 id="today-join">Join your school to see your week</h2>
            <p className="mt-2 text-ui leading-6 text-[var(--text-secondary)]">
              You are signed in, but not part of a school in Spectra yet. Open the invitation your school sent you. If you do not have one,
              ask a teacher or your school&apos;s Spectra administrator to invite you.
            </p>
            <Link href="/join" prefetch={false} className="today-link mt-4 inline-block">
              Open my invitation
            </Link>
          </section>
        ) : null}

        {needsSchool ? null : <TodayBrief brief={brief} agenda={agenda} />}

        {needsSchool ? null : now ? <TodayWeek agenda={agenda} failed={agendaFailed} now={now} /> : <div className="h-[260px]" />}

        <section aria-labelledby="today-works" className="today-works">
          <div className="today-section-head">
            <h2 id="today-works">Pick up where you left off</h2>
            <Link href="/library" prefetch={false} className="today-link">
              Library
            </Link>
          </div>
          {works && !works.length ? (
            <p className="text-caption text-[var(--text-secondary)]">Documents, decks and quizzes you make or open appear here.</p>
          ) : (
            <div className="work-desk grid grid-cols-[repeat(auto-fill,minmax(min(100%,232px),1fr))] gap-x-4 gap-y-6">
              {(works ?? Array.from({ length: 3 }, () => null)).map((work, index) =>
                work ? (
                  <WorkCard
                    key={work._id}
                    workId={work._id}
                    type={work.blueprintKey}
                    title={work.title}
                    preview={previewOf(work)}
                    summary={meaningfulSummary(work.blueprintKey, work.summary)}
                    place={placeOf(work)}
                    ink={book.named(placeOf(work))?.ink}
                    when={formatRelativeTime(work.updatedAt)}
                    href={`/library/${encodeURIComponent(work._id)}`}
                    onOpen={() => openWorkInSide(work._id)}
                    live={aiWorking(work)}
                  />
                ) : (
                  <div key={index} data-life-ghost className="h-[236px] animate-pulse rounded-surface bg-[var(--bg-secondary)]" />
                ),
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="today-threads" className="today-threads">
          <div className="today-section-head">
            <h2 id="today-threads">Threads</h2>
            <button type="button" onClick={onAllThreads} className="today-link">
              All threads
            </button>
          </div>
          <TodayThreads threads={shownThreads} moving={moving} />
        </section>
      </div>
  );
}
