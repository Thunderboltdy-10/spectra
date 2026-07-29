import { describe, expect, it } from "vitest";
import {
  actForValueChange,
  aiInteractionFrame,
  aiSettleFrame,
} from "../ai/ai-interaction-frames";
import type { ActorIdentity } from "../collaboration/interaction-model";

const actor: ActorIdentity = {
  clientId: "ai:run-1",
  kind: "ai",
  name: "Maya's AI",
  ownerAccountId: "account-maya",
  ownerName: "Maya",
  runId: "run-1",
  operationId: "op-1",
};

describe("actForValueChange", () => {
  it("reports typing when characters land at the tail", () => {
    const act = actForValueChange({
      before: "Photosynthesis converts",
      after: "Photosynthesis converts light",
    });
    expect(act.kind).toBe("type");
  });

  it("reports insertion when characters land mid-value", () => {
    const act = actForValueChange({
      before: "Photosynthesis converts light",
      after: "Photosynthesis rapidly converts light",
    });
    expect(act.kind).toBe("insert");
  });

  it("reports replacement with a span over the new text", () => {
    const act = actForValueChange({
      before: "Draft title",
      after: "Final title",
    });
    expect(act.kind).toBe("replace");
    if (act.kind !== "replace") throw new Error("expected replace");
    // The span covers "Final " in the value the peer is currently showing.
    expect(act.span.anchor.offset).toBe(0);
    expect(act.span.head.offset).toBeGreaterThan(0);
  });

  it("reports deletion and collapses the span at the cut", () => {
    const act = actForValueChange({
      before: "Keep this extra clause",
      after: "Keep this clause",
    });
    expect(act.kind).toBe("delete");
    if (act.kind !== "delete") throw new Error("expected delete");
    expect(act.span.anchor).toEqual(act.span.head);
  });

  it("carries a line index for multiline values", () => {
    const act = actForValueChange({
      before: "line one\nline two\n",
      after: "line one\nline two\nline three",
    });
    if (act.kind !== "type") throw new Error("expected type");
    expect(act.point.line).toBe(2);
  });

  it("reports a selection while a replacement is being staged", () => {
    const act = actForValueChange({
      before: "Old summary text",
      after: "Old summary text",
      selectionEnd: 11,
    });
    expect(act.kind).toBe("select");
    if (act.kind !== "select") throw new Error("expected select");
    expect(act.span.head.offset).toBe(11);
  });

  it("never claims an edit when nothing changed", () => {
    expect(actForValueChange({ before: "same", after: "same" }).kind).toBe(
      "focus",
    );
  });

  it("distinguishes a move from a resize on spatial objects", () => {
    expect(
      actForValueChange({
        before: { x: 10, y: 10, width: 200, height: 120 },
        after: { x: 90, y: 40, width: 200, height: 120 },
      }).kind,
    ).toBe("dragMove");
    expect(
      actForValueChange({
        before: { x: 10, y: 10, width: 200, height: 120 },
        after: { x: 10, y: 10, width: 320, height: 180 },
      }).kind,
    ).toBe("resizeMove");
  });

  it("reads a timetable event moved on the timeline as a drag", () => {
    const act = actForValueChange({
      before: { start: "2026-03-02T09:00:00Z", end: "2026-03-02T10:00:00Z" },
      after: { start: "2026-03-02T11:00:00Z", end: "2026-03-02T12:00:00Z" },
    });
    expect(act.kind).toBe("dragMove");
  });

  it("reads a timetable event extended at its end as a resize", () => {
    const act = actForValueChange({
      before: { start: "2026-03-02T09:00:00Z", end: "2026-03-02T10:00:00Z" },
      after: { start: "2026-03-02T09:00:00Z", end: "2026-03-02T11:30:00Z" },
    });
    expect(act.kind).toBe("resizeMove");
  });

  it("reads structural collection changes", () => {
    expect(actForValueChange({ before: undefined, after: {} }).kind).toBe(
      "create",
    );
    expect(actForValueChange({ before: {}, after: undefined }).kind).toBe(
      "remove",
    );
    expect(actForValueChange({ before: [1], after: [1, 2] }).kind).toBe(
      "create",
    );
  });

  it("reads booleans as toggles carrying the new value", () => {
    const act = actForValueChange({ before: false, after: true });
    expect(act).toEqual({ kind: "toggle", value: true });
  });
});

describe("aiInteractionFrame", () => {
  it("targets the exact control and keeps owner attribution", () => {
    const frame = aiInteractionFrame({
      artifactId: "artifact-1",
      typeKey: "flashcard_deck",
      actor,
      path: "/cards/2/back",
      before: "",
      after: "A chloroplast",
      sequence: 3,
      patches: [{ path: "/content/cards/2/back", value: "A chloroplast" }],
    });
    expect(frame.v).toBe(2);
    expect(frame.actor.ownerName).toBe("Maya");
    expect(frame.target?.path).toBe("/cards/2/back");
    // Card faces accept formatting, so the descriptor table calls them richtext.
    expect(frame.target?.primitive).toBe("richtext");
    expect(frame.lifecycle).toBe("active");
    expect(frame.speculation?.sequence).toBe(3);
  });

  it("strips a /content prefix so pointers match editor annotations", () => {
    const frame = aiInteractionFrame({
      artifactId: "artifact-1",
      typeKey: "document",
      actor,
      path: "/content/blocks/3/text",
      before: "a",
      after: "ab",
      sequence: 1,
    });
    expect(frame.target?.path).toBe("/blocks/3/text");
  });

  it("publishes an observable menu rather than a bare hover", () => {
    const frame = aiInteractionFrame({
      artifactId: "artifact-1",
      typeKey: "quiz",
      actor,
      path: "/questions/0/kind",
      before: "multiple_choice",
      after: "multiple_choice",
      act: { kind: "menuNavigate", option: "short_answer" },
      menu: {
        label: "Question type",
        options: [
          { value: "multiple_choice", label: "Multiple choice" },
          { value: "short_answer", label: "Short answer" },
        ],
        highlighted: "short_answer",
      },
      sequence: 2,
    });
    expect(frame.act).toEqual({ kind: "menuNavigate", option: "short_answer" });
    expect(frame.menu?.highlighted).toBe("short_answer");
  });

  it("settles without speculation once the value is durable", () => {
    const frame = aiSettleFrame({
      artifactId: "artifact-1",
      typeKey: "document",
      actor,
      path: "/blocks/3/text",
      before: undefined,
      after: undefined,
      sequence: 9,
    });
    expect(frame.lifecycle).toBe("settled");
    expect(frame.act).toEqual({ kind: "focus" });
    expect(frame.speculation).toBeUndefined();
  });
});
