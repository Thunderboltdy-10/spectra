import { describe, expect, it } from "vitest";
import {
  buildClassifierInput,
  validateClassifierDecision,
  validateClassifierInput,
} from "@/lib/orchestrator/classifier-contract";

describe("classifier contract", () => {
  it("builds a well-formed structured classifier input", () => {
    const input = buildClassifierInput({
      message: "Explícame la fotosíntesis con pasos simples",
      mode: "explain",
      activeWorkstreamId: "ws-1",
      activeWorkstreamTitle: "Biology",
      selectedAgentId: "agent-1",
      conversationHistory: [
        { role: "user", content: "Necesito ayuda con biología", mode: "general" },
      ],
      userThinkingLevel: "medium",
      routerMode: "auto",
      memoryEnabled: true,
      usePersonalResources: true,
      availableAgents: [
        { _id: "agent-1", name: "Biology Tutor", category: "science", description: "Helps with biology" },
      ],
    });

    expect(validateClassifierInput(input)).toBe(true);
    expect(input.scope.level).toBe("workspace");
    expect(input.availableSkills.length).toBeGreaterThan(0);
    expect(input.availableAgents[0]?.id).toBe("agent-1");
  });

  it("accepts valid classifier output with independent flags and multilingual stability", () => {
    const availableSkills = ["community-socratic-dialogue", "concise-chat", "deep-research"];
    const spanish = validateClassifierDecision(
      {
        tier: "T1",
        skills: ["community-socratic-dialogue"],
        workspaceTarget: { kind: "current", workspaceId: "ws-1" },
        agentId: null,
        needsSearch: false,
        needsMemory: true,
        needsRag: false,
        outputFormat: "conversational",
        thinkingLevel: "medium",
        confidence: 0.84,
      },
      availableSkills,
    );
    const english = validateClassifierDecision(
      {
        tier: "T1",
        skills: ["community-socratic-dialogue"],
        workspaceTarget: { kind: "current", workspaceId: "ws-1" },
        agentId: null,
        needsSearch: false,
        needsMemory: true,
        needsRag: false,
        outputFormat: "conversational",
        thinkingLevel: "medium",
        confidence: 0.83,
      },
      availableSkills,
    );

    expect(spanish.ok).toBe(true);
    expect(english.ok).toBe(true);
    if (spanish.ok && english.ok) {
      expect(spanish.value.tier).toBe(english.value.tier);
      expect(spanish.value.skills).toEqual(english.value.skills);
      expect(spanish.value.needsMemory).toBe(true);
      expect(spanish.value.needsSearch).toBe(false);
      expect(spanish.value.needsRag).toBe(false);
    }
  });

  it("rejects malformed classifier output before downstream consumption", () => {
    const result = validateClassifierDecision(
      {
        tier: "T9",
        skills: ["unknown-skill"],
        workspaceTarget: { kind: "current" },
        agentId: 42,
        needsSearch: "yes",
        needsMemory: false,
        needsRag: false,
        outputFormat: "invalid",
        thinkingLevel: "ultra",
        confidence: 2,
      },
      ["concise-chat"],
    );

    expect(result.ok).toBe(false);
  });
});
