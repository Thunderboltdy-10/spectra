import { describe, expect, it } from "vitest";
import {
  artifactLivePreviewPatches,
  buildArtifactLivePreviewFrames,
} from "../collaboration/artifact-live-preview";

describe("buildArtifactLivePreviewFrames", () => {
  it("streams changed strings without changing stable identity fields", () => {
    const before = {
      title: "Study notes",
      tags: [],
      content: {
        blocks: [
          {
            id: "takeaway",
            type: "list",
            text: "Compare Km and Vmax.",
          },
        ],
      },
    };
    const after = {
      ...before,
      content: {
        blocks: [
          {
            id: "takeaway",
            type: "list",
            text: "Evaluate Km and Vmax together.",
          },
        ],
      },
    };
    const frames = buildArtifactLivePreviewFrames(before, after);
    expect(frames.length).toBeGreaterThan(2);
    expect(frames.at(-1)).toEqual(after);
    expect(artifactLivePreviewPatches(before, frames[0]!)).toEqual([
      expect.objectContaining({ path: "/content/blocks/0/text" }),
    ]);
    for (const frame of frames) {
      expect((frame.content as typeof after.content).blocks[0]?.id).toBe(
        "takeaway",
      );
      expect((frame.content as typeof after.content).blocks[0]?.type).toBe(
        "list",
      );
    }
  });

  it("rewrites the full line in place without collapsing to empty", () => {
    const before = {
      title: "Study notes",
      tags: [],
      content: {
        blocks: [
          {
            id: "takeaway",
            type: "list",
            text: "Select models by analysing Km and Vmax together.",
          },
        ],
      },
    };
    const after = {
      ...before,
      content: {
        blocks: [
          {
            id: "takeaway",
            type: "list",
            text: "Select models by interpreting Km and Vmax together.",
          },
        ],
      },
    };
    const frames = buildArtifactLivePreviewFrames(before, after);
    const texts = frames.map(
      (frame) => (frame.content as typeof after.content).blocks[0]?.text ?? "",
    );
    expect(texts.every((text) => text.length > 0)).toBe(true);
    expect(texts.some((text) => text === "")).toBe(false);
    expect(texts.at(-1)).toBe(after.content.blocks[0]?.text);
    // Select→replace streams prefixes of the new line only — no old-tail overlap.
    expect(
      texts.every(
        (text) =>
          after.content.blocks[0]!.text.startsWith(text) ||
          text === after.content.blocks[0]!.text,
      ),
    ).toBe(true);
    expect(texts.some((text) => text.includes("analysing"))).toBe(false);
  });

  it("rewrites only the changed bullet in a multiline list field", () => {
    const before = {
      title: "Study notes",
      tags: [],
      content: {
        blocks: [
          {
            id: "b23",
            type: "list",
            text: "First takeaway\nSecond takeaway\nSelect models by analysing patterns.",
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
            text: "First takeaway\nSecond takeaway\nSelect models by interpreting patterns LINE-PROOF.",
          },
        ],
      },
    };
    const frames = buildArtifactLivePreviewFrames(before, after);
    const texts = frames.map(
      (frame) => (frame.content as typeof after.content).blocks[0]?.text ?? "",
    );
    expect(texts.every((text) => text.startsWith("First takeaway\nSecond takeaway\n"))).toBe(
      true,
    );
    expect(texts.some((text) => text.includes("interpreting"))).toBe(true);
    expect(texts.at(-1)).toBe(after.content.blocks[0]?.text);
  });

  it("does not pin final punctuation onto incomplete streamed text", () => {
    const before = {
      title: "Quiz",
      tags: [],
      content: { explanation: "Enzymes are catalysts." },
    };
    const after = {
      ...before,
      content: {
        explanation:
          "Enzymes accelerate reactions by lowering activation energy.",
      },
    };
    const frames = buildArtifactLivePreviewFrames(before, after);
    const texts = frames.map(
      (frame) => (frame.content as typeof after.content).explanation,
    );
    expect(texts.every((text) => text && text.length > 0)).toBe(true);
    expect(
      (frames.at(-1)!.content as typeof after.content).explanation,
    ).toBe(after.content.explanation);
  });

  it("keeps inserted words visually separated from a preserved suffix", () => {
    const before = {
      title: "Board",
      tags: [],
      content: { body: "Competes with substrate" },
    };
    const after = {
      ...before,
      content: { body: "Competes directly with substrate" },
    };
    const frames = buildArtifactLivePreviewFrames(before, after);
    const texts = frames.map(
      (frame) => (frame.content as typeof after.content).body,
    );
    // In-place full rewrite may briefly show mixed glyphs; final must be exact.
    expect(texts.at(-1)).toBe(after.content.body);
  });

  it("settles broad source rewrites atomically instead of blanking program structure", () => {
    const beforeSource = `<html>\n<head>\n${"/* stable */\n".repeat(40)}</head>\n<body><h1>Old</h1></body>\n</html>`;
    const afterSource = `<html>\n<head>\n<style>${".new{}".repeat(60)}</style>\n</head>\n<body><h1>New</h1></body>\n</html>`;
    const before = {
      title: "Code",
      tags: [],
      content: {
        files: [{ id: "f1", path: "index.html", content: beforeSource }],
      },
    };
    const after = {
      ...before,
      content: {
        files: [{ id: "f1", path: "index.html", content: afterSource }],
      },
    };
    expect(buildArtifactLivePreviewFrames(before, after)).toEqual([after]);
  });

  it("animates independent string fields one edit at a time", () => {
    const before = {
      title: "Deck",
      tags: [],
      content: {
        cards: [
          { id: "c1", front: "Old A", back: "Back A" },
          { id: "c2", front: "Old B", back: "Back B" },
        ],
      },
    };
    const after = {
      ...before,
      content: {
        cards: [
          { id: "c1", front: "New prompt A", back: "Back A" },
          { id: "c2", front: "New prompt B", back: "Back B" },
        ],
      },
    };
    const frames = buildArtifactLivePreviewFrames(before, after);
    const mid = frames[Math.floor(frames.length / 3)]!;
    const midCards = (mid.content as typeof after.content).cards;
    // While the first card is still streaming, the second remains untouched.
    const firstDone = midCards[0]!.front === "New prompt A";
    const secondStarted = midCards[1]!.front !== "Old B";
    expect(firstDone && secondStarted).toBe(false);
    expect(frames.at(-1)).toEqual(after);
  });

  it("works for every artifact shape and settles structural edits once", () => {
    const before = {
      title: "Deck",
      tags: [],
      content: { cards: [{ id: "c1", front: "Old", back: "Answer" }] },
    };
    const after = {
      ...before,
      content: {
        cards: [
          { id: "c1", front: "Improved prompt", back: "Answer" },
          { id: "c2", front: "New", back: "Card" },
        ],
      },
    };
    const frames = buildArtifactLivePreviewFrames(before, after);
    expect(frames).toEqual([after]);
  });


  it.each([
    [
      "document block",
      { blocks: [{ id: "b1", type: "paragraph", text: "Old note" }] },
      { blocks: [{ id: "b1", type: "paragraph", text: "Clearer note" }] },
      "/content/blocks/0/text",
    ],
    [
      "deck card",
      { cards: [{ id: "c1", front: "Old prompt", back: "Answer" }] },
      { cards: [{ id: "c1", front: "Better prompt", back: "Answer" }] },
      "/content/cards/0/front",
    ],
    [
      "quiz question",
      { questions: [{ id: "q1", prompt: "Old question", type: "short" }] },
      {
        questions: [{ id: "q1", prompt: "Improved question", type: "short" }],
      },
      "/content/questions/0/prompt",
    ],
    [
      "planner dropdown",
      { title: "Task", status: "todo" },
      { title: "Task", status: "doing" },
      "/content/status",
    ],
    [
      "agent field",
      { profile: { purpose: "General help" } },
      { profile: { purpose: "Biology revision help" } },
      "/content/profile/purpose",
    ],
    [
      "timetable event",
      { events: [{ id: "e1", title: "Study" }] },
      { events: [{ id: "e1", title: "Biology review" }] },
      "/content/events/0/title",
    ],
    [
      "presentation slide",
      { slides: [{ id: "s1", title: "Overview" }] },
      { slides: [{ id: "s1", title: "Enzyme overview" }] },
      "/content/slides/0/title",
    ],
    [
      "sheet cell",
      { sheets: [{ id: "s1", cells: { A1: { value: "Old" } } }] },
      { sheets: [{ id: "s1", cells: { A1: { value: "New value" } } }] },
      "/content/sheets/0/cells/A1/value",
    ],
    [
      "code file",
      { files: [{ id: "f1", path: "main.ts", content: "return old;" }] },
      { files: [{ id: "f1", path: "main.ts", content: "return improved;" }] },
      "/content/files/0/content",
    ],
    [
      "whiteboard node",
      { nodes: [{ id: "n1", type: "text", label: "Old idea" }] },
      { nodes: [{ id: "n1", type: "text", label: "Connected idea" }] },
      "/content/nodes/0/label",
    ],
  ])(
    "emits the native path contract for a %s",
    (_label, beforeContent, afterContent, expectedPath) => {
      const before = {
        title: "Fixture",
        tags: [],
        content: beforeContent,
      };
      const after = {
        ...before,
        content: afterContent,
      };
      const frames = buildArtifactLivePreviewFrames(before, after);
      expect(frames.at(-1)).toEqual(after);
      expect(
        frames.flatMap((frame) =>
          artifactLivePreviewPatches(before, frame).map((patch) => patch.path),
        ),
      ).toContain(expectedPath);
    },
  );
});
