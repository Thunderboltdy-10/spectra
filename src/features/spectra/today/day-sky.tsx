"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useShowcaseTime } from "../showcase/showcase-time";

/*
 * The time on Home, drawn as the sky (HOME.md, "The morning brief"). The
 * sun crosses its arc through the day and sets; the moon rises for the
 * night. It follows the reader's own clock minute by minute, and the body in
 * the sky turns a little toward a hand that comes near it.
 */

const SUNRISE = 6 * 60;
const SUNSET = 20 * 60;
const DAY = 24 * 60;

export type SkyBody = "sun" | "moon";

/** What stands in the sky at a minute of the day, and how far along its arc (0 rising, 1 setting). */
export function skyAt(minute: number): { body: SkyBody; across: number } {
  if (minute >= SUNRISE && minute < SUNSET) return { body: "sun", across: (minute - SUNRISE) / (SUNSET - SUNRISE) };
  return { body: "moon", across: ((minute - SUNSET + DAY) % DAY) / (DAY - (SUNSET - SUNRISE)) };
}

/** The reader's clock, read again at the turn of each minute. Null until mounted, so the server never guesses it. */
function useMinute() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const at = new Date();
      setNow(at);
      timer = window.setTimeout(tick, 60_000 - (at.getSeconds() * 1000 + at.getMilliseconds()) + 50);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

export function DaySky() {
  const clock = useMinute();
  const story = useShowcaseTime();
  const now = story === null ? clock : new Date(story);
  const clip = useId();
  const root = useRef<HTMLDivElement>(null);

  // A hand near the sky: the sun's rays and the moon turn toward it. Set as CSS
  // variables, so following the pointer never renders again.
  const lean = (event: ReactPointerEvent<HTMLDivElement>) => {
    const body = root.current?.querySelector(".day-sky-body")?.getBoundingClientRect();
    if (!body) return;
    const dx = (event.clientX - (body.left + body.width / 2)) / 90;
    const dy = (event.clientY - (body.top + body.height / 2)) / 90;
    root.current?.style.setProperty("--lean-x", String(Math.max(-1, Math.min(1, dx))));
    root.current?.style.setProperty("--lean-y", String(Math.max(-1, Math.min(1, dy))));
  };
  const rest = () => {
    root.current?.style.setProperty("--lean-x", "0");
    root.current?.style.setProperty("--lean-y", "0");
  };

  if (!now) return <div className="day-sky" aria-hidden />;
  const { body, across } = skyAt(now.getHours() * 60 + now.getMinutes());
  const x = 10 + 44 * across;
  const y = 31 - 20 * Math.sin(Math.PI * across);

  return (
    <div ref={root} className="day-sky" data-body={body} onPointerMove={lean} onPointerLeave={rest}>
      <svg className="day-sky-art" viewBox="0 0 64 40" aria-hidden>
        <clipPath id={clip}>
          <rect x="-12" y="-24" width="88" height="55" />
        </clipPath>
        <g clipPath={`url(#${clip})`}>
          <g className="day-sky-place" style={{ transform: `translate(${x}px, ${y}px)` }}>
            {/* Keyed by the body, so sunset brings the moon up over the horizon, and dawn the sun. */}
            <g key={body} className="day-sky-rise">
              <g className="day-sky-body">
                {body === "sun" ? (
                  <>
                    <g className="day-sky-rays">
                      <path d="M0-14v4M0 10v4M-14 0h4M10 0h4M-9.9-9.9l2.8 2.8M7.1 7.1l2.8 2.8M-9.9 9.9l2.8-2.8M7.1-7.1l2.8-2.8" />
                    </g>
                    <circle className="day-sky-sun" r="7.5" />
                  </>
                ) : (
                  <path className="day-sky-moon" d="M3.5-6.06A7 7 0 1 0 3.5 6.06 6.2 6.2 0 0 1 3.5-6.06Z" />
                )}
              </g>
            </g>
          </g>
        </g>
        <path className="day-sky-horizon" d="M2 31h60" />
      </svg>
      <time className="morning-time" dateTime={now.toISOString()}>
        {timeFormat.format(now)}
      </time>
      <span className="day-sky-date">{dateFormat.format(now)}</span>
    </div>
  );
}

/** What part of the day it is, for the brief's name. */
export function dayPart(hour: number) {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}
