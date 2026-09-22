/** Convert an explicit civil time with IANA rules. Missing/ambiguous times are
 * decisions to surface, not opportunities to silently shift the user's block. */
export function calendarLocalTimeToEpoch(local: string, timezone: string, disambiguation?: "earlier" | "later") {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!match) throw new Error("CALENDAR_LOCAL_TIME_INVALID: Use YYYY-MM-DDTHH:mm.");
  const [, y, m, d, h, min, sec = "0"] = match;
  const desired = Date.UTC(+y!, +m! - 1, +d!, +h!, +min!, +sec);
  const civil = new Date(desired);
  if (civil.getUTCFullYear() !== +y! || civil.getUTCMonth() !== +m! - 1 || civil.getUTCDate() !== +d! || +h! > 23 || +min! > 59 || +sec > 59)
    throw new Error("CALENDAR_LOCAL_TIME_INVALID: That date or time does not exist.");
  if (!timezone?.trim()) throw new Error("CALENDAR_TIMEZONE_REQUIRED: Use the intended IANA timezone.");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch {
    throw new Error("CALENDAR_TIMEZONE_INVALID: Use a valid IANA timezone.");
  }
  const asCivilEpoch = (epoch: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(epoch).map((part) => [part.type, part.value]));
    return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  };
  // Sample both sides of transitions, including 30-minute DST and date-line
  // shifts, then verify exact round-trip candidates instead of guessing offset.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = desired + hours * 3_600_000;
    offsets.add(asCivilEpoch(sample) - sample);
  }
  const candidates = [...offsets].map((offset) => desired - offset)
    .filter((epoch) => asCivilEpoch(epoch) === desired).sort((a, b) => a - b);
  if (!candidates.length) throw new Error("CALENDAR_LOCAL_TIME_NONEXISTENT: That local time is skipped by a timezone transition. Choose another time.");
  if (candidates.length > 1 && !disambiguation) throw new Error("CALENDAR_LOCAL_TIME_AMBIGUOUS: That local time occurs twice. Specify the earlier or later occurrence.");
  return disambiguation === "later" ? candidates[candidates.length - 1]! : candidates[0]!;
}

export function normalizeCalendarTimeInput(args: Record<string, unknown>) {
  const normalized = { ...args };
  const timezone = typeof args.timezone === "string" ? args.timezone.trim() : "";
  if (timezone) {
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); }
    catch { throw new Error("CALENDAR_TIMEZONE_INVALID: Use a valid IANA timezone."); }
  }
  for (const prefix of ["start", "end"] as const) {
    const local = args[`${prefix}Local`];
    if (local === undefined) continue;
    if (typeof local !== "string") throw new Error("CALENDAR_LOCAL_TIME_INVALID");
    const disambiguation = args.disambiguation === "earlier" || args.disambiguation === "later" ? args.disambiguation : undefined;
    const epoch = calendarLocalTimeToEpoch(local, timezone, disambiguation);
    const supplied = args[`${prefix}At`];
    if (supplied !== undefined && supplied !== epoch) throw new Error("CALENDAR_TIME_MISMATCH: The timestamp does not match the requested local time and timezone.");
    normalized[`${prefix}At`] = epoch;
  }
  return normalized;
}
