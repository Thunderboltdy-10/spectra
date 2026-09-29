import { describe, expect, it } from "vitest";
import { buildArtifactLivePreviewFrames } from "../collaboration/artifact-live-preview";
import type { ArtifactLiveValue } from "../collaboration/artifact-yjs-model";

/**
 * Preview frames used to be one deep clone plus one full JSON.stringify per
 * typed prefix: ~190 ms for five text edits on a 1,000-object board.
 */
function board(nodes: number): ArtifactLiveValue {
  return {
    title: "Board",
    tags: [],
    content: {
      nodes: Array.from({ length: nodes }, (_, index) => ({
        id: `n${index}`,
        x: index * 10,
        y: index * 4,
        content: { text: `Idea ${index} with a sentence of body text` },
      })),
    },
  };
}

describe("live preview frames", () => {
  it("share untouched items with the value they animate from", () => {
    const before = board(20);
    const after = structuredClone(before);
    (after.content as { nodes: Array<{ content: { text: string } }> }).nodes[3]!
      .content.text = "Rewritten idea";
    const frozen = structuredClone(before);
    const frames = buildArtifactLivePreviewFrames(before, after);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.at(-1)).toEqual(after);
    expect(before).toEqual(frozen);
    const nodes = (value: ArtifactLiveValue) =>
      (value.content as { nodes: unknown[] }).nodes;
    for (const frame of frames.slice(0, -1)) {
      expect(nodes(frame)[0]).toBe(nodes(before)[0]);
      expect(nodes(frame)[19]).toBe(nodes(before)[19]);
    }
    const texts = frames.map(
      (frame) => (nodes(frame)[3] as { content: { text: string } }).content.text,
    );
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("keeps frame planning cheap on a 1,000-object board", () => {
    const before = board(1_000);
    const after = structuredClone(before);
    const list = (after.content as { nodes: Array<{ content: { text: string } }> })
      .nodes;
    for (let index = 0; index < 5; index += 1)
      list[index * 100]!.content.text = `New idea ${index} for the class`;
    const start = performance.now();
    const frames = buildArtifactLivePreviewFrames(before, after);
    const elapsed = performance.now() - start;
    expect(frames.at(-1)).toEqual(after);
    // Measured ~4 ms after and ~190 ms before.
    expect(elapsed).toBeLessThan(60);
  });
});
