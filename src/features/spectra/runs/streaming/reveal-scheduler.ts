/**
 * Streaming reveal scheduler (Phase 14.2 / POLISH-004).
 *
 * Canonical content state is *independent* from visual reveal (INV-22):
 *
 *   provider/update stream → canonical parsed state → reveal scheduler → text
 *
 * The scheduler never mutates, gates or delays the canonical stream — it only
 * decides how much of the already-arrived text is *visible* right now. Data
 * completeness, persistence, citations and accessibility state therefore
 * never depend on an animation.
 *
 * Profiles:
 *   conversation — near-provider speed for chat / right panel.
 *   dock         — controlled left-to-right reveal for Live Dock titles.
 *   document     — slower visible reveal for AI content in work surfaces,
 *                  with adaptive catch-up when the queue grows.
 *   table        — meaningful batch reveal for ranges/rows.
 *   imported     — no artificial streaming (processing already happened).
 */

export type RevealProfileName =
  "conversation" | "dock" | "document" | "table" | "imported";

export interface RevealProfile {
  /** baseline visible characters per second */
  charsPerSecond: number;
  /** queue size (canonical − revealed) above which catch-up accelerates */
  catchUpThreshold: number;
  /** multiplier applied while the queue exceeds the threshold */
  catchUpFactor: number;
  /** hard cap on characters revealed per tick */
  maxPerTick: number;
  /** reveal granularity — batches reveal whole chunks at a time */
  batchSize: number;
}

export const REVEAL_PROFILES: Record<RevealProfileName, RevealProfile> = {
  conversation: {
    charsPerSecond: 900,
    catchUpThreshold: 1_200,
    catchUpFactor: 4,
    maxPerTick: 240,
    batchSize: 2,
  },
  dock: {
    charsPerSecond: 150,
    catchUpThreshold: 60,
    catchUpFactor: 3,
    maxPerTick: 24,
    batchSize: 1,
  },
  document: {
    charsPerSecond: 260,
    catchUpThreshold: 480,
    catchUpFactor: 6,
    maxPerTick: 120,
    batchSize: 2,
  },
  table: {
    charsPerSecond: 420,
    catchUpThreshold: 300,
    catchUpFactor: 3,
    maxPerTick: 200,
    batchSize: 16,
  },
  imported: {
    charsPerSecond: Number.POSITIVE_INFINITY,
    catchUpThreshold: 0,
    catchUpFactor: 1,
    maxPerTick: Number.POSITIVE_INFINITY,
    batchSize: 1,
  },
};

export interface RevealTickResult {
  /** characters currently allowed to be visible */
  revealed: number;
  /** canonical characters still queued behind the reveal */
  queued: number;
  /** true while revealed < canonicalLength */
  active: boolean;
}

/**
 * Clock-driven scheduler with adaptive catch-up. Deterministic for tests:
 * every call takes an explicit `nowMs`.
 */
export class RevealScheduler {
  private readonly profile: RevealProfile;
  private revealed = 0;
  private lastTickAt: number | null = null;

  constructor(profile: RevealProfileName) {
    this.profile = REVEAL_PROFILES[profile];
  }

  /** Latest canonical (fully arrived) length. Never decreased by reveal. */
  tick(canonicalLength: number, nowMs: number): RevealTickResult {
    if (this.revealed > canonicalLength) this.revealed = canonicalLength;

    if (this.lastTickAt !== null) {
      const elapsed = Math.max(0, nowMs - this.lastTickAt);
      const queued = canonicalLength - this.revealed;
      if (queued > 0 && elapsed > 0) {
        const catchingUp = queued > this.profile.catchUpThreshold;
        const rate =
          (this.profile.charsPerSecond *
            (catchingUp ? this.profile.catchUpFactor : 1)) /
          1000;
        let advance = Math.min(rate * elapsed, this.profile.maxPerTick);
        if (Number.isFinite(advance)) {
          advance = Math.max(
            this.profile.batchSize,
            Math.floor(advance / this.profile.batchSize) *
              this.profile.batchSize,
          );
          this.revealed = Math.min(canonicalLength, this.revealed + advance);
        } else {
          this.revealed = canonicalLength;
        }
      }
    }
    this.lastTickAt = nowMs;
    return this.snapshot(canonicalLength);
  }

  /** Jump straight to the canonical length (stream finished, view re-mounted). */
  settle(canonicalLength: number): RevealTickResult {
    this.revealed = canonicalLength;
    return this.snapshot(canonicalLength);
  }

  snapshot(canonicalLength: number): RevealTickResult {
    const revealed = Math.min(this.revealed, canonicalLength);
    return {
      revealed,
      queued: canonicalLength - revealed,
      active: revealed < canonicalLength,
    };
  }
}
