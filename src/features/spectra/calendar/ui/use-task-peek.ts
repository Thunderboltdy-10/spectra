"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarItem } from "../domain/model";
import { planWorkId } from "./calendar-plans";

/*
 * When a task on the calendar opens beside its block (task-peek.tsx): after
 * the pointer rests on it a moment, never as it merely passes over. Moving
 * onto the card keeps it; moving away lets it go after a breath, so the
 * pointer can cross the gap between them.
 */

const REST_MS = 420;
const LEAVE_MS = 260;

/** `pinned`: opened by a press, so it stays until pressing elsewhere or Escape. */
export type TaskPeekState = { item: CalendarItem; anchor: DOMRect; pinned?: boolean };

/** The ManageBac record behind a school deadline, which opens as its task work. */
export function schoolRecordOf(item: CalendarItem) {
  return item.kind === "official_deadline" && item.source?.provider === "managebac" ? item.source.recordId : undefined;
}

/** Whether a calendar item is a task (or time given to one) that can open beside its block. */
export function isPeekable(item: CalendarItem) {
  return Boolean(planWorkId(item) || schoolRecordOf(item) || item.officialDeadlineItemId);
}

/**
 * Something added before everything on the calendar was a task: it becomes
 * one when pressed (calendar:adoptAsTask). Lessons and school entries do not.
 */
export function isAdoptable(item: CalendarItem) {
  return (
    ["personal_event", "task", "milestone", "reminder"].includes(item.kind) &&
    !item.sourceLocked &&
    !item.source &&
    !item.seriesId &&
    !planWorkId(item) &&
    // Mirrors calendar:adoptAsTask: it needs a day, and a several-day stretch stays an entry.
    item.startAt !== undefined &&
    !(item.allDay && item.endAt !== undefined && item.endAt - item.startAt > 86_400_000)
  );
}

export function useTaskPeek() {
  const [peek, setPeek] = useState<TaskPeekState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** The pointer came to rest on a block (`element`), or left it (null). */
  const rest = useCallback((item: CalendarItem, element: HTMLElement | null) => {
    window.clearTimeout(timer.current);
    if (!element) {
      timer.current = window.setTimeout(() => setPeek((current) => (current?.pinned ? current : null)), LEAVE_MS);
      return;
    }
    if (!isPeekable(item)) return;
    timer.current = window.setTimeout(() => {
      setPeek((current) => (current?.pinned || current?.item.id === item.id ? current : { item, anchor: element.getBoundingClientRect() }));
    }, REST_MS);
  }, []);

  const hold = useCallback(() => window.clearTimeout(timer.current), []);
  const release = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek((current) => (current?.pinned ? current : null)), LEAVE_MS);
  }, []);
  /** A press: the task opens beside its block at once and stays. */
  const open = useCallback((item: CalendarItem, element: HTMLElement) => {
    window.clearTimeout(timer.current);
    setPeek({ item, anchor: element.getBoundingClientRect(), pinned: true });
  }, []);
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setPeek(null);
  }, []);

  return { peek, rest, hold, release, open, close };
}
