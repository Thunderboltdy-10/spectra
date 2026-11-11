import { type AiStreamBeat } from "./interaction-choreography";

/*
 * How fast this person watches the AI work. It is a viewer's choice: the edit
 * is committed the moment it is ready, and the same performance plays at each
 * viewer's own speed.
 *
 * - fast (the default): the work appears as it arrives, at the pace of streamed
 *   text, with a short glide so it still reads as being written.
 * - medium: the hand is there, with the pauses taken out.
 * - slow: the full human-paced performance. Follow AI uses this by default.
 */

export type WorkSpeed = "fast" | "medium" | "slow";

export const WORK_SPEEDS: readonly WorkSpeed[] = ["slow", "medium", "fast"];

let speed: WorkSpeed = "fast";
let followSpeed: WorkSpeed = "slow";
let following = false;

/** Set from the shell, which knows the preferences and whether Follow AI is on. */
export function setWorkSpeeds(next: { speed?: WorkSpeed; followSpeed?: WorkSpeed; following?: boolean }) {
  if (next.speed) speed = next.speed;
  if (next.followSpeed) followSpeed = next.followSpeed;
  if (next.following !== undefined) following = next.following;
}

export function currentWorkSpeed(): WorkSpeed {
  return following ? followSpeed : speed;
}

/** One frame: nothing on screen changes faster than this. */
const FRAME_MS = 33;
/** Streamed text runs at about this many characters a second. */
const FAST_CHARS_PER_SECOND = 900;
const FAST_MIN_MS = 180;
const FAST_MAX_MS = 1_400;
const MEDIUM_SCALE = 0.3;
const MEDIUM_MAX_MS = 6_000;

function writtenCharacters(beats: readonly AiStreamBeat[]) {
  const first = JSON.stringify(beats[0]?.value ?? "").length;
  const last = JSON.stringify(beats.at(-1)?.value ?? "").length;
  return Math.max(0, Math.abs(last - first));
}

/** A beat that must survive thinning: a work being carried in, or a menu that opens and closes. */
function isLandmark(beat: AiStreamBeat, previous: AiStreamBeat | undefined) {
  if (beat.carry?.phase !== previous?.carry?.phase) return true;
  return Boolean(beat.menu?.open) !== Boolean(previous?.menu?.open);
}

function scaled(beats: readonly AiStreamBeat[], factor: number) {
  return beats.map((beat) => ({ ...beat, delayMs: Math.max(0, beat.delayMs) * factor }));
}

/** Drops beats that would land within one frame of each other; the time they held moves to the next one kept. */
function thinned(beats: readonly AiStreamBeat[]) {
  const kept: AiStreamBeat[] = [];
  let carried = 0;
  beats.forEach((beat, index) => {
    const last = index === beats.length - 1;
    const waited = carried + beat.delayMs;
    if (index === 0 || last || waited >= FRAME_MS || isLandmark(beat, beats[index - 1])) {
      kept.push({ ...beat, delayMs: Math.round(waited) });
      carried = 0;
      return;
    }
    carried = waited;
  });
  return kept;
}

/**
 * The beats of one performance at this speed. The content of every beat is
 * unchanged: each still holds the whole value at that moment, so skipping some
 * cannot lose work, and the last beat is always the finished edit.
 */
export function beatsAtSpeed(beats: readonly AiStreamBeat[], at: WorkSpeed): AiStreamBeat[] {
  if (beats.length < 2 || at === "slow") return [...beats];
  const total = beats.reduce((sum, beat) => sum + Math.max(0, beat.delayMs), 0);
  if (total <= 0) return [...beats];
  if (at === "medium") {
    const target = Math.min(total * MEDIUM_SCALE, MEDIUM_MAX_MS);
    return thinned(scaled(beats, target / total));
  }
  const reading = (writtenCharacters(beats) / FAST_CHARS_PER_SECOND) * 1_000;
  const target = Math.min(FAST_MAX_MS, Math.max(FAST_MIN_MS, reading), total);
  return thinned(scaled(beats, target / total));
}
