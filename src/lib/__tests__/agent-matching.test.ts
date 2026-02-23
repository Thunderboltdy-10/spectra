import { describe, expect, it } from "vitest";
import { matchAgentToMessage } from "@/lib/agent-matching";

describe("matchAgentToMessage", () => {
  it("matches by topic map with strong overlap", () => {
    const result = matchAgentToMessage("Explain Newton's laws and momentum", [
      {
        _id: "a1",
        name: "Physics Tutor",
        category: "science",
        guidelinesTopicMap: ["newton laws", "momentum", "forces"],
      },
      {
        _id: "a2",
        name: "Essay Coach",
        category: "writing",
        guidelinesTopicMap: ["thesis statement", "argument"],
      },
    ]);

    expect(result?.agentId).toBe("a1");
    expect(result?.score).toBeGreaterThanOrEqual(0.3);
  });

  it("returns null when no candidate passes threshold", () => {
    const result = matchAgentToMessage("hello", [
      {
        _id: "a1",
        name: "Physics Tutor",
        category: "science",
        guidelinesTopicMap: ["newton", "momentum"],
      },
    ]);

    expect(result).toBeNull();
  });

  it("prefers the highest scoring agent", () => {
    const result = matchAgentToMessage("Need help with algebra equations", [
      {
        _id: "a1",
        name: "General Tutor",
        category: "general",
        guidelinesTopicMap: ["study skills", "revision"],
      },
      {
        _id: "a2",
        name: "Math Tutor",
        category: "math",
        guidelinesTopicMap: ["algebra", "equations", "functions"],
      },
    ]);

    expect(result?.agentId).toBe("a2");
  });
});
