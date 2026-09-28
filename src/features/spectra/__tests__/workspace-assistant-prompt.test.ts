import { describe, expect, it } from "vitest";
import { WORKSPACE_ASSISTANT_PROMPT } from "../ai/workspace-assistant-prompt";

describe("workspace assistant recovery instructions", () => {
  it("repairs correctable errors without asking permission to continue authorized work", () => {
    expect(WORKSPACE_ASSISTANT_PROMPT).toContain(
      "Do not ask permission to retry or continue work the user already authorized",
    );
    expect(WORKSPACE_ASSISTANT_PROMPT).toContain(
      "in the same thread, not new ambiguity",
    );
    expect(WORKSPACE_ASSISTANT_PROMPT).toContain(
      "preserve compatible requirements, source evidence, and the full conversation context",
    );
  });

  it("knows its audience is students and teachers without over-refusing coursework", () => {
    // Without this the shared prompt never told the model that most readers
    // are school students, many of them minors.
    expect(WORKSPACE_ASSISTANT_PROMPT).toContain("school students, many of them minors, and their teachers");
    expect(WORKSPACE_ASSISTANT_PROMPT).toContain("age-appropriate without refusing ordinary coursework topics");
    expect(WORKSPACE_ASSISTANT_PROMPT).toContain("honest and specific feedback rather than flattery");
    expect(WORKSPACE_ASSISTANT_PROMPT).toContain("say plainly when you are unsure or evidence is missing");
  });
});
