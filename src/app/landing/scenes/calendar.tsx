"use client";

/**
 * Scene 9 — a plan that knows what is already in your week.
 *
 * Spectra schedules three study blocks. It does not schedule them into empty
 * space, because the week is not empty: there is a lesson, a football match, and
 * an official deadline that arrived from school and therefore cannot be moved.
 *
 * The rules being obeyed are the product's own, from `calendar/domain`. A block
 * is a `scheduled_work_block` and `assertTemporalSeparation` refuses to accept
 * one that is not linked to a task, so every block here carries the plan task it
 * came from. The deadline is `sourceLocked`, which is why Pablo drags a block
 * around it rather than through it.
 */

import { useMemo } from "react";
import { CALENDAR_LAYERS, type CalendarItem } from "@/features/spectra/calendar/domain/model";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import {
  Body,
  Chip,
  Headline,
  Marker,
  Plate,
  useSceneT,
} from "../story/scene-kit";
import { clamp01, type Beat } from "../story/beats";
import {
  WEEK_DAYS,
  WEEK_HOURS,
  WEEK_START,
  slot,
  STUDY_PLAN,
} from "../story/work";

export const CALENDAR_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.02,
    to: 0.1,
    path: "calendar/marker",
    primitive: "richtext",
    act: { kind: "type", text: "Into a real week" },
  },
  {
    actor: "spectra",
    from: 0.1,
    to: 0.21,
    path: "calendar/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "Time you" },
  },
  {
    actor: "spectra",
    from: 0.21,
    to: 0.32,
    path: "calendar/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "actually have." },
  },

  /* Three blocks, placed one at a time, each around something already there. */
  {
    actor: "spectra",
    from: 0.32,
    to: 0.42,
    path: "calendar/block/block-mon",
    primitive: "timelineEvent",
    label: "Read chapter 4",
    act: { kind: "create" },
    note: "After Monday's lesson",
  },
  {
    actor: "spectra",
    from: 0.42,
    to: 0.51,
    path: "calendar/block/block-tue",
    primitive: "timelineEvent",
    label: "Write the summary",
    act: { kind: "create" },
    note: "Tuesday, while it is fresh",
  },
  {
    actor: "spectra",
    from: 0.51,
    to: 0.6,
    path: "calendar/block/block-thu",
    primitive: "timelineEvent",
    label: "Recheck the data",
    act: { kind: "create" },
    note: "Thursday, before the deadline",
  },

  /* The one that will not fit. Football is real, so the block moves. */
  {
    actor: "pablo",
    from: 0.62,
    to: 0.76,
    path: "calendar/block/block-thu",
    primitive: "timelineEvent",
    label: "Recheck the data",
    act: { kind: "drag", to: "calendar/slot/wed-18" },
    note: "Football is on Thursday",
  },
  {
    actor: "pabloAi",
    from: 0.76,
    to: 0.84,
    path: "calendar/deadline",
    primitive: "timelineEvent",
    label: "Hand in, Friday 09:00",
    act: { kind: "hover" },
    note: "The deadline stays where school put it",
  },
  {
    actor: "spectra",
    from: 0.84,
    to: 0.98,
    path: "calendar/body",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "Move a block and the plan moves with it. The deadline came from school, so nobody here gets to drag it.",
    },
  },
];

const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;

/**
 * The week, as calendar items.
 *
 * Every work block names the plan task it came from, because a block without a
 * task is exactly what `assertTemporalSeparation` throws on. The deadline is
 * `sourceLocked` and its own kind, which is why it draws differently.
 */
function weekItems(moved: boolean): CalendarItem[] {
  const base = {
    allDay: false,
    timezone: "UTC",
    timePrecision: "exact" as const,
    status: "active" as const,
    linkedWorkIds: ["work-ecosystems"],
    revision: 1,
  };
  return [
    {
      ...base,
      id: "lesson-mon",
      kind: "official_event",
      title: "Biology, lab 2",
      startAt: slot(0, 15, 30),
      endAt: slot(0, 16, 30),
      sourceLocked: true,
      teacher: "Ms Oyelaran",
      linkedWorkIds: [],
    },
    {
      ...base,
      id: "football",
      kind: "personal_event",
      title: "Football",
      startAt: slot(3, 17, 0),
      endAt: slot(3, 19, 0),
      sourceLocked: false,
      linkedWorkIds: [],
    },
    {
      ...base,
      id: "deadline-friday",
      kind: "official_deadline",
      title: "Ecosystems notes due",
      startAt: slot(4, 9, 0),
      endAt: slot(4, 9, 0),
      sourceLocked: true,
      source: {
        provider: "School timetable",
        state: { kind: "available" },
        freshAt: WEEK_START,
      },
    },
    {
      ...base,
      id: "block-mon",
      kind: "scheduled_work_block",
      title: "Read chapter 4",
      startAt: slot(0, 17, 0),
      endAt: slot(0, 17, 40),
      sourceLocked: false,
      planArtifactId: "plan-ecosystems",
      planTaskId: "task-read",
      officialDeadlineItemId: "deadline-friday",
    },
    {
      ...base,
      id: "block-tue",
      kind: "scheduled_work_block",
      title: "Write the summary",
      startAt: slot(1, 16, 30),
      endAt: slot(1, 17, 30),
      sourceLocked: false,
      planArtifactId: "plan-ecosystems",
      planTaskId: "task-calvin",
      officialDeadlineItemId: "deadline-friday",
    },
    {
      ...base,
      id: "block-thu",
      kind: "scheduled_work_block",
      title: "Recheck the data",
      startAt: moved ? slot(2, 18, 0) : slot(3, 18, 0),
      endAt: moved ? slot(2, 18, 40) : slot(3, 18, 40),
      sourceLocked: false,
      planArtifactId: "plan-ecosystems",
      planTaskId: "task-data",
      officialDeadlineItemId: "deadline-friday",
    },
  ];
}

const LAYER_BY_KIND = new Map(
  CALENDAR_LAYERS.flatMap((layer) =>
    layer.itemKinds.map((kind) => [kind, layer] as const),
  ),
);

/** Which grid column an item is in, and where in it. */
function place(item: CalendarItem) {
  const start = item.startAt ?? WEEK_START;
  const weekday = Math.floor((start - WEEK_START) / DAY_MS);
  const minutes = (start - WEEK_START - weekday * DAY_MS) / 60_000;
  const span = Math.max(
    24,
    ((item.endAt ?? start + 40 * 60_000) - start) / 60_000,
  );
  return { weekday, minutes, span };
}

const ROW = 46;

export function CalendarScene() {
  const t = useSceneT("calendar");
  const moved = t >= 0.74;
  const items = useMemo(() => weekItems(moved), [moved]);

  /* Blocks appear when Spectra places them, in order, so the week fills up the
     way a plan does rather than all at once. */
  const placedAt: Record<string, number> = {
    "block-mon": 0.36,
    "block-tue": 0.45,
    "block-thu": 0.54,
  };

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let hour = WEEK_HOURS.from; hour <= WEEK_HOURS.to; hour += 1)
      list.push(hour);
    return list;
  }, []);

  const scheduled = items.filter(
    (item) => item.kind === "scheduled_work_block",
  ).length;

  return (
    <SceneRegion scene="calendar">
      <div className="relative h-full">
        <div className="flex items-end gap-14 pb-7">
          <div className="w-[356px] shrink-0">
            <Marker
              beats={CALENDAR_BEATS}
              scene="calendar"
              path="calendar/marker"
            />
            <Headline
              beats={CALENDAR_BEATS}
              scene="calendar"
              size="support"
              paths={["calendar/line-1", "calendar/line-2"]}
              className="mt-4"
            />
          </div>
          <Body
            beats={CALENDAR_BEATS}
            scene="calendar"
            path="calendar/body"
            className="flex-1"
          />
        </div>

        <Plate
          scene="calendar"
          path="calendar/week"
          title="This week"
          meta="Biology"
          trailing={
            <>
              <Chip tone="violet">{scheduled} blocks</Chip>
              <Chip tone="gold">Friday 09:00</Chip>
            </>
          }
          style={{ height: 470 }}
        >
          <div className="landing-week">
            {/* Hours down the side. A calendar without them is a diagram. */}
            <div className="landing-week-hours" aria-hidden="true">
              {hours.map((hour) => (
                <span key={hour} style={{ height: ROW }}>
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>

            <div className="landing-week-grid">
              {WEEK_DAYS.map((day, weekday) => (
                <div
                  key={day}
                  className="landing-week-day"
                  {...targetAttrs(
                    `calendar/slot/${day.slice(0, 3).toLowerCase()}`,
                    undefined,
                    "gridCell",
                  )}
                >
                  <span className="landing-week-name">{day}</span>
                  <div
                    className="landing-week-column"
                    style={{ height: hours.length * ROW }}
                  >
                    {hours.map((hour) => (
                      <span
                        key={hour}
                        className="landing-week-rule"
                        style={{ top: (hour - WEEK_HOURS.from) * ROW }}
                        aria-hidden="true"
                      />
                    ))}

                    {items
                      .filter((item) => place(item).weekday === weekday)
                      .map((item) => {
                        const spot = place(item);
                        const layer = LAYER_BY_KIND.get(item.kind);
                        const appears = placedAt[item.id] ?? 0;
                        const shown = t >= appears;
                        const deadline = item.kind === "official_deadline";
                        return (
                          <article
                            key={item.id}
                            className="landing-week-item"
                            data-kind={item.kind}
                            data-locked={item.sourceLocked ? "true" : "false"}
                            style={{
                              top: deadline
                                ? 0
                                : ((spot.minutes / 60 - WEEK_HOURS.from) * ROW),
                              height: deadline
                                ? 24
                                : (spot.span / 60) * ROW - 3,
                              "--item-ink": layer?.color ?? "var(--text-tertiary)",
                              opacity: shown ? 1 : 0,
                              transform: `translate3d(0, ${
                                shown ? 0 : 8
                              }px, 0) scale(${shown ? 1 : 0.97})`,
                            } as React.CSSProperties}
                            {...targetAttrs(
                              item.kind === "official_deadline"
                                ? "calendar/deadline"
                                : `calendar/block/${item.id}`,
                              undefined,
                              "timelineEvent",
                            )}
                          >
                            <span className="landing-week-title">
                              {item.title}
                            </span>
                            {item.sourceLocked ? (
                              <span className="landing-week-note">
                                {deadline ? "From school" : item.teacher}
                              </span>
                            ) : item.planTaskId ? (
                              <span className="landing-week-note">
                                {taskTitle(item.planTaskId)}
                              </span>
                            ) : null}
                          </article>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Plate>

        {/* The rule being obeyed, stated once, in the product's own terms. */}
        <p
          className="mt-4 text-ui leading-[1.5] text-[var(--text-tertiary)]"
          style={{
            opacity: clamp01((t - 0.78) / 0.08),
            transition: "opacity var(--motion-slow) var(--ease-standard)",
          }}
        >
          Work blocks belong to plan tasks, so moving one keeps the task it came
          from. Deadlines that arrived from school stay locked to their source.
        </p>
      </div>
    </SceneRegion>
  );
}

function taskTitle(taskId: string): string {
  return (
    STUDY_PLAN.tasks.find((task) => task.id === taskId)?.title ?? "Plan task"
  );
}
