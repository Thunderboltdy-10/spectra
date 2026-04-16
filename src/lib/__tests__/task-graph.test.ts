import { describe, expect, it } from "vitest";
import {
  buildTaskGraph,
  executeGraph,
  resolveOrchestrationProfile,
  shouldUseMultiAgent,
  synthesize,
} from "@/lib/orchestrator/task-graph";

describe("task graph", () => {
  it("enables multi-agent for complex research", () => {
    expect(shouldUseMultiAgent("compare five studies with citations", "research", 0.9)).toBe(true);
    expect(shouldUseMultiAgent("hi", "tutor", 0.2)).toBe(false);
  });

  it("builds a graph with synthesizer dependency", () => {
    const graph = buildTaskGraph("Explain photosynthesis", "research", {
      hasVision: true,
      searchEnabled: true,
    });
    const synth = graph.find((node) => node.role === "synthesizer");
    expect(synth).toBeDefined();
    expect((synth?.dependsOn ?? []).length).toBeGreaterThan(0);
    expect(graph.some((node) => node.role === "vision_interpreter")).toBe(true);
  });

  it("executes ready nodes and synthesizes outputs", async () => {
    const graph = buildTaskGraph("Explain gravity", "research");
    const executed = await executeGraph(graph, async (node) => ({
      result: `${node.role} done`,
      tokens: 120,
    }));

    expect(executed.some((node) => node.status === "done")).toBe(true);
    const merged = synthesize(executed, "Explain gravity");
    expect(merged).toContain("Prompt: Explain gravity");
  });

  it("respects max subcall limits", async () => {
    const graph = buildTaskGraph("Compare three biology papers with citations", "research", {
      hasVision: true,
      searchEnabled: true,
    });
    let calls = 0;
    const executed = await executeGraph(
      graph,
      async (node) => {
        calls += 1;
        return { result: `${node.id} ok`, tokens: 80 };
      },
      { maxSubcalls: 2 },
    );

    expect(calls).toBeLessThanOrEqual(2);
    expect(executed.filter((node) => node.status === "done").length).toBeLessThanOrEqual(2);
  });

  it("accepts complexity labels for multi-agent decision", () => {
    expect(shouldUseMultiAgent("compare viewpoints and sources", "research", "complex")).toBe(true);
    expect(shouldUseMultiAgent("hello", "general", "simple")).toBe(false);
  });

  it("assigns profile-based orchestration contracts", () => {
    expect(resolveOrchestrationProfile("Analyze this uploaded diagram", "general", { hasVision: true })).toBe("image_analysis");
    expect(resolveOrchestrationProfile("Create flashcards from these notes", "tutor", {})).toBe("study_transform");
    expect(resolveOrchestrationProfile("Compare current policies with sources", "research", { searchEnabled: true })).toBe("search_synthesis");
  });

  it("tags generated nodes with the resolved profile", () => {
    const graph = buildTaskGraph("Create a worksheet artifact", "document", {});
    expect(graph.every((node) => node.profile === "artifact_builder")).toBe(true);
  });
});
