"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LockKeyhole } from "@/components/icons/glyph-icons";
import { Icon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SpectraStoredText } from "../../components/spectra-rich-content";
import { spectraBus } from "../../events";
import { useLifeLanding } from "../../life/use-life";
import { plainTextFromStored } from "../../rich-content";
import { dueLabel } from "../../school/school-model";
import type { DeadlineClass } from "../../school/use-deadline-classes";
import { formatDay, formatTime, isDeadline, isReschedulable, layerFor } from "../domain/item-format";
import { CALENDAR_LAYERS, type CalendarItem } from "../domain/model";

/** What was opened on the week, and where it sat when it was. */
export type OpenedCalendarItem = { item: CalendarItem; anchor: DOMRect };

/**
 * An event or block of time opens beside itself, on the week, rather than in a
 * panel of its own: the week stays whole, and the details go when the week is
 * touched again. Plans and school tasks open as their task instead.
 */
export function CalendarItemCard({
  opened,
  schoolClass,
  timezone,
  onCommit,
  onRemove,
  onMerge,
  onClose,
}: {
  opened: OpenedCalendarItem | null;
  schoolClass: DeadlineClass | null;
  timezone: string;
  onCommit: (action: Record<string, unknown>) => Promise<void>;
  onRemove: (item: CalendarItem) => Promise<boolean>;
  /** Time given to a deadline goes back into it. */
  onMerge: (item: CalendarItem) => Promise<void>;
  onClose: () => void;
}) {
  const anchor = opened?.anchor;
  return (
    <Popover open={Boolean(opened)} onOpenChange={(open) => (open ? undefined : onClose())}>
      {/* The anchor holds the block's place on the screen, so it lives on the page itself: inside a
          scaled or moving window "fixed" would be measured from that window instead. */}
      {anchor
        ? createPortal(
            <PopoverAnchor asChild>
              <div
                aria-hidden
                className="pointer-events-none fixed"
                style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}
              />
            </PopoverAnchor>,
            document.body,
          )
        : null}
      {opened ? (
        <PopoverContent
          side="right"
          align="start"
          sideOffset={10}
          className="w-[300px] p-3"
          // Its own confirmation opens over it without taking it away.
          onFocusOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if ((event.target as Element | null)?.closest?.("[role=dialog],[role=alertdialog]")) event.preventDefault();
          }}
        >
          <CalendarItemDetails
            key={opened.item.id}
            item={opened.item}
            schoolClass={schoolClass}
            timezone={timezone}
            onCommit={onCommit}
            onRemove={onRemove}
            onMerge={onMerge}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function CalendarItemDetails({
  item,
  schoolClass,
  timezone,
  onCommit,
  onRemove,
  onMerge,
}: {
  item: CalendarItem;
  /** The class it is due in, or works towards. */
  schoolClass: DeadlineClass | null;
  timezone: string;
  onCommit: (action: Record<string, unknown>) => Promise<void>;
  onRemove: (item: CalendarItem) => Promise<boolean>;
  onMerge: (item: CalendarItem) => Promise<void>;
}) {
  const layer = CALENDAR_LAYERS.find((candidate) => candidate.key === layerFor(item))!;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The block it was opened from grows into these details.
  useLifeLanding(ref, `calendar:${item.id}`);
  // School records belong to their source; everything a person placed here
  // (events, scheduled work) can be taken off again.
  const removable = !item.sourceLocked;
  // Notes arrive as editor HTML or Markdown from a plan, Spectra or ManageBac:
  // they are drawn by the shared renderer, and an empty editor value shows nothing.
  const hasNotes = item.notes ? Boolean(plainTextFromStored(item.notes)) : false;
  const due = isDeadline(item);
  // Time given to a school task says which task it is for and when that is due.
  const towards = item.kind === "scheduled_work_block" ? schoolClass?.task : undefined;
  const work = item.kind === "scheduled_work_block";
  // Time given to a task, and a task of one's own, are checked off (and back on).
  const checkable = work || item.kind === "task";
  const completed = item.status === "completed";
  // A moment (a task due then) moves but has no length to change.
  const resizable = isReschedulable(item) && !due && !item.allDay && item.startAt !== undefined && item.endAt !== undefined;
  const resize = (minutes: number) =>
    void onCommit({
      action: "resizeWorkBlock",
      itemId: item.id,
      endAt: Math.max(item.startAt! + 15 * 60_000, item.endAt! + minutes * 60_000),
      expectedRevision: item.revision,
    });
  return (
    <div ref={ref} aria-label={`${item.title} details`} className="calendar-card">
      {/* What it belongs to, and what can be done with it, in one line along the top. */}
      <div className="calendar-card-bar">
        <span className="calendar-card-kind">
          <span className="h-3 w-[3px] rounded-full" style={{ background: schoolClass?.identity?.ink ?? layer.color }} />
          <span className="truncate">{schoolClass?.identity?.name ?? layer.label}</span>
          {item.sourceLocked ? <LockKeyhole className="size-3 shrink-0" /> : null}
        </span>
        {item.linkedWorkIds.map((workId) => (
          <IconButton
            key={workId}
            icon="openSide"
            size="compact"
            label={workId === item.planArtifactId ? "Open plan" : "Open linked artifact"}
            data-life-launch
            onClick={() => void spectraBus.command("work.open", { workId })}
          />
        ))}
        {item.source?.url ? (
          <IconButton
            icon="external"
            size="compact"
            label={`Open in ${item.source.provider}`}
            onClick={() => window.open(item.source!.url, "_blank", "noreferrer")}
          />
        ) : null}
        {removable ? <IconButton icon="trash" size="compact" label="Remove from Calendar" onClick={() => setConfirmRemove(true)} /> : null}
      </div>
      <div className="calendar-card-title">
        {checkable ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={completed}
            aria-label={completed ? "Mark as not done" : "Mark as done"}
            title={completed ? "Mark as not done" : "Mark as done"}
            onClick={() =>
              void onCommit({
                action: "completeWorkBlock",
                itemId: item.id,
                expectedRevision: item.revision,
                ...(completed ? { done: false } : {}),
              })
            }
            className="calendar-card-check"
          >
            {completed ? <Icon name="check" size={14} /> : null}
          </button>
        ) : null}
        <h2 className={cn(completed && "text-[var(--text-tertiary)] line-through")}>{item.title}</h2>
      </div>
      <p className="calendar-card-time">
        {item.startAt === undefined
          ? "Date only"
          : item.allDay
            ? item.endAt !== undefined && item.endAt - item.startAt > 86_400_000
              ? `${formatDay(item.startAt, timezone)} – ${formatDay(item.endAt - 1, timezone)}, all day` // The end is exclusive.
              : `${formatDay(item.startAt, timezone)}, all day`
            : `${due ? "Due " : ""}${formatDay(item.startAt, timezone)}, ${formatTime(item.startAt, timezone)}${item.endAt !== undefined && !due ? ` – ${formatTime(item.endAt, timezone)}` : ""}`}
        {resizable ? (
          <span className="calendar-card-length" role="group" aria-label="Duration">
            <button type="button" aria-label="30 minutes shorter" onClick={() => resize(-30)}>−30</button>
            <button type="button" aria-label="30 minutes longer" onClick={() => resize(30)}>+30</button>
          </span>
        ) : null}
      </p>
      {towards && towards.title.trim() !== item.title.trim() ? (
        <p className="calendar-card-line">
          For {towards.title}
          {towards.dueAt ? `, ${dueLabel(towards.dueAt, Date.now())?.toLocaleLowerCase() ?? ""}` : ""}
        </p>
      ) : towards?.dueAt ? (
        <p className="calendar-card-line">{dueLabel(towards.dueAt, Date.now())}</p>
      ) : null}
      {/* Time dragged out of a deadline can go back into it (or be dropped on it). */}
      {item.officialDeadlineItemId ? (
        <button type="button" className="calendar-card-merge" onClick={() => void onMerge(item)}>
          <Icon name="undo" size={13} />
          Merge back into the deadline
        </button>
      ) : null}
      {item.location ? (
        <p className="calendar-card-line">
          <Icon name="location" size={13} />
          {item.location}
        </p>
      ) : null}
      {hasNotes ? (
        <div className="calendar-card-notes">
          <SpectraStoredText value={item.notes!} className="text-ui" />
        </div>
      ) : null}
      {item.source ? (
        <p className="calendar-card-source">
          {item.source.provider} sets the official time. Give it time of your own with a plan.
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove “${item.title}”?`}
        detail={
          work
            ? "The scheduled time is removed from Calendar. The plan itself is kept and can be placed again."
            : item.kind === "task"
              ? "This task is removed from your Calendar."
              : "This event is removed from your Calendar."
        }
        confirmLabel="Remove"
        destructive
        pending={removing}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setRemoving(true);
          void onRemove(item).then((removed) => {
            setRemoving(false);
            if (!removed) setConfirmRemove(false);
          });
        }}
      />
    </div>
  );
}
