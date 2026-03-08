import { describe, expect, it } from "vitest";
import { stripQuizMarkers } from "@/lib/quiz-parser";

describe("stripQuizMarkers", () => {
  it("removes quiz and flashcard wrapper notes from user-facing preambles", () => {
    const cleaned = stripQuizMarkers(`
<<QUIZ_NOTE>>Quick setup text<<QUIZ_NOTE_END>>
<<FLASHCARD_NOTE>>Deck intro<<FLASHCARD_NOTE_END>>
Helpful visible intro.
`);

    expect(cleaned).toBe("Helpful visible intro.");
  });
});
