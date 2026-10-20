import type { PresentationSlide } from "./model";

/*
 * What a private rehearsal measured: the slides that were shown, in the order
 * they were shown, and how long the speaker stayed on each. Hidden slides are
 * not in it, so every time sits beside the slide it was spoken over.
 */
export type RehearsalReport = {
  slides: PresentationSlide[];
  slideDurations: number[];
  totalMs: number;
};

export function rehearsalReport(slides: readonly PresentationSlide[], slideDurations: readonly number[]): RehearsalReport {
  const durations = slides.map((_, index) => Math.max(0, slideDurations[index] ?? 0));
  return { slides: [...slides], slideDurations: durations, totalMs: durations.reduce((total, duration) => total + duration, 0) };
}

/** A clock reading, `4:07`, for a column of times. */
export function clockDuration(milliseconds: number) {
  const seconds = Math.round(Math.max(0, milliseconds) / 1_000);
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

/** A time said in words, "4 minutes 7 seconds", for a sentence. */
export function spokenDuration(milliseconds: number) {
  const seconds = Math.round(Math.max(0, milliseconds) / 1_000);
  if (seconds < 1) return "under a second";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (!minutes) return unit(rest, "second");
  return rest ? `${unit(minutes, "minute")} ${unit(rest, "second")}` : unit(minutes, "minute");
}

/** The slide the speaker stayed on longest, when one stands out from the rest. */
export function longestSlide(report: RehearsalReport) {
  if (report.slides.length < 2) return undefined;
  let longest = 0;
  report.slideDurations.forEach((duration, index) => {
    if (duration > report.slideDurations[longest]!) longest = index;
  });
  const average = report.totalMs / report.slides.length;
  return report.slideDurations[longest]! > average * 1.5 ? longest : undefined;
}
