import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactLiveValue } from "../collaboration/artifact-yjs-model";
import {
  beatsDuration,
  documentStage,
  performanceBeats,
  performancePatches,
  type AiPerformance,
} from "../collaboration/performance";
import { PerformanceStage, isRunPerforming } from "../collaboration/performance-stage";

const base: ArtifactLiveValue = {
  title: "Notes",
  tags: [],
  content: {
    blocks: [
      { id: "b1", type: "paragraph", text: "The mitochondria makes energy." },
      { id: "b2", type: "paragraph", text: "Untouched." },
    ],
  },
};
const desired: ArtifactLiveValue = {
  ...base,
  content: {
    blocks: [
      { id: "b1", type: "paragraph", text: "The mitochondrion makes ATP." },
      { id: "b2", type: "paragraph", text: "Untouched." },
    ],
  },
};

function performance(startAt: number, id = "op-1"): AiPerformance {
  const { before, after } = performancePatches(base, desired);
  return {
    v: 1,
    id,
    runId: "run",
    operationId: id,
    artifactId: "artifact",
    typeKey: "document" as AiPerformance["typeKey"],
    actor: { clientId: "ai-1", kind: "ai", name: "Ada's AI", ownerAccountId: "acc" },
    regionIds: ["block:b1"],
    startAt,
    estimateMs: 4_000,
    seed: 11,
    tempo: 1,
    before,
    after,
  };
}

afterEach(() => vi.useRealTimers());

describe("AI performances", () => {
  it("tracks queued playback by run and releases it on completion or teardown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const stage = new PerformanceStage(() => desired, () => undefined);
    const pending = { ...performance(11_000), runId: "queued-follow-run" };
    stage.ingest([pending]);
    expect(isRunPerforming(pending.runId)).toBe(true);
    expect(isRunPerforming("another-run")).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(isRunPerforming(pending.runId)).toBe(false);
    stage.ingest([{ ...performance(31_000, "op-next"), runId: pending.runId }]);
    expect(isRunPerforming(pending.runId)).toBe(true);
    stage.destroy();
    expect(isRunPerforming(pending.runId)).toBe(false);
  });
  it("send only the changed text and rebuild both sides from either copy", () => {
    const { before, after } = performancePatches(base, desired);
    expect(after).toEqual([{ path: "/content/blocks/0/text", value: "The mitochondrion makes ATP." }]);
    expect(before).toEqual([{ path: "/content/blocks/0/text", value: "The mitochondria makes energy." }]);
    // The same hand whether the commit has landed or not.
    const fromBase = performanceBeats(performance(0), base);
    const fromCommitted = performanceBeats(performance(0), desired);
    expect(fromCommitted).toEqual(fromBase);
    expect(beatsDuration(fromBase)).toBeGreaterThan(400);
  });

  it("plays on a viewer over the committed value and settles", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const shown: Array<Record<string, unknown> | undefined> = [];
    const stage = new PerformanceStage(
      () => desired,
      () => shown.push(stage.presence().get("ai-1")),
    );
    stage.ingest([performance(10_000)]);
    const first = shown[0]!;
    // Before the hand has typed, the overlay still shows the old words over
    // the already committed value.
    const patches = first.previewPatches as Array<{ path: string; value: unknown }>;
    expect(patches).toEqual([{ path: "/content/blocks/0/text", value: "The mitochondria makes energy." }]);
    expect(first.actorKind).toBe("ai");
    vi.advanceTimersByTime(20_000);
    expect(shown.some((record) => (record?.selection as { collapsed?: boolean } | null)?.collapsed === false)).toBe(true);
    expect(stage.presence().size).toBe(0);
    // Repeats of the same performance are not replayed.
    const count = shown.length;
    stage.ingest([performance(10_000)]);
    expect(shown.length).toBe(count);
  });

  it("joins a performance under way at the right beat and skips one long over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const shown: unknown[] = [];
    const stage = new PerformanceStage(() => desired, () => shown.push(1));
    stage.ingest([performance(10_000, "old")]);
    expect(shown.length).toBe(0);
    stage.ingest([performance(100_000 - 900, "late")]);
    const beats = performanceBeats(performance(0), desired);
    expect(shown.length).toBe(1);
    // It did not start from the first beat.
    const total = beatsDuration(beats);
    vi.advanceTimersByTime(total);
    expect(shown.length).toBeLessThan(beats.length + 1);
    stage.destroy();
  });
  it("never says Done for an edit that did not land", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const words: unknown[] = [];
    const stage = new PerformanceStage(
      () => base,
      () => words.push((stage.presence().get("ai-1")?.interactionState as { lifecycle?: string } | undefined)?.lifecycle),
    );
    stage.ingest([performance(10_000)]);
    vi.advanceTimersByTime(20_000);
    expect(words.length).toBeGreaterThan(0);
    expect(words).not.toContain("settled");
    expect(stage.presence().size).toBe(0);
  });

  it("lets go of a withdrawn edit mid-gesture", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const stage = new PerformanceStage(() => desired, () => undefined);
    stage.ingest([performance(10_000)]);
    vi.advanceTimersByTime(200);
    expect(stage.isPerforming("ai-1")).toBe(true);
    stage.ingest([{ ...performance(10_000), withdrawn: true }]);
    expect(stage.isPerforming("ai-1")).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(stage.isPerforming("ai-1")).toBe(false);
  });
});

describe("the document stage a viewer draws while the AI writes", () => {
  const reference = { embedId: "embed-1", sourceArtifactId: "work-diagram", blockId: "e1", label: "Membrane diagram" };
  const start: ArtifactLiveValue = {
    title: "Notes",
    tags: [],
    content: { blocks: [{ id: "b1", type: "paragraph", text: "Transport." }, { id: "h1", type: "paragraph", text: "A person's line." }] },
  };
  const end: ArtifactLiveValue = {
    ...start,
    content: {
      blocks: [
        { id: "b1", type: "paragraph", text: "Transport across membranes." },
        { id: "e1", type: "paragraph", text: reference.label, reference },
        { id: "b3", type: "paragraph", text: "Osmosis moves water." },
        { id: "h1", type: "paragraph", text: "A person's line." },
      ],
    },
  };
  const played = (): { perf: AiPerformance; beats: ReturnType<typeof performanceBeats> } => {
    const { before, after } = performancePatches(start, end);
    const perf: AiPerformance = { ...performance(0), before, after };
    return { perf, beats: performanceBeats(perf, end) };
  };

  it("hides what is not reached, opens the carried artifact's place, and never touches a person's block", () => {
    const { perf, beats } = played();
    const lift = beats.findIndex((beat) => beat.carry?.phase === "lift");
    const drop = beats.findIndex((beat) => beat.carry?.phase === "drop");
    expect(lift).toBeGreaterThanOrEqual(0);
    const lifting = documentStage(perf, beats, lift, start)!;
    expect(lifting.blocks).toContainEqual({ id: "e1", state: "arriving" });
    expect(lifting.blocks).toContainEqual({ id: "b3", state: "pending" });
    expect(lifting.blocks.some((block) => block.id === "h1")).toBe(false);
    expect(lifting.carry).toMatchObject({ workId: "work-diagram", phase: "lift" });
    expect(lifting.carry?.flightMs).toBe(beats.slice(lift + 1, drop + 1).reduce((sum, beat) => sum + beat.delayMs, 0));
    expect(documentStage(perf, beats, drop, start)!.blocks).toContainEqual({ id: "e1", state: "placed" });
    // Once every block reads as it will, nothing is staged.
    expect(documentStage(perf, beats, beats.length - 1, start)).toBeUndefined();
  });

  it("draws a block mid-write as written so far", () => {
    const { perf, beats } = played();
    const writing = beats.findIndex((beat) => {
      const text = (beat.value.content as { blocks: { id: string; text: string }[] }).blocks.find((block) => block.id === "b3")?.text;
      return typeof text === "string" && text.length > 0 && text !== "Osmosis moves water.";
    });
    expect(writing).toBeGreaterThan(0);
    const stage = documentStage(perf, beats, writing, start)!;
    const block = stage.blocks.find((entry) => entry.id === "b3");
    expect(block?.state).toBe("writing");
    expect(block && "text" in block && "Osmosis moves water.".startsWith(block.text)).toBe(true);
  });
});
