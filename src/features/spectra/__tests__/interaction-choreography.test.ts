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
        (beat) => beat.menu?.open === true && beat.menu.highlighted === "doing",
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
    // The changed words go first: selected, or backspaced when short.
    expect(
      beats.some(
        (beat) => typeof beat.selectionEnd === "number" || beat.previewGesture === "erasing",
      ),
    ).toBe(true);
    expect(beats.some((beat) => beat.previewGesture === "typing")).toBe(true);
    expect(
      beats.some(
        (beat) =>
          beat.previewGesture === "typing" &&
          typeof beat.caretOffset === "number",
      ),
    ).toBe(true);
    expect(beats.length).toBeGreaterThan(6);
    const typingBeats = beats.filter(
      (beat) =>
        beat.previewGesture === "typing" &&
        typeof beat.caretOffset === "number",
    );
    expect(typingBeats.length).toBeGreaterThanOrEqual(4);
    // A human rhythm: no two typing gaps need be equal, none is a fixed tick.
    expect(new Set(typingBeats.map((beat) => beat.delayMs)).size).toBeGreaterThan(typingBeats.length / 2);
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
        const text = (beat.value.content as { blocks: Array<{ text: string }> })
          .blocks[0]?.text;
        return text?.startsWith("Keep me\nAlso keep me\n");
      }),
    ).toBe(true);
    expect(
      beats.some(
        (beat) =>
          typeof beat.selectionEnd === "number" &&
          beat.lineIndex === 2 &&
          // Only the changed word, not the whole bullet.
          beat.selectionStart === "Rewrite this bullet ".length &&
          beat.selectionEnd === "Rewrite this bullet only".length,
      ),
    ).toBe(true);
  });

  it("streams canvas moves and resizes as one sequential native gesture", () => {
    const before = {
      title: "Board",
      tags: [],
      content: {
        nodes: [
          {
            id: "card-1",
            type: "card",
            x: 120,
            y: 260,
            width: 260,
            height: 300,
            content: { header: "Competitive", body: "Old body" },
          },
        ],
      },
    };
    const after = {
      ...before,
      content: {
        nodes: [
          {
            ...before.content.nodes[0],
            x: 168,
            y: 284,
            width: 308,
            height: 340,
          },
        ],
      },
    };

    const beats = buildArtifactLivePreviewBeats(before, after);
    const dragging = beats.filter(
      (beat) => beat.interaction?.kind === "dragging",
    );
    const resizing = beats.filter(
      (beat) => beat.interaction?.kind === "resizing",
    );

    expect(dragging.map((beat) => beat.gesturePhase)).toEqual([
      "start",
      "move",
      "move",
      "move",
      "move",
      "move",
      "release",
    ]);
    expect(resizing.map((beat) => beat.gesturePhase)).toEqual([
      "start",
      "move",
      "move",
      "move",
      "move",
      "move",
      "release",
    ]);
    expect(resizing.every((beat) => beat.focusPart === "handle:se")).toBe(true);
    expect(beats.at(-1)?.value).toEqual(after);
  });

  it("introduces a new slide before forming its nested objects and text", () => {
    const before = {
      title: "Deck",
      tags: [],
      content: {
        slides: [
          {
            id: "s1",
            layoutId: "title-only",
            title: "Opening",
            objects: [],
          },
          {
            id: "s3",
            layoutId: "statement",
            title: "Closing",
            objects: [],
          },
        ],
      },
    };
    const insertedSlide = {
      id: "s2",
      layoutId: "title-visual-text",
      title: "How inhibition changes reaction rate",
      objects: [
        {
          id: "o1",
          type: "text",
          x: 540,
          y: 180,
          width: 480,
          height: 240,
          text: "Competitive inhibition increases apparent Km.",
        },
      ],
    };
    const after = {
      ...before,
      content: {
        slides: [
          before.content.slides[0],
          insertedSlide,
          before.content.slides[1],
        ],
      },
    };

    const beats = buildArtifactLivePreviewBeats(before, after);
    const createSlideIndex = beats.findIndex(
      (beat) =>
        beat.interaction?.kind === "create" && beat.focusPath === "/slides/1",
    );
    const createObjectIndex = beats.findIndex(
      (beat) =>
        beat.interaction?.kind === "create" &&
        beat.focusPath === "/slides/1/objects/0",
    );
    const titleTypingIndex = beats.findIndex(
      (beat) =>
        beat.interaction?.kind === "typing" &&
        beat.focusPath?.endsWith("/slides/1/title"),
    );

    expect(createSlideIndex).toBeGreaterThanOrEqual(2);
    expect(createObjectIndex).toBeGreaterThan(createSlideIndex);
    expect(titleTypingIndex).toBeGreaterThan(createSlideIndex);
    expect(beats.at(-1)?.value).toEqual(after);
    expect(
      beats
        .slice(0, createSlideIndex)
        .every((beat) => beat.focusPath !== "/slides/1"),
    ).toBe(true);
  });

  it("makes new sheet cells one at a time, each typed before the next", () => {
    const sheet = (cells: Record<string, unknown>) => ({
      title: "Book",
      tags: [],
      content: { sheets: [{ id: "s1", name: "Audit", cells }] },
    });
    const before = sheet({ A1: { value: 31 }, A2: { value: 29 } });
    const after = sheet({ A1: { value: 31 }, A2: { value: 29 }, B1: { value: "First" }, A3: { formula: "=SUM(A1:A2)", value: 60 } });
    const beats = buildArtifactLivePreviewBeats(before, after, undefined, { seed: 3 });
    const cells = (index: number) => (beats[index]!.value.content as { sheets: Array<{ cells: Record<string, { value?: unknown; formula?: string }> }> }).sheets[0]!.cells;
    const firstA3 = beats.findIndex((_, index) => "A3" in cells(index));
    const typedB1 = beats.findIndex((_, index) => cells(index).B1?.value === "First");
    // B1 is clicked, made empty, then typed; A3 does not exist until B1 is done.
    expect(beats[0]!.focusPath).toBe("/sheets/0/cells/B1");
    expect(cells(1).B1?.value).toBe("");
    expect(typedB1).toBeGreaterThan(1);
    expect(firstA3).toBeGreaterThan(typedB1);
    expect(beats.some((beat, index) => index > firstA3 && beat.focusPath === "/content/sheets/0/cells/A3/formula")).toBe(true);
    expect(cells(firstA3).A3?.value).toBeUndefined();
    expect(beats.at(-1)!.value).toEqual(after);
  });

  it("prepends an IR pointer beat when the capability names a target", () => {
    const before = {
      title: "Board",
      tags: [],
      content: {
        nodes: [
          {
            id: "card-1",
            type: "card",
            x: 120,
            y: 260,
            width: 260,
            height: 300,
            content: { header: "Competitive", body: "Old body" },
          },
        ],
      },
    };
    const after = {
      ...before,
      content: {
        nodes: [
          {
            ...before.content.nodes[0],
            x: 168,
            y: 284,
          },
        ],
      },
    };
    const beats = buildArtifactLivePreviewBeats(before, after, {
      target: "canvas.card",
      region: "card-1",
    });
    expect(beats[0]?.interaction?.kind).toBe("pointer");
    expect(beats[0]?.interaction?.targetId).toBe("card-1");
    expect(beats.some((beat) => beat.interaction?.kind === "dragging")).toBe(
      true,
    );
  });
});

describe("placing a work into a page", () => {
  const reference = { embedId: "embed-1", sourceArtifactId: "work-diagram", blockId: "e1", label: "Cell membrane diagram" };
  const before = {
    title: "Notes",
    tags: [],
    content: {
      blocks: [
        { id: "b1", type: "paragraph", text: "Transport across the membrane." },
        { id: "b2", type: "paragraph", text: "Osmosis is passive." },
      ],
    },
  };
  const after = {
    ...before,
    content: {
      blocks: [
        before.content.blocks[0],
        { id: "e1", type: "paragraph", text: reference.label, reference },
        before.content.blocks[1],
      ],
    },
  };

  it("carries the work to its seam and sets it down whole, never typing its identity", () => {
    const beats = buildArtifactLivePreviewBeats(before, after);
    const carry = beats.filter((beat) => beat.carry);
    expect(carry.map((beat) => beat.carry?.phase)).toEqual(["lift", "fly", "drop"]);
    expect(carry.every((beat) => beat.carry?.workId === "work-diagram" && beat.carry.blockId === "e1")).toBe(true);
    expect(carry[0]?.carry?.seamBlockId).toBe("b1");
    expect(carry[0]?.interaction?.kind).toBe("dragging");
    expect(carry[0]?.focusPath).toContain("id:b1");
    expect(carry[2]?.focusPath).toContain("id:e1");
    // Until the drop the page holds no trace of the embed; then it holds all of it.
    const blocksOf = (beat: (typeof beats)[number]) => (beat.value.content as { blocks: { id: string; reference?: unknown }[] }).blocks;
    expect(blocksOf(carry[0]!).some((block) => block.id === "e1")).toBe(false);
    expect(blocksOf(carry[2]!).find((block) => block.id === "e1")?.reference).toEqual(reference);
    expect(beats.some((beat) => beat.previewGesture === "typing" && beat.focusPath?.includes("e1"))).toBe(false);
    expect(beats.at(-1)?.value).toEqual(after);
  });
});
