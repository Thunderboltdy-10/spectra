"use client";

import { useMemo } from "react";
import type { PlanTimelineView } from "../../plan/projections";
import { shortDate, STATUS_INK } from "./plan-format";

/*
 * The plan in time (EDITORS.md, "Plan"): a lane per task with its name in a
 * column of its own, so a mark on the axis only has to say when. A deadline
 * with no known start is a dot; estimated work is a bar up to it. Today is a
 * line down every lane.
 */

export function PlanTimeline({
  timeline,
  now,
  openTaskId,
  onOpen,
}: {
  timeline: PlanTimelineView;
  now: number;
  openTaskId?: string;
  onOpen: (taskId: string) => void;
}) {
  const range = timeline.window;
  const span = range ? range.to - range.from || 1 : 1;
  const at = (instant: number) => (range ? ((instant - range.from) / span) * 100 : 0);
  // Four dates along the axis, so the reader can tell where a mark sits inside the range.
  const ticks = useMemo(() => (range ? [0, 1, 2, 3].map((step) => ({ at: (step / 3) * 100, label: shortDate(range.from + (span * step) / 3) })) : []), [span, range]);
  const todayAt = range && now >= range.from && now <= range.to ? at(now) : undefined;

  return (
    <div className="editor-sheet plan-timeline">
      {range ? (
        <div className="plan-lanes" role="list">
          <div className="plan-axis" aria-hidden>
            <span />
            <div>
              {ticks.map((tick) => (
                <span key={tick.at} style={{ left: `${tick.at}%` }}>
                  {tick.label}
                </span>
              ))}
            </div>
            <span />
          </div>
          {timeline.bars.map((bar) => (
            <div className="plan-lane" role="listitem" key={bar.task.id} data-open={openTaskId === bar.task.id || undefined}>
              <button type="button" className="plan-lane-name" onClick={() => onOpen(bar.task.id)}>
                {bar.task.title || "Untitled task"}
              </button>
              <div className="plan-lane-track">
                {todayAt !== undefined ? <i className="plan-today" style={{ left: `${todayAt}%` }} aria-hidden /> : null}
                <button
                  type="button"
                  className="plan-bar"
                  data-inferred={bar.inferred || undefined}
                  style={{
                    ["--status-ink" as string]: STATUS_INK[bar.task.status],
                    ...(bar.inferred ? { left: `${at(bar.endAt)}%` } : { left: `${at(bar.startAt)}%`, width: `${at(bar.endAt) - at(bar.startAt)}%` }),
                  }}
                  aria-label={bar.inferred ? `${bar.task.title}, due ${shortDate(bar.endAt)}` : `${bar.task.title}, ${shortDate(bar.startAt)} to ${shortDate(bar.endAt)}`}
                  onClick={() => onOpen(bar.task.id)}
                />
              </div>
              <span className="plan-lane-date">{shortDate(bar.endAt)}</span>
            </div>
          ))}
          {timeline.milestones.length ? (
            <div className="plan-lane" role="listitem">
              <span className="plan-lane-label">Milestones</span>
              <div className="plan-lane-track">
                {timeline.milestones.map((milestone) => (
                  <span key={milestone.id} className="plan-milestone" data-status={milestone.status} style={{ left: `${at(milestone.at)}%` }}>
                    {milestone.title}
                  </span>
                ))}
              </div>
              <span />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="sheet-hint">No task in this plan has a date yet. Give one a due date and the timeline appears.</p>
      )}
      {timeline.unscheduled.length ? (
        <section className="sheet-section" aria-label="Not scheduled">
          <header className="sheet-section-head">
            <h3>Not scheduled</h3>
          </header>
          <div className="sheet-chips">
            {timeline.unscheduled.map((task) => (
              <button key={task.id} type="button" className="sheet-chip" onClick={() => onOpen(task.id)}>
                {task.title || "Untitled task"}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {range ? <p className="sheet-hint">A dot marks a deadline on its own; a bar spans the estimated work up to it. Schedule work blocks in Calendar to place them exactly.</p> : null}
    </div>
  );
}
