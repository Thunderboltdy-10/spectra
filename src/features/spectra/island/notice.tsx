"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import type { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Point } from "../life/figure";
import { STATUS_COLOURS } from "../life/prism";
import { unformElement, useLifeEntrance } from "../life/use-life";

/*
 * A short word from the island: a thread finished or stopped, a
 * notification arrived, or the app has something to say ("Saved", "Could not
 * move it") (SHELL.md: notifications reach the user through the island). It forms out of the prism's light, waits while the pointer is on
 * it, and parts back into the field when its time is up.
 */

export type NoticeTone = "done" | "problem" | "needs" | "info";

export type IslandNoticeData = {
  key: string;
  text: ReactNode;
  detail?: ReactNode;
  tone: NoticeTone;
  /** One thing to do about it: Undo, Retry. */
  action?: ToastAction;
  /** How long it stays, in milliseconds; `Infinity` until dismissed. */
  duration?: number;
  /** Told when the word goes, however it goes. */
  onGone?: () => void;
  /** A word from the app, by the id it was said with. */
  toastId?: string | number;
  /** A thread's notice opens its thread view. */
  runId?: string;
  /** A notification's notice opens what it is about. */
  notificationId?: string;
};

export const NOTICE_MS = 4800;

const DOT: Record<NoticeTone, string> = {
  done: "bg-[var(--success)]",
  problem: "bg-[var(--danger)]",
  needs: "bg-[var(--warning)]",
  info: "bg-[var(--accent)]",
};

export const NOTICE_COLOUR = {
  done: STATUS_COLOURS.done,
  problem: STATUS_COLOURS.problem,
  needs: STATUS_COLOURS.needs,
  info: STATUS_COLOURS.info,
} as const;

export function IslandNotice({ notice, from, onOpen, onDismiss }: { notice: IslandNoticeData; from: Point | undefined; onOpen: () => void; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeEntrance(ref, { from, bars: "[data-notice-text]", colour: NOTICE_COLOUR[notice.tone] });

  const hovering = useRef(false);
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  const gone = useRef(notice.onGone);
  gone.current = notice.onGone;
  useEffect(() => () => gone.current?.(), []);
  const duration = notice.duration ?? NOTICE_MS;
  useEffect(() => {
    if (!Number.isFinite(duration)) return;
    let left = duration;
    let started = performance.now();
    let timer = 0;
    const expire = () => {
      if (hovering.current) return;
      const element = ref.current;
      if (element) void unformElement(element, { bars: "[data-notice-text]" });
      latest.current();
    };
    timer = window.setTimeout(expire, left);
    const element = ref.current;
    const pause = () => {
      hovering.current = true;
      window.clearTimeout(timer);
      left = Math.max(1200, left - (performance.now() - started));
    };
    const resume = () => {
      hovering.current = false;
      started = performance.now();
      timer = window.setTimeout(expire, left);
    };
    element?.addEventListener("pointerenter", pause);
    element?.addEventListener("pointerleave", resume);
    return () => {
      window.clearTimeout(timer);
      element?.removeEventListener("pointerenter", pause);
      element?.removeEventListener("pointerleave", resume);
    };
  }, [duration]);

  const leave = () => {
    const element = ref.current;
    if (element) void unformElement(element, { bars: "[data-notice-text]" });
    onDismiss();
  };
  const action = notice.action;

  return (
    <div
      ref={ref}
      role="status"
      className="pointer-events-auto inline-flex h-9 max-w-[min(460px,calc(100vw-32px))] items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex h-full min-w-0 items-center gap-2 rounded-full pl-3 pr-2 text-caption text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
      >
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[notice.tone])} />
        <span data-notice-text className="min-w-0 truncate">
          {notice.text}
        </span>
        {notice.detail ? <span className="min-w-0 max-w-[180px] truncate text-[var(--text-tertiary)]">{notice.detail}</span> : null}
      </button>
      {action ? (
        <button
          type="button"
          onClick={async (event) => {
            await action.onClick(event);
            if (!event.defaultPrevented) leave();
          }}
          className="h-7 shrink-0 rounded-full px-2.5 text-caption font-medium text-[var(--text-primary)] outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
        >
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={leave}
        className="mr-1 grid size-7 shrink-0 place-items-center rounded-full text-[var(--text-tertiary)] outline-none hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
