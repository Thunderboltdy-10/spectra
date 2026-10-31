"use client";


/*
 * The sky through the day: what stands in it at a minute, and its colours,
 * for whatever draws it. Home names its brief by the part of the day.
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

/** What part of the day it is, for the brief's name. */
export function dayPart(hour: number) {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}
