import type { ArtifactTypeKey } from "@/features/spectra/artifacts/types";
import { artifactLivePreviewPatches } from "@/features/spectra/collaboration/artifact-live-preview";
import type { ArtifactLiveValue } from "@/features/spectra/collaboration/artifact-yjs-model";
import { buildArtifactLivePreviewBeats } from "@/features/spectra/collaboration/interaction-choreography";
import type { ActorIdentity, InteractionState } from "@/features/spectra/collaboration/interaction-model";
import { beatPresence, beatsDuration, settlePresence, type AiPerformance } from "@/features/spectra/collaboration/performance";
import type { SpectraArtifact } from "@/features/spectra/data/api";

/*
 * Spectra's AI editing a work on the page with the hand it has in the app.
 * The edit is planned by the app's own choreography (which control it
 * reaches for, what it selects, how it types) and every frame is the
 * presence record a viewer of the real edit would get, so the cursor, its
 * borders, selections and caret are drawn by the same layer, the same way.
 * Only the stage differs: the page applies each frame to its own copy of the
 * work instead of waiting for a collaboration room.
 */

export type Performer = {
  /** The surface the work is drawn in, as the presence layer finds it. */
  surface: string;
  /** Shows the AI where it is now; null when it has gone. */
  show: (state: InteractionState | null) => void;
  /** Puts a frame of the work on the page. */
  apply: (content: unknown) => void;
  /** Waits on the scene's own clock. */
  wait: (ms: number) => Promise<void>;
  signal: AbortSignal;
};

const live = (work: SpectraArtifact, content: unknown): ArtifactLiveValue => ({
  title: work.title,
  ...(work.summary ? { summary: work.summary } : {}),
  tags: work.tags ?? [],
  content,
});

/** Plans the AI's edit of `work` from its content now to `next`. */
export function planPerformance(work: SpectraArtifact, from: unknown, next: unknown, actor: ActorIdentity, seed: string) {
  const base = live(work, from);
  const desired = live(work, next);
  const beats = buildArtifactLivePreviewBeats(base, desired, undefined, { seed });
  const performance: AiPerformance = {
    v: 1,
    id: `landing:${seed}`,
    runId: `landing:${seed}`,
    operationId: seed,
    artifactId: work._id,
    typeKey: work.blueprintKey as ArtifactTypeKey,
    actor,
    regionIds: [],
    startAt: 0,
    estimateMs: beatsDuration(beats),
    seed: 0,
    tempo: 1,
    before: artifactLivePreviewPatches(desired, base),
    after: artifactLivePreviewPatches(base, desired),
  };
  return { base, beats, performance, ms: beatsDuration(beats) };
}

/** Plays the edit; resolves when the last frame is on the page and the hand has settled. */
export async function perform(
  work: SpectraArtifact,
  from: unknown,
  next: unknown,
  actor: ActorIdentity,
  seed: string,
  { surface, show, apply, wait, signal }: Performer,
) {
  const { base, beats, performance } = planPerformance(work, from, next, actor, seed);
  const here = (state: unknown): InteractionState => {
    const frame = state as InteractionState;
    return { ...frame, target: frame.target ? { ...frame.target, artifactId: surface } : frame.target, at: Date.now() };
  };
  for (const [index, beat] of beats.entries()) {
    await wait(Math.max(0, beat.delayMs));
    if (signal.aborted) return;
    apply(beat.value.content);
    const record = beatPresence(performance, beats, index, base);
    show(here(record.interactionState));
  }
  apply(next);
  const settled = settlePresence(performance, beats);
  show(here(settled.interactionState));
}
