import { describe, expect, it } from "vitest";
import { buildArtifactLivePreviewBeats } from "../collaboration/interaction-choreography";

describe("buildArtifactLivePreviewBeats", () => {
  it("choreographs dropdown changes as open → highlight → commit → close", () => {
    const before = {
      title: "Task",
      tags: [],
      content: { status: "todo", priority: "medium", description: "Study" },
    };
    const after = {
      ...before,
      content: { ...before.content, status: "doing" },
    };
    const beats = buildArtifactLivePreviewBeats(before, after);
    expect(beats.length).toBeGreaterThan(4);
    expect(beats.some((beat) => beat.menu?.open === true)).toBe(true);
    expect(
      beats.some(
        (beat) =>
          beat.menu?.open === true && beat.menu.highlighted === "doing",
      ),
    ).toBe(true);
    expect(beats.some((beat) => beat.menu === null)).toBe(true);
    expect(beats.at(-1)?.value.content).toEqual(after.content);
    expect(beats.every((beat) => beat.delayMs >= 70)).toBe(true);
  });

  it("approaches a text field, selects the line, then rewrites in place", () => {
    const before = {
      title: "Notes",
      tags: [],
      content: {
        blocks: [{ id: "b1", type: "paragraph", text: "Old line of notes." }],
      },
    };
    const after = {
      ...before,
      content: {
        blocks: [
          {
            id: "b1",
            type: "paragraph",
            text: "A clearer rewritten line of notes.",
          },
        ],
      },
    };
    const beats = buildArtifactLivePreviewBeats(before, after);
    expect(beats[0]?.interaction?.kind).toBe("pointer");
    expect(beats.some((beat) => typeof beat.selectionEnd === "number")).toBe(
      true,
    );
    expect(beats.some((beat) => beat.previewGesture === "erasing")).toBe(false);
    expect(beats.some((beat) => beat.previewGesture === "typing")).toBe(true);
    expect(
      beats.some(
        (beat) =>
          beat.previewGesture === "typing" && typeof beat.caretOffset === "number",
      ),
    ).toBe(true);
    expect(beats.length).toBeGreaterThan(6);
    expect(beats.at(-1)?.value).toEqual(after);
  });

  it("scopes multiline list rewrites to the changed bullet line", () => {
    const before = {
      title: "Notes",
      tags: [],
      content: {
        blocks: [
          {
            id: "b23",
            type: "list",
            text: "Keep me\nAlso keep me\nRewrite this bullet only.",
          },
        ],
      },
    };
    const after = {
      ...before,
      content: {
        blocks: [
          {
            id: "b23",
            type: "list",
            text: "Keep me\nAlso keep me\nRewrite this bullet with LINE-SCOPE.",
          },
        ],
      },
    };
    const beats = buildArtifactLivePreviewBeats(before, after);
    const typing = beats.filter((beat) => beat.previewGesture === "typing");
    expect(typing.length).toBeGreaterThan(3);
    expect(typing.every((beat) => beat.lineIndex === 2)).toBe(true);
    expect(
      typing.every((beat) => {
        const text = (
          beat.value.content as { blocks: Array<{ text: string }> }
        ).blocks[0]?.text;
        return text?.startsWith("Keep me\nAlso keep me\n");
      }),
    ).toBe(true);
    expect(
      beats.some(
        (beat) =>
          typeof beat.selectionEnd === "number" &&
          beat.lineIndex === 2 &&
          beat.selectionEnd === "Rewrite this bullet only.".length,
      ),
    ).toBe(true);
  });
});
