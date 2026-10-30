import type { ArtifactLiveValue } from "./artifact-yjs-model";
import { valueAtPath } from "./artifact-live-preview";
import type { AiStreamBeat } from "./interaction-choreography";
import {
  beatPresence,
  performanceBeats,
  performanceIsStale,
  performanceSides,
  settlePresence,
  type AiPerformance,
} from "./performance";

/*
 * Plays AI performances on this screen.
 *
 * Each actor has one body, so its performances play one after another. A
 * performance that is already under way when it arrives (a slow socket, a
 * viewer who just opened the page) joins at the right beat instead of
 * starting late; one that ended a while ago is not replayed. Playback is
 * local, so it carries on after the AI's own connection has gone.
 */

const SETTLE_MS = 420;
/** How long the last frame may wait for the commit to reach this document. */
const COMMIT_WAIT_MS = 4_000;
const SEEN_LIMIT = 400;
const stages = new Set<PerformanceStage>();

/** Local playback can outlive the server run that committed the edit. */
export function isRunPerforming(runId: string): boolean {
  return [...stages].some((stage) => stage.hasRun(runId));
}

type Playing = {
  performance: AiPerformance;
  beats: AiStreamBeat[];
  base: ArtifactLiveValue;
  index: number;
  timer?: ReturnType<typeof setTimeout>;
};

export class PerformanceStage {
  private readonly queues = new Map<string, AiPerformance[]>();
  private readonly playing = new Map<string, Playing>();
  /** Actor body records shown now, by the actor's client id. */
  private readonly records = new Map<string, Record<string, unknown>>();
  private readonly seen = new Set<string>();
  private readonly ends = new Map<string, number>();
  private destroyed = false;

  constructor(
    private readonly readLive: (performance: AiPerformance) => ArtifactLiveValue | null,
    private readonly onChange: () => void,
    private readonly now: () => number = () => Date.now(),
  ) { stages.add(this); }

  hasRun(runId: string): boolean {
    return [...this.playing.values()].some(({ performance }) => performance.runId === runId) ||
      [...this.queues.values()].some((queue) => queue.some((performance) => performance.runId === runId));
  }

  /** Every performance an awareness entry lists; repeats are ignored. */
  ingest(performances: readonly AiPerformance[]) {
    if (this.destroyed) return;
    for (const performance of performances) {
      if (performance.withdrawn) {
        this.remember(performance.id);
        this.withdraw(performance);
        continue;
      }
      if (this.seen.has(performance.id)) continue;
      this.remember(performance.id);
      if (performanceIsStale(performance, this.now())) continue;
      const key = this.queueKey(performance);
      const queue = this.queues.get(key) ?? [];
      queue.push(performance);
      queue.sort((left, right) => left.startAt - right.startAt);
      this.queues.set(key, queue);
      if (!this.playing.has(key)) this.next(key);
    }
  }

  /** The synthesized presence of every actor performing now. */
  presence(): ReadonlyMap<string, Record<string, unknown>> {
    return this.records;
  }

  isPerforming(clientId: string) {
    return this.records.has(clientId);
  }

  destroy() {
    this.destroyed = true;
    stages.delete(this);
    for (const playing of this.playing.values()) clearTimeout(playing.timer);
    this.playing.clear();
    this.queues.clear();
    this.records.clear();
  }

  /** A refused write: drop it from the queue, or let go of it mid-gesture. */
  private withdraw(performance: AiPerformance) {
    const key = this.queueKey(performance);
    const queue = this.queues.get(key);
    if (queue) this.queues.set(key, queue.filter((entry) => entry.id !== performance.id));
    const playing = this.playing.get(key);
    if (playing?.performance.id !== performance.id) return;
    clearTimeout(playing.timer);
    this.release(key, performance);
  }

  /** The hand leaves without a word and the next gesture, if any, begins. */
  private release(key: string, performance: AiPerformance) {
    if (!this.queues.get(key)?.length && this.records.delete(performance.actor.clientId)) this.onChange();
    this.playing.delete(key);
    this.next(key);
  }

  private queueKey(performance: AiPerformance) {
    return `${performance.runId}:${performance.actor.clientId}`;
  }

  private remember(id: string) {
    this.seen.add(id);
    if (this.seen.size <= SEEN_LIMIT) return;
    const oldest = this.seen.values().next().value;
    if (oldest !== undefined) this.seen.delete(oldest);
  }

  private next(key: string) {
    const queue = this.queues.get(key);
    const performance = queue?.shift();
    if (!performance) {
      this.queues.delete(key);
      this.playing.delete(key);
      return;
    }
    // The hand waits for its previous gesture to finish, and for the moment the
    // server gave, whichever comes later.
    const startAt = Math.max(performance.startAt, this.ends.get(key) ?? 0);
    const wait = startAt - this.now();
    const begin = () => {
      if (this.destroyed) return;
      if (performanceIsStale({ ...performance, startAt }, this.now())) return this.next(key);
      const live = this.readLive(performance);
      if (!live) return this.next(key);
      const { base } = performanceSides(performance, live);
      const beats = performanceBeats(performance, live);
      if (!beats.length) return this.next(key);
      const playing: Playing = { performance, beats, base, index: 0 };
      this.playing.set(key, playing);
      // Joining late: skip the beats whose time has passed.
      let elapsed = this.now() - startAt;
      while (playing.index < beats.length - 1 && elapsed >= beats[playing.index + 1]!.delayMs) {
        elapsed -= beats[playing.index + 1]!.delayMs;
        playing.index += 1;
      }
      this.show(key, playing);
    };
    // Reserve the slot now so a second performance queues behind this one.
    this.playing.set(key, { performance, beats: [], base: {} as ArtifactLiveValue, index: 0 });
    if (wait > 8) {
      const holder = this.playing.get(key)!;
      holder.timer = setTimeout(begin, wait);
    } else begin();
  }

  private show(key: string, playing: Playing) {
    const { performance, beats } = playing;
    this.records.set(performance.actor.clientId, beatPresence(performance, beats, playing.index, playing.base));
    this.onChange();
    const following = beats[playing.index + 1];
    if (following) {
      playing.timer = setTimeout(() => {
        playing.index += 1;
        if (!this.destroyed) this.show(key, playing);
      }, Math.max(0, following.delayMs));
      return;
    }
    this.finish(key, playing, this.now());
  }

  /** Hold the last frame until the commit is here, then settle on the control. */
  private finish(key: string, playing: Playing, since: number) {
    const { performance, beats } = playing;
    const live = this.readLive(performance);
    const landed =
      live !== null && performance.after.every((patch) => holds(valueAtPath(live, patch.path), patch.value));
    if (!landed && this.now() - since < COMMIT_WAIT_MS) {
      playing.timer = setTimeout(() => this.finish(key, playing, since), 120);
      return;
    }
    // The commit never came: nothing was done, so the hand does not say "Done".
    if (!landed) return this.release(key, performance);
    this.records.set(performance.actor.clientId, settlePresence(performance, beats));
    this.onChange();
    this.ends.set(key, this.now() + SETTLE_MS);
    playing.timer = setTimeout(() => {
      if (this.destroyed) return;
      const waiting = this.queues.get(key)?.length ?? 0;
      if (!waiting) {
        this.records.delete(performance.actor.clientId);
        this.onChange();
      }
      this.playing.delete(key);
      this.next(key);
    }, SETTLE_MS);
  }
}

/**
 * Whether the committed value carries what the edit wrote. The file may add
 * what it always holds (a cell's default format), so extra fields still count.
 */
function holds(live: unknown, wanted: unknown): boolean {
  if (Array.isArray(wanted))
    return Array.isArray(live) && live.length === wanted.length && wanted.every((item, index) => holds(live[index], item));
  if (wanted && typeof wanted === "object")
    return (
      Boolean(live) &&
      typeof live === "object" &&
      !Array.isArray(live) &&
      Object.entries(wanted).every(([key, value]) => holds((live as Record<string, unknown>)[key], value))
    );
  return Object.is(live, wanted);
}
