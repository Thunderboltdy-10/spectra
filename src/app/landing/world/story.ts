import type { ActorIdentity } from "@/features/spectra/collaboration/interaction-model";

/*
 * The story the landing page tells: one evening of Henry's, a DP1 student,
 * tonight, in the visitor's own week. It starts at 21:40, goes through the
 * night and ends at seven the next morning. Every date on the page (a
 * deadline on Friday, a plan for tomorrow afternoon) is counted from today,
 * so the real calendar and the real Home show it as they would for him.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function startOfDay(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Today at midnight, local time; fixed once per visit. */
export const TODAY = startOfDay(Date.now());

/** A local time `days` from today, at `hour:minute`. */
export function dayAt(days: number, hour: number, minute = 0) {
  const date = new Date(TODAY);
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

export const STORY = {
  evening: dayAt(0, 21, 40),
  night: dayAt(0, 23, 58),
  morning: dayAt(1, 7, 0),
};

/** "Friday", or "tomorrow" for the next day. */
export function dayName(at: number) {
  const days = Math.round((startOfDay(at) - TODAY) / DAY);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(at);
}

export const clock = (at: number) =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(at);

/* The cast. Ordinary Spectra identities: the presence layer derives their
   labels and colours exactly as it does for real collaborators, so Henry's
   AI is labelled "Henry's AI" by the product, not by this page. */

export const HENRY: ActorIdentity = {
  clientId: "story-henry",
  kind: "human",
  name: "Henry",
  accountId: "henry",
};

export const GONZALEZ: ActorIdentity = {
  clientId: "story-gonzalez",
  kind: "human",
  name: "Ms Gonzalez",
  accountId: "gonzalez",
};

export const HENRY_AI: ActorIdentity = {
  clientId: "story-henry-ai",
  kind: "ai",
  name: "Spectra",
  accountId: "henry-ai",
  ownerAccountId: "henry",
  ownerName: "Henry",
};

export const GONZALEZ_AI: ActorIdentity = {
  clientId: "story-gonzalez-ai",
  kind: "ai",
  name: "Spectra",
  accountId: "gonzalez-ai",
  ownerAccountId: "gonzalez",
  ownerName: "Ms Gonzalez",
};

/** Henry's friend from History, who shares the class's timeline with him. */
export const MAYA: ActorIdentity = {
  clientId: "story-maya",
  kind: "human",
  name: "Maya",
  accountId: "maya-h",
};

/** Henry's Biology teacher. */
export const OKAFOR: ActorIdentity = {
  clientId: "story-okafor",
  kind: "human",
  name: "Mr Okafor",
  accountId: "okafor",
};

export const CAST = { henry: HENRY, gonzalez: GONZALEZ, okafor: OKAFOR, henryAi: HENRY_AI, gonzalezAi: GONZALEZ_AI, maya: MAYA } as const;
export type CastId = keyof typeof CAST;
