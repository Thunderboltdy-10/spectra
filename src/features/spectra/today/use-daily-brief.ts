"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { useSpectraPreferences } from "../settings/preference-store";
import { nextDay, zonedDay, zonedInstant, type BriefSuggestion } from "./daily-brief";

/*
 * The morning brief for Home. The reader's wake-up time is kept as a schedule,
 * so the scheduler writes the brief a little before they wake; when Home opens
 * after that time and there is none (they were signed out, or the scheduler
 * is not set up), Home asks for it once. It arrives through the live query,
 * so every open tab shows it together. There is no writing it again.
 */

const RETRY_AFTER_MS = 15 * 60_000;

export type BriefState =
  | { status: "off" | "waiting" | "failed" }
  | { status: "writing"; wakeTime: string }
  | { status: "ready"; day: string; wakeTime: string; recap: string; suggestions: BriefSuggestion[] };

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** The next time the reader wakes, after `now`. */
function nextWake(now: number, wakeTime: string, timeZone: string) {
  const today = zonedDay(now, timeZone);
  const at = zonedInstant(today, wakeTime, timeZone);
  return at > now ? at : zonedInstant(nextDay(today), wakeTime, timeZone);
}

export function useDailyBrief(now: number | null): BriefState {
  const { preferences, hydrated } = useSpectraPreferences();
  const { dailyBriefTime: wakeTime } = preferences.notifications;
  // Until the reader's own preferences are in, the default must not ask for a brief they turned off.
  const on = hydrated && preferences.notifications.dailyBrief;
  const timeZone = useMemo(() => localZone(), []);
  const day = now ? zonedDay(now, timeZone) : null;
  const awake = Boolean(now && day && now >= zonedInstant(day, wakeTime, timeZone));
  const row = useQuery(api.dailyBriefs.today, useAuthedArgs(on && day ? { day } : "skip", "account"));
  const setSchedule = useMutation(api.dailyBriefs.setSchedule);
  const asked = useRef<string | null>(null);

  // The schedule follows the reader's setting and their zone as Home last saw it.
  useEffect(() => {
    if (!hydrated) return;
    void setSchedule({ enabled: on, wakeTime, timeZone, wakeAt: nextWake(Date.now(), wakeTime, timeZone) }).catch(
      () => undefined,
    );
  }, [hydrated, on, setSchedule, timeZone, wakeTime]);

  const missing = row === null || (row?.state === "failed" && Date.now() - row.claimedAt > RETRY_AFTER_MS);
  useEffect(() => {
    if (!on || !awake || !missing || !day || asked.current === day) return;
    asked.current = day;
    void fetch("/api/spectra/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone }),
    }).catch(() => undefined);
  }, [awake, day, missing, on, timeZone]);

  return useMemo((): BriefState => {
    if (!on) return { status: "off" };
    if (row === undefined || !day) return { status: "waiting" };
    // Written before they wake, it is there as soon as they look.
    if (row?.state === "ready")
      return { status: "ready", day, wakeTime, recap: row.recap ?? "", suggestions: row.suggestions as BriefSuggestion[] };
    if (!awake) return { status: "waiting" };
    return row?.state === "failed" ? { status: "failed" } : { status: "writing", wakeTime };
  }, [awake, day, on, row, wakeTime]);
}
