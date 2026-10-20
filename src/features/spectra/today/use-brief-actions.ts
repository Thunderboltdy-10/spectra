"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { planWorkId } from "../calendar/ui/calendar-plans";
import { createDefaultArtifactPayload } from "../components/artifact-blueprint-sheet";
import { openWorkInSide } from "../components/side-open";
import { taskInstant } from "../components/task/task-time";
import { spectraBus } from "../events";
import { useOpenSchoolTask } from "../school/open-school-task";
import { useDeadlineClasses } from "../school/use-deadline-classes";
import type { BriefSuggestion, BriefTaskDraft } from "./daily-brief";
import type { TodayAgenda } from "./today-model";

/*
 * What a press on one of the brief's suggestions does (HOME.md, "The morning
 * brief"). Each one is a single press: Spectra starts making the work, the
 * task is added with everything the brief filled in, a work or a task opens
 * beside Home, a question waits in the dock to send. What was made or added
 * is kept on the suggestion, so the brief shows it done and opens it after.
 */

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** A planner task's content with the brief's draft filled in. */
function plannerContent(draft: BriefTaskDraft) {
  const base = createDefaultArtifactPayload("planner_task").content as Record<string, unknown>;
  const timeZone = localZone();
  return {
    ...base,
    taskTitle: draft.title,
    ...(draft.notes ? { description: draft.notes } : {}),
    ...(draft.dueDay
      ? { dueAt: taskInstant(draft.dueDay, draft.dueTime ?? null, timeZone), allDay: !draft.dueTime }
      : {}),
    ...(draft.estimateMinutes ? { estimateMinutes: draft.estimateMinutes } : {}),
    ...(draft.steps?.length
      ? { subtasks: draft.steps.map((title, index) => ({ id: `step-${index + 1}`, title, done: false })) }
      : {}),
    timezone: timeZone,
  };
}

export function useBriefActions(day: string, agenda: TodayAgenda | null) {
  const router = useRouter();
  const { open: openTask } = useOpenSchoolTask();
  const classOf = useDeadlineClasses();
  const create = useMutation(api.spectraArtifacts.create);
  const mark = useMutation(api.dailyBriefs.mark);

  const openAgendaTask = useCallback(
    (id: string) => {
      if (id.startsWith("school:")) return void openTask(id.slice("school:".length));
      const item = agenda && [...agenda.today, ...agenda.upcoming, ...agenda.open].find((entry) => entry.id === id);
      const task = item && classOf(item.title, item.startAt)?.task;
      if (task) return void openTask(task.recordId);
      const work = item && planWorkId(item);
      if (work) return openWorkInSide(work);
      router.push("/calendar");
    },
    [agenda, classOf, openTask, router],
  );

  return useCallback(
    async (suggestion: BriefSuggestion, index: number) => {
      if (suggestion.doneId) return openWorkInSide(suggestion.doneId);
      switch (suggestion.kind) {
        case "make":
          spectraBus.emit("island.compose", { fresh: true, text: suggestion.prompt, send: true });
          await mark({ day, index });
          return;
        case "ask":
          return spectraBus.emit("island.compose", { fresh: true, text: suggestion.prompt });
        case "open":
          return suggestion.targetId && openWorkInSide(suggestion.targetId);
        case "task":
          return suggestion.targetId && openAgendaTask(suggestion.targetId);
        case "add": {
          if (!suggestion.task) return;
          const { artifactId } = await create({
            blueprintKey: "planner_task",
            title: suggestion.task.title,
            summary: suggestion.task.notes ?? "",
            content: plannerContent(suggestion.task),
            source: "manual",
            parentNodeId: "root",
          });
          openWorkInSide(artifactId);
          await mark({ day, index, doneId: artifactId });
        }
      }
    },
    [create, day, mark, openAgendaTask],
  );
}
