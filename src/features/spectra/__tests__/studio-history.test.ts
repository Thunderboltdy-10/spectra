import { describe, expect, it } from "vitest";
import {
  createStudioHistory,
  studioHistoryShortcut,
} from "../components/artifact-studio-value-utils";

type Quiz = { questions: Array<{ id: string; prompt: string }> };

const quiz = (...questions: Array<[string, string]>): Quiz => ({
  questions: questions.map(([id, prompt]) => ({ id, prompt })),
});

describe("createStudioHistory", () => {
  it("undoes a deleted item without reverting a collaborator's later edit", () => {
    const history = createStudioHistory<Quiz>();
    const before = quiz(["q1", "One"], ["q2", "Two"]);
    const deleted = quiz(["q2", "Two"]);
    history.record(before, deleted);
    // A peer edits q2 after the delete.
    const current = quiz(["q2", "Two, revised by a peer"]);

    const undone = history.step("undo", current);
    expect(undone).toEqual(
      quiz(["q1", "One"], ["q2", "Two, revised by a peer"]),
    );
    const redone = history.step("redo", undone!);
    expect(redone).toEqual(quiz(["q2", "Two, revised by a peer"]));
  });

  it("coalesces a burst of contiguous typing into one step", () => {
    let clock = 0;
    const history = createStudioHistory<Quiz>({ now: () => clock });
    const typed = ["O", "On", "One"];
    let previous = quiz(["q1", ""]);
    for (const prompt of typed) {
      const next = quiz(["q1", prompt]);
      history.record(previous, next);
      previous = next;
      clock += 100;
    }
    clock += 2_000;
    const added = quiz(["q1", "One"], ["q2", ""]);
    history.record(previous, added);

    expect(history.step("undo", added)).toEqual(quiz(["q1", "One"]));
    expect(history.step("undo", quiz(["q1", "One"]))).toEqual(quiz(["q1", ""]));
    expect(history.step("undo", quiz(["q1", ""]))).toBeNull();
  });

  it("drops the redo branch after a new edit", () => {
    const history = createStudioHistory<Quiz>({ coalesceMs: 0 });
    history.record(quiz(), quiz(["q1", "One"]));
    history.step("undo", quiz(["q1", "One"]));
    history.record(quiz(), quiz(["q9", "Other"]));
    expect(history.step("redo", quiz(["q9", "Other"]))).toBeNull();
  });
});

describe("studioHistoryShortcut", () => {
  const key = (
    init: Partial<Parameters<typeof studioHistoryShortcut>[0]>,
  ) =>
    studioHistoryShortcut({
      key: "z",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      target: null,
      ...init,
    });

  it("maps the platform shortcuts", () => {
    expect(key({})).toBe("undo");
    expect(key({ shiftKey: true, key: "Z" })).toBe("redo");
    expect(key({ key: "y" })).toBe("redo");
    expect(key({ ctrlKey: false, metaKey: true })).toBe("undo");
    expect(key({ ctrlKey: false })).toBeNull();
  });

  it("leaves text fields to the browser's own undo", () => {
    expect(key({ target: { tagName: "TEXTAREA" } as never })).toBeNull();
    expect(key({ target: { tagName: "INPUT" } as never })).toBeNull();
    expect(
      key({ target: { tagName: "DIV", isContentEditable: true } as never }),
    ).toBeNull();
    expect(key({ target: { tagName: "BUTTON" } as never })).toBe("undo");
  });
});
