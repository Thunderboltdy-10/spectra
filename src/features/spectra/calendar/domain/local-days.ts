/**
 * Local calendar-day arithmetic for the Calendar grid.
 *
 * A calendar day is not always 24 hours long: on a daylight-saving change it is
 * 23 or 25. Adding `24 * 60 * 60_000` to a local midnight therefore lands on
 * 23:00 or 01:00, and a column keyed by that stamp shows the wrong date (the
 * autumn change printed the same date twice and skipped the next one). Days
 * here are always derived from the local year, month and date.
 */

export function startOfLocalDay(value: Date | number) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function addLocalDays(value: Date | number, count: number) {
  const date = new Date(value);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + count,
  ).getTime();
}

/** Monday of the local week that contains `value`, at local midnight. */
export function startOfLocalWeek(value: Date | number) {
  const day = new Date(value).getDay() || 7;
  return addLocalDays(startOfLocalDay(value), 1 - day);
}

/** `before` days, the centre day, then `after` days, each a local midnight. */
export function localDaysAround(center: number, before: number, after: number) {
  const start = startOfLocalDay(center);
  return Array.from({ length: before + after + 1 }, (_, index) =>
    addLocalDays(start, index - before),
  );
}

/** The last millisecond of the local day that starts at `dayStart`. */
export function endOfLocalDay(dayStart: number) {
  return addLocalDays(dayStart, 1) - 1;
}
