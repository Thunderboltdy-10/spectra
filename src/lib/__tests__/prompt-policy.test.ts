import { describe, expect, it } from "vitest";
import { checkPromptPolicyResponse, tutorGate } from "@/lib/prompts/policy";

describe("tutorGate", () => {
  it("requires reflection even after two attempts", () => {
    const gate = tutorGate(2, false);
    expect(gate.allowFinalSolution).toBe(false);
  });

  it("allows final solution after attempts plus reflection", () => {
    const gate = tutorGate(2, true);
    expect(gate.allowFinalSolution).toBe(true);
  });
});

describe("checkPromptPolicyResponse", () => {
  it("accepts tutor response with question and misconception", () => {
    const valid = checkPromptPolicyResponse({
      mode: "tutor",
      response: "Try isolating acceleration. What sign should it be? Misconception check: are you mixing vector direction?",
    });

    expect(valid).toBe(true);
  });

  it("rejects marker response missing rubric keywords", () => {
    const valid = checkPromptPolicyResponse({
      mode: "marker",
      response: "Good answer overall.",
    });

    expect(valid).toBe(false);
  });
});
