"use client";

import { useEffect, useState } from "react";
import { useAccountName } from "../administration/use-account-name";
import { fetchCalendarOverview } from "../calendar/data/overview-client";
import { addLocalDays, startOfLocalDay } from "../calendar/domain/local-days";
import { getSpectraOverview, getSpectraThreads, type SpectraArtifact, type SpectraThread } from "../data/api";
import { spectraBus } from "../events";
import { useShowcaseTime } from "../showcase/showcase-time";
import { AGENDA_DAYS, splitAgenda, type TodayAgenda } from "./today-model";

/*
 * Everything Home reads, each part on its own: a slow calendar never holds
 * back the threads, and a part that fails is left out rather than failing the
 * page. `null` means still loading.
 */

const RECENT_WORKS = 3;
const RECENT_THREADS = 12;

export type TodayData = {
  now: number | null;
  name: string | null;
  threads: SpectraThread[] | null;
  works: SpectraArtifact[] | null;
  agenda: TodayAgenda | null;
  agendaFailed: boolean;
};

export function useToday(): TodayData {
  const [now, setNow] = useState<number | null>(null);
  const name = useAccountName();
  const [threads, setThreads] = useState<SpectraThread[] | null>(null);
  const [works, setWorks] = useState<SpectraArtifact[] | null>(null);
  const [agenda, setAgenda] = useState<TodayAgenda | null>(null);
  const [agendaFailed, setAgendaFailed] = useState(false);
  const story = useShowcaseTime();

  useEffect(() => {
    const controller = new AbortController();
    const live = () => !controller.signal.aborted;
    const at = story ?? Date.now();
    setNow(at);

    const loadThreads = () =>
      void getSpectraThreads({ limit: RECENT_THREADS })
        .then(({ threads: rows }) => live() && setThreads(rows.filter((thread) => thread.status === "active")))
        .catch(() => live() && setThreads((current) => current ?? []));
    loadThreads();
    const offThreads = spectraBus.on("threads.changed", loadThreads);

    void getSpectraOverview()
      .then((overview) => {
        if (!live()) return;
        const recent = overview.artifacts
          /* What the student made or opened; tasks that came in from ManageBac
             are on the week above, not work to pick up. */
          .filter(
            (artifact) =>
              artifact.status === "active" && artifact.blueprintKey !== "thread_reference" && !artifact.tags.includes("managebac"),
          )
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, RECENT_WORKS);
        setWorks(recent);
      })
      .catch(() => live() && setWorks([]));

    const from = startOfLocalDay(at);
    void fetchCalendarOverview(from, addLocalDays(from, AGENDA_DAYS), { signal: controller.signal, maxPages: 2 })
      .then(({ overview }) => live() && setAgenda(splitAgenda(overview.items, overview.unscheduledTasks, at)))
      .catch(() => live() && setAgendaFailed(true));

    return () => {
      controller.abort();
      offThreads();
    };
  }, [story]);

  return { now, name, threads, works, agenda, agendaFailed };
}
