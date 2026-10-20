"use client";

import { useState, type Ref } from "react";
import { Plus } from "@/components/icons/glyph-icons";
import { DuePicker } from "../task/due-picker";
import { taskInputs, taskInstant } from "../task/task-time";

/*
 * The last line of a list, waiting for the next task. Enter writes it and
 * keeps the caret here, so a plan is typed out one line after another. Its
 * day can be chosen before it is written, at the line's end; without one the
 * task is simply undated.
 */

const ALL_DAY = "23:59";

export function PlanAddLine({
  label,
  placeholder = "Add a task",
  inputRef,
  now,
  timeZone,
  reminderTime,
  onAdd,
}: {
  label: string;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  now: number;
  timeZone: string;
  reminderTime: string;
  onAdd: (title: string, dueAt?: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [dueAt, setDueAt] = useState<number>();
  return (
    <form
      className="plan-add"
      data-drafting={draft.trim() || dueAt !== undefined ? "" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        const title = draft.trim();
        if (!title) return;
        onAdd(title.slice(0, 500), dueAt);
        setDraft("");
        setDueAt(undefined);
      }}
    >
      <Plus className="size-3.5" aria-hidden />
      <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} aria-label={label} />
      <DuePicker
        due={dueAt ?? null}
        allDay={dueAt === undefined || taskInputs(dueAt, timeZone).time === ALL_DAY}
        now={now}
        timeZone={timeZone}
        reminderTime={reminderTime}
        className="plan-add-due"
        onDue={(date, time) => setDueAt(date ? taskInstant(date, time, timeZone) : undefined)}
      />
    </form>
  );
}
