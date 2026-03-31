import { describe, expect, it } from "vitest";
import { buildRoutePlan } from "@/lib/orchestrator/route-plan";

describe("buildRoutePlan", () => {
  it("keeps simple factual prompts on the cheap path", () => {
    const plan = buildRoutePlan({
      message: "What is photosynthesis?",
      mode: "general",
      selectedMode: "general",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "low",
      complexity: "simple",
      schoolSoulVersion: "school-soul-v1",
    });

    expect(plan.taskClass).toBe("simple_question");
    expect(plan.responseBudget).toBe("simple");
    expect(plan.shouldConsultMemory).toBe(false);
    expect(plan.shouldUseWebSearch).toBe(false);
    expect(plan.allowedToolBundles).toEqual(["none"]);
  });

  it("selectively enables memory for personal tutoring prompts", () => {
    const plan = buildRoutePlan({
      message: "I struggle with algebra. Remember that I need step-by-step explanations.",
      mode: "tutor",
      selectedMode: "tutor",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "medium",
      schoolSoulVersion: "school-soul-v2",
    });

    expect(plan.taskClass).toBe("personalized_help");
    expect(plan.shouldConsultMemory).toBe(true);
    expect(plan.shouldWriteMemory).toBe(true);
    expect(plan.memoryScopes).toEqual(["user_global"]);
    expect(plan.allowedToolBundles).toContain("memory");
  });

  it("keeps retrieval scopes bounded to the active pack and agent", () => {
    const plan = buildRoutePlan({
      message: "Summarize the attached chapter notes from this pack.",
      mode: "document",
      selectedMode: "document",
      hasAttachments: true,
      hasAgent: true,
      hasPack: true,
      hasPersonalResources: false,
      hasAgentResources: true,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "medium",
      selectedAgent: {
        _id: "agent_123",
        name: "History mentor",
      },
      schoolSoulVersion: "school-soul-v3",
    });

    expect(plan.shouldUseSchoolResources).toBe(true);
    expect(plan.retrievalScopes).toEqual(["pack", "agent"]);
    expect(plan.allowedToolBundles).toContain("retrieval");
    expect(plan.allowedToolBundles).toContain("artifact");
    expect(plan.allowedToolBundles).toContain("vision");
  });

  it("earns deep orchestration only for research/current-info work", () => {
    const plan = buildRoutePlan({
      message: "Research the latest 2026 university AI policy changes and compare the claims.",
      mode: "research",
      selectedMode: "research",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: true,
      thinkingLevel: "high",
      complexity: "complex",
      schoolSoulVersion: "school-soul-v4",
    });

    expect(plan.taskClass).toBe("research");
    expect(plan.shouldUseWebSearch).toBe(true);
    expect(plan.shouldUseMultiStep).toBe(true);
    expect(plan.allowSubAgents).toBe(true);
    expect(plan.allowedToolBundles).toContain("multi_agent");
  });

  it("does not treat 'current ratio' as a current-events search request", () => {
    const plan = buildRoutePlan({
      message: "Explain the current ratio formula with an example.",
      mode: "general",
      selectedMode: "general",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: true,
      thinkingLevel: "low",
      complexity: "simple",
      schoolSoulVersion: "school-soul-v5",
    });

    expect(plan.shouldUseWebSearch).toBe(false);
    expect(plan.allowedToolBundles).not.toContain("search");
    expect(plan.responseBudget).toBe("simple");
  });

  it("captures only explicitly requested artifact formats", () => {
    const plan = buildRoutePlan({
      message: "Create a Word document and PDF summary of this lesson.",
      mode: "document",
      selectedMode: "document",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "medium",
      schoolSoulVersion: "school-soul-v6",
    });

    expect(plan.requestedArtifactFormats).toEqual(["docx", "pdf"]);
    expect(plan.allowedToolBundles).toContain("artifact");
  });

  it("captures model and orchestration intent signals", () => {
    const plan = buildRoutePlan({
      message: "Use Claude and get different perspectives with multiple models.",
      mode: "general",
      selectedMode: "general",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "medium",
      schoolSoulVersion: "school-soul-v7",
    });

    expect(plan.intentSignals?.requestedModelPhrase?.toLowerCase()).toContain("claude");
    expect(plan.intentSignals?.requestedOrchestration).toBe(true);
    expect(plan.shouldUseMultiStep).toBe(true);
  });

  it("does not mark generic with-clauses as model intent", () => {
    const plan = buildRoutePlan({
      message: "Create exactly 3 quiz questions with answers and explanations.",
      mode: "quiz",
      selectedMode: "quiz",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "simple",
      schoolSoulVersion: "school-soul-v7",
    });

    expect(plan.intentSignals?.requestedModelPhrase).toBeUndefined();
  });

  it("promotes workspace-deep prompts to L4 with workstream memory scopes", () => {
    const plan = buildRoutePlan({
      message: "Continue this Biology HL workstream, check the planner, and synthesize my notes and artifacts.",
      mode: "general",
      selectedMode: "general",
      hasAttachments: false,
      hasAgent: true,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: true,
      autoSearchEnabled: true,
      thinkingLevel: "high",
      complexity: "medium",
      assignmentLevel: "L4",
      selectedAgent: {
        _id: "agent_bio",
        name: "Biology mentor",
      },
      workstreamContext: {
        activeWorkstreamId: "ws_bio",
        focusSurface: "panel",
        activeWorkstream: {
          _id: "ws_bio",
          title: "Biology HL",
          description: "Notes and IA prep",
          linkedAgentId: "agent_bio",
          artifactCount: 3,
          noteCount: 2,
          plannerItemCount: 2,
          threadCount: 4,
          recentArtifactTitles: ["IA draft", "Cell respiration summary"],
          recentNoteTitles: ["Enzymes review"],
          recentPlannerTitles: ["Finish IA section 2"],
        },
        candidates: [],
      },
      schoolSoulVersion: "school-soul-v8",
    });

    expect(plan.taskClass).toBe("workstream_deep");
    expect(plan.assignmentLevel).toBe("L4");
    expect(plan.memoryScopes).toEqual(["user_global", "workstream"]);
    expect(plan.workstreamAssignment.status).toBe("assigned");
    expect(plan.contextWindowStrategy.preferLargeContext).toBe(true);
  });

  it("keeps explicit same-thread replies unless continuity is badly degraded", () => {
    const plan = buildRoutePlan({
      message: "Yes, continue from the previous draft and tighten the conclusion.",
      mode: "document",
      selectedMode: "document",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "medium",
      threadContext: {
        currentChatId: "chat_1",
        turnCount: 10,
        turnsSinceCompaction: 6,
        contextWindowUtilization: 0.42,
        lastMessageAt: Date.now() - (30 * 60 * 1000),
        recentMessages: [
          { role: "user", content: "Help me improve this essay draft." },
          { role: "assistant", content: "I suggested a clearer thesis and stronger conclusion." },
        ],
        explicitlySameThread: true,
      },
      schoolSoulVersion: "school-soul-v9",
    });

    expect(plan.threadStrategy.action).toBe("continue");
    expect(plan.threadStrategy.contextWindowPressure).toBeLessThan(0.75);
  });
});
