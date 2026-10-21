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

export type TaskPeekState = { item: CalendarItem; anchor: DOMRect };

/** The ManageBac record behind a school deadline, which opens as its task work. */
export function schoolRecordOf(item: CalendarItem) {
  return item.kind === "official_deadline" && item.source?.provider === "managebac" ? item.source.recordId : undefined;
}

/** Whether a calendar item is a task (or time given to one) that can open beside its block. */
export function isPeekable(item: CalendarItem) {
  return Boolean(planWorkId(item) || schoolRecordOf(item));
}

export function useTaskPeek() {
  const [peek, setPeek] = useState<TaskPeekState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** The pointer came to rest on a block (`element`), or left it (null). */
  const rest = useCallback((item: CalendarItem, element: HTMLElement | null) => {
    window.clearTimeout(timer.current);
    if (!element) {
      timer.current = window.setTimeout(() => setPeek(null), LEAVE_MS);
      return;
    }
    if (!isPeekable(item)) return;
    timer.current = window.setTimeout(() => {
      setPeek((current) => (current?.item.id === item.id ? current : { item, anchor: element.getBoundingClientRect() }));
    }, REST_MS);
  }, []);

  const hold = useCallback(() => window.clearTimeout(timer.current), []);
  const release = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(null), LEAVE_MS);
  }, []);
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setPeek(null);
  }, []);

  return { peek, rest, hold, release, close };
}
