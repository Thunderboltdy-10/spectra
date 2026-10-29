"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useShowcaseTime } from "../showcase/showcase-time";

/*
 * The time on Home, drawn as the sky (HOME.md, "The morning brief"). A small
 * window on the day: its colour follows the hour, the sun crosses its arc and
 * sets behind the hills in a glow, the moon rises for the night with the
 * stars. It follows the reader's own clock minute by minute, and the body in
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

/** The sky through the day: its colour at the top and at the horizon, the land under it, and the glow where the sun is low. */
const SKY: Array<[minute: number, top: string, horizon: string, land: string, glow: string]> = [
  [0, "#141a36", "#2f3767", "#1d2240", "#4a4f8a"],
  [4 * 60 + 40, "#1c2348", "#4b4a7c", "#262a4a", "#7a5d8e"],
  [6 * 60, "#5d6aa6", "#f2a98c", "#5b5670", "#ff9f7a"],
  [7 * 60 + 15, "#9db6e0", "#fbd2ad", "#a8a68e", "#ffc38a"],
  [9 * 60 + 30, "#a9cdf1", "#f2ecdc", "#b9cba0", "#fff1c4"],
  [13 * 60, "#93c4ef", "#e9f2f6", "#b2cd96", "#fff6d8"],
  [17 * 60, "#a2c1ea", "#f7e2c0", "#b8c08f", "#ffd9a0"],
  [19 * 60, "#7d86c4", "#f7a582", "#8f7f78", "#ff9670"],
  [20 * 60, "#4b4f8e", "#d9789a", "#4f4563", "#ff8a7a"],
  [21 * 60 + 15, "#232a54", "#5a4c80", "#28294a", "#8a5f98"],
  [22 * 60 + 30, "#141a36", "#2f3767", "#1d2240", "#4a4f8a"],
  [DAY, "#141a36", "#2f3767", "#1d2240", "#4a4f8a"],
];

const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const mix = (from: string, to: string, t: number) => {
  const a = channels(from);
  const b = channels(to);
  return `#${a.map((value, index) => Math.round(value + (b[index]! - value) * t).toString(16).padStart(2, "0")).join("")}`;
};

export type SkyColours = { top: string; horizon: string; land: string; glow: string; night: number };

/** The sky's colours at a minute of the day, and how much of night is in it (0 to 1, for the stars). */
export function skyColours(minute: number): SkyColours {
  const at = ((minute % DAY) + DAY) % DAY;
  const next = SKY.findIndex(([edge]) => edge > at);
  const to = SKY[Math.max(1, next)]!;
  const from = SKY[Math.max(0, next - 1)]!;
  const t = (at - from[0]) / (to[0] - from[0] || 1);
  const dark = at < 5 * 60 ? 1 : at < 6 * 60 + 30 ? 1 - (at - 5 * 60) / 90 : at < 20 * 60 ? 0 : at < 21 * 60 + 30 ? (at - 20 * 60) / 90 : 1;
  return { top: mix(from[1], to[1], t), horizon: mix(from[2], to[2], t), land: mix(from[3], to[3], t), glow: mix(from[4], to[4], t), night: dark };
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

/** The window's size, and where the arc runs in it: from the hills on the left, over, to the hills on the right. */
const W = 132;
const H = 76;
const arc = (across: number) => ({ x: 14 + (W - 28) * across, y: 60 - 44 * Math.sin(Math.PI * across) });
const STARS: Array<[number, number, number]> = [
  [18, 12, 0.7],
  [34, 22, 0.5],
  [52, 9, 0.8],
  [71, 18, 0.5],
  [88, 8, 0.7],
  [106, 20, 0.6],
  [118, 11, 0.45],
  [26, 34, 0.4],
  [96, 33, 0.4],
];

export function DaySky() {
  const clock = useMinute();
  const story = useShowcaseTime();
  const now = story === null ? clock : new Date(story);
  const id = useId();
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
  const minute = now.getHours() * 60 + now.getMinutes();
  const { body, across } = skyAt(minute);
  const sky = skyColours(minute);
  const { x, y } = arc(across);
  /** How near the horizon the body is: the glow round it grows as it sinks. */
  const low = Math.pow(1 - Math.sin(Math.PI * across), 2);

  return (
    <div ref={root} className="day-sky" data-body={body} onPointerMove={lean} onPointerLeave={rest}>
      <svg className="day-sky-art" viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <defs>
          <clipPath id={`${id}-frame`}>
            <rect width={W} height={H} rx="16" />
          </clipPath>
          <linearGradient id={`${id}-air`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: sky.top }} />
            <stop offset="0.85" style={{ stopColor: sky.horizon }} />
          </linearGradient>
          <radialGradient id={`${id}-glow`}>
            <stop offset="0" style={{ stopColor: sky.glow, stopOpacity: 0.95 }} />
            <stop offset="1" style={{ stopColor: sky.glow, stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${id}-frame)`}>
          <rect className="day-sky-air" width={W} height={H} fill={`url(#${id}-air)`} />
          <g className="day-sky-stars" style={{ opacity: sky.night }}>
            {STARS.map(([cx, cy, r], index) => (
              <circle key={index} cx={cx} cy={cy} r={r} style={{ animationDelay: `${index * -0.7}s` }} />
            ))}
          </g>
          <circle className="day-sky-glow" cx={x} cy={y} r={body === "sun" ? 30 : 20} fill={`url(#${id}-glow)`} style={{ opacity: body === "sun" ? 0.35 + 0.65 * low : 0.35 }} />
          <g className="day-sky-place" style={{ transform: `translate(${x}px, ${y}px)` }}>
            {/* Keyed by the body, so sunset brings the moon up over the horizon, and dawn the sun. */}
            <g key={body} className="day-sky-rise">
              <g className="day-sky-body">
                {body === "sun" ? (
                  <>
                    <g className="day-sky-rays">
                      <path d="M0-14.5v3.6M0 10.9v3.6M-14.5 0h3.6M10.9 0h3.6M-10.3-10.3l2.5 2.5M7.8 7.8l2.5 2.5M-10.3 10.3l2.5-2.5M7.8-7.8l2.5-2.5" />
                    </g>
                    <circle className="day-sky-sun" r="7.4" />
                    <path className="day-sky-shine" d="M-4.4-2.6a5 5 0 0 1 3.4-2.6" />
                  </>
                ) : (
                  <path className="day-sky-moon" d="M3.5-6.06A7 7 0 1 0 3.5 6.06 6.2 6.2 0 0 1 3.5-6.06Z" />
                )}
              </g>
            </g>
          </g>
          {/* The hills it rises from and sets behind: the far ones lighter, in the sky's own air. */}
          <path
            className="day-sky-hills"
            d={`M0 58C16 52 30 51 46 55S78 50 96 53 122 50 ${W} 52V${H}H0Z`}
            style={{ fill: mix(sky.land, sky.horizon, 0.45) }}
          />
          <path className="day-sky-hills" d={`M0 64C22 58 40 60 60 63S98 57 ${W} 61V${H}H0Z`} style={{ fill: sky.land }} />
        </g>
        <rect className="day-sky-edge" x="0.5" y="0.5" width={W - 1} height={H - 1} rx="15.5" />
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
