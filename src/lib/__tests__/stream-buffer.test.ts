import { describe, expect, it } from "vitest";
import { appendToBuffer, createBufferState } from "@/lib/structured-stream-buffer";

describe("structured stream buffer", () => {
  it("quiz buffer hides answer section during stream and completes after answers", () => {
    let state = createBufferState("quiz");

    const beforeAnswers = `1. What is 2+2?\nA) 3\nB) 4\nC) 5\n`;
    state = appendToBuffer(state, beforeAnswers);
    expect(state.safeContent).toContain("What is 2+2?");
    expect(state.safeContent).not.toContain("Correct:");
    expect(state.isComplete).toBe(false);

    const withHeader = `${beforeAnswers}\n## Answers & Explanations\n`;
    state = appendToBuffer(state, withHeader);
    expect(state.safeContent).not.toContain("Answers & Explanations");
    expect(state.isComplete).toBe(false);

    const withAnswer = `${withHeader}Correct: B\nBecause 2+2=4`;
    state = appendToBuffer(state, withAnswer);
    expect(state.isComplete).toBe(true);
    expect(state.safeContent).not.toContain("Correct: B");
  });

  it("flashcard buffer redacts BACK lines until generation completes", () => {
    let state = createBufferState("flashcard");

    const raw = `FRONT: Newton's second law\nBACK: Force equals mass times acceleration\n\nFRONT: Gravity\nBACK: Attractive force between masses`;
    state = appendToBuffer(state, raw);

    expect(state.safeContent).toContain("FRONT: Newton's second law");
    expect(state.safeContent).toContain("BACK: [Tap to reveal after generation]");
    expect(state.safeContent).not.toContain("Force equals mass times acceleration");
    expect(state.isComplete).toBe(true);
  });
});
