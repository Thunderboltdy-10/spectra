import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchAgentToMessage } from "@/lib/agent-matching";

const openRouterEmbeddingRequestMock = vi.fn();

vi.mock("@/lib/openrouter", () => ({
  openRouterEmbeddingRequest: (...args: unknown[]) => openRouterEmbeddingRequestMock(...args),
}));

describe("matchAgentToMessage", () => {
  beforeEach(() => {
    openRouterEmbeddingRequestMock.mockReset();
  });

  it("matches by semantic similarity across metadata", async () => {
    openRouterEmbeddingRequestMock
      .mockResolvedValueOnce({ embedding: [1, 0, 0] })
      .mockResolvedValueOnce({ embedding: [0.98, 0.02, 0] })
      .mockResolvedValueOnce({ embedding: [0.05, 0.95, 0] });

    const result = await matchAgentToMessage("Explain Newton's laws and momentum", [
      {
        _id: "a1",
        name: "Physics Tutor",
        category: "science",
        subjectArea: "physics",
        guidelinesSummary: "Covers mechanics, forces, and momentum",
        guidelinesTopicMap: ["newton laws", "momentum", "forces"],
      },
      {
        _id: "a2",
        name: "Essay Coach",
        category: "writing",
        subjectArea: "english",
        guidelinesTopicMap: ["thesis statement", "argument"],
      },
    ]);

    expect(result?.agentId).toBe("a1");
    expect(result?.method).toBe("semantic");
    expect(result?.score).toBeGreaterThanOrEqual(0.7);
  });

  it("returns null when no candidate passes threshold", async () => {
    openRouterEmbeddingRequestMock
      .mockResolvedValueOnce({ embedding: [1, 0] })
      .mockResolvedValueOnce({ embedding: [0, 1] });

    const result = await matchAgentToMessage("hello", [
      {
        _id: "a1",
        name: "Physics Tutor",
        category: "science",
        guidelinesTopicMap: ["newton", "momentum"],
      },
    ], { threshold: 0.6 });

    expect(result).toBeNull();
  });

  it("respects linked agent before semantic ranking", async () => {
    const result = await matchAgentToMessage("Need help with algebra equations", [
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
    ], { linkedAgentId: "a1" });

    expect(result?.agentId).toBe("a1");
    expect(result?.method).toBe("linked_agent");
  });

  it("falls back to lexical matching when embeddings are unavailable", async () => {
    openRouterEmbeddingRequestMock.mockRejectedValue(new Error("embedding down"));

    const result = await matchAgentToMessage("Need help with algebra equations", [
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
    expect(result?.method).toBe("lexical_fallback");
    expect(result?.fallbackUsed).toBe(true);
  });

  it("outperforms lexical overlap on metadata-rich semantic prompts", async () => {
    openRouterEmbeddingRequestMock
      .mockResolvedValueOnce({ embedding: [1, 0, 0] })
      .mockResolvedValueOnce({ embedding: [0.97, 0.03, 0] })
      .mockResolvedValueOnce({ embedding: [0.2, 0.8, 0] });

    const result = await matchAgentToMessage("I need help interpreting motion graphs from mechanics class", [
      {
        _id: "physics",
        name: "STEM Coach",
        category: "science",
        subjectArea: "physics",
        description: "Specializes in mechanics and kinematics problem solving",
        guidelinesSummary: "Helps with forces, motion graphs, and equations of motion",
        guidelinesTopicMap: ["kinematics", "forces"],
      },
      {
        _id: "math",
        name: "Equation Tutor",
        category: "math",
        subjectArea: "algebra",
        description: "Works on symbolic equations",
        guidelinesSummary: "Solves algebraic rearrangement and graph plotting",
        guidelinesTopicMap: ["equations", "graphs"],
      },
    ]);

    expect(result?.agentId).toBe("physics");
    expect(result?.metadataScoreBreakdown?.semantic ?? 0).toBeGreaterThan(result?.metadataScoreBreakdown?.lexical ?? 0);
  });
});
