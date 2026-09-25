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
});
