"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Plus } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { DayField, TimeField } from "@/components/ui/when-fields";
import { addDays, todayKey, type DayKey } from "@/components/ui/when";
import { beginCreation } from "../../life/use-life";

/*
 * Adding something of one's own to the Calendar. An event takes a day and the
 * hours it fills (an end before its start runs past midnight); a task takes
 * the day it is due and, if it has one, a time. A task without a time sits in
 * the day's row above the hours.
 */

type Kind = "personal_event" | "task";

export type CalendarDraft = {
  kind: Kind;
  title: string;
  startAt: number;
  endAt?: number;
  allDay?: boolean;
};

/** A day and time on this device's clock. */
function localInstant(day: DayKey, time: string) {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year!, month! - 1, date!, hour, minute).getTime();
}

function nextHour(now: number) {
  const hour = new Date(now).getHours() + 1;
  return hour > 23 ? null : `${String(hour).padStart(2, "0")}:00`;
}

function laterBy(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour! * 60 + minute! + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function minutesOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
}

export function CalendarComposer({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  /** Writes it; a rejection is shown here and the composer stays open. */
  onCreate: (draft: CalendarDraft) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>("personal_event");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState<DayKey>(() => todayKey());
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    const hour = nextHour(now);
    setKind("personal_event");
    setTitle("");
    setDay(hour ? todayKey(now) : addDays(todayKey(now), 1));
    setStart(hour ?? "09:00");
    setEnd(laterBy(hour ?? "09:00", 60));
    setDueAt("");
  }, [open]);

  const event = kind === "personal_event";
  const overnight = event && minutesOf(end) <= minutesOf(start);
  const changeStart = (next: string) => {
    if (!next) return;
    // The event keeps its length when its start moves.
    const length = (minutesOf(end) - minutesOf(start) + 24 * 60) % (24 * 60) || 60;
    setStart(next);
    setEnd(laterBy(next, length));
  };

  const submit = () => {
    const draft: CalendarDraft = event
      ? {
          kind,
          title,
          startAt: localInstant(day, start),
          endAt: localInstant(overnight ? addDays(day, 1) : day, end),
        }
      : dueAt
        ? { kind, title, startAt: localInstant(day, dueAt), endAt: localInstant(day, dueAt) }
        : { kind, title, startAt: localInstant(day, "00:00"), allDay: true };
    setBusy(true);
    // Dots gather at the press; what was added grows out of them where it lands.
    const creation = beginCreation({ into: "item" });
    void onCreate(draft)
      .then(() => creation.land())
      .catch((error) => {
        creation.cancel();
        toast.error(error instanceof Error ? error.message : "Could not add it to your calendar.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="calendar-composer max-w-[440px] gap-0 p-5">
        <form
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            if (title.trim() && !busy) submit();
          }}
        >
          <div className="calendar-composer-head">
            <DialogTitle>{event ? "Add an event" : "Add a task"}</DialogTitle>
            <Segmented
              size="compact"
              label="What to add"
              value={kind}
              onChange={setKind}
              options={[
                { value: "personal_event", label: "Event" },
                { value: "task", label: "Task" },
              ]}
            />
          </div>
          <input
            autoFocus
            required
            aria-label="Title"
            placeholder={event ? "Football practice, dentist, study group" : "Revise chapter 4, email Ms Ortiz"}
            value={title}
            onChange={(change) => setTitle(change.target.value)}
            className="calendar-composer-title"
          />
          <div className="calendar-composer-when">
            <DayField label={event ? "Day" : "Due day"} value={day} onChange={setDay} />
            {event ? (
              <div className="calendar-composer-hours">
                <TimeField label="Starts" value={start} onChange={changeStart} />
                <span aria-hidden>–</span>
                <TimeField label="Ends" value={end} onChange={(next) => next && setEnd(next)} from={start} />
              </div>
            ) : (
              <TimeField label="Due time" placeholder="Any time that day" value={dueAt} onChange={setDueAt} opensAt="17:00" />
            )}
          </div>
          <p className="calendar-composer-hint">
            {event
              ? overnight
                ? "It ends the next morning."
                : "Drag it on the calendar later to move or stretch it."
              : dueAt
                ? "Due at that time."
                : "Without a time it sits at the top of the day."}
          </p>
          <DialogFooter className="mt-5">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !title.trim()}>
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {event ? "Add event" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
