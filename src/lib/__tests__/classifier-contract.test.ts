import { describe, expect, it } from "vitest";
import {
  buildClassifierInput,
  CLASSIFIER_OUTPUT_FORMATS,
  validateClassifierDecision,
  validateClassifierInput,
} from "@/lib/orchestrator/classifier-contract";
import { classifyRequest } from "@/lib/auto-settings";
import { listRegisteredSkills, resolveSkillsForContext } from "@/lib/skills/skill-registry";

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

  it("supports artifact scope metadata distinct from workspace scope", () => {
    const input = buildClassifierInput({
      message: "Tighten this draft",
      mode: "draft_coach",
      activeWorkstreamId: "ws-1",
      activeWorkstreamTitle: "English",
      activeArtifactId: "artifact-7",
      activeArtifactTitle: "Essay plan",
      selectedAgentId: "agent-1",
      conversationHistory: [],
      userThinkingLevel: "medium",
      routerMode: "auto",
      memoryEnabled: true,
      usePersonalResources: true,
      availableAgents: [
        { _id: "agent-1", name: "English Coach", category: "humanities", description: "Helps with writing" },
      ],
    });

    expect(input.scope.level).toBe("artifact");
    expect(input.scope.workspaceId).toBe("ws-1");
    expect(input.scope.workspaceTitle).toBe("Essay plan");
    expect(input.scope.itemIds).toEqual(["artifact-7"]);
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

  it("only routes trivial filler follow-ups through T0", () => {
    const filler = classifyRequest({
      message: "ok",
      complexity: "simple",
      mode: "general",
      hasAttachments: false,
      isFirstMessage: false,
      spendingTier: "normal",
    });
    const substantive = classifyRequest({
      message: "explain entropy",
      complexity: "simple",
      mode: "general",
      hasAttachments: false,
      isFirstMessage: false,
      spendingTier: "normal",
    });

    expect(filler.requestClass).toBe("T0");
    expect(substantive.requestClass).not.toBe("T0");
  });

  it("never routes first messages or attachment-bearing messages through T0", () => {
    const first = classifyRequest({
      message: "ok",
      complexity: "simple",
      mode: "general",
      hasAttachments: false,
      isFirstMessage: true,
      spendingTier: "normal",
    });
    const withAttachment = classifyRequest({
      message: "ok",
      complexity: "simple",
      mode: "general",
      hasAttachments: true,
      isFirstMessage: false,
      spendingTier: "normal",
    });

    expect(first.requestClass).not.toBe("T0");
    expect(withAttachment.requestClass).not.toBe("T0");
  });

  it("keeps classifier output formats constrained to declared schema values", () => {
    const result = validateClassifierDecision(
      {
        tier: "T1",
        skills: ["concise-chat"],
        workspaceTarget: { kind: "none" },
        agentId: null,
        needsSearch: false,
        needsMemory: false,
        needsRag: false,
        outputFormat: CLASSIFIER_OUTPUT_FORMATS[0],
        thinkingLevel: "low",
        confidence: 0.8,
      },
      ["concise-chat"],
    );

    expect(result.ok).toBe(true);
  });


  it("accepts medium-confidence classifier output for ghost generation routing", () => {
    const result = validateClassifierDecision(
      {
        tier: "T2",
        skills: ["concise-chat"],
        workspaceTarget: { kind: "current", workspaceId: "ws-ghost" },
        agentId: null,
        needsSearch: false,
        needsMemory: true,
        needsRag: true,
        outputFormat: "conversational",
        thinkingLevel: "low",
        confidence: 0.68,
      },
      ["concise-chat"],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tier).toBe("T2");
      expect(result.value.confidence).toBe(0.68);
      expect(result.value.workspaceTarget).toEqual({ kind: "current", workspaceId: "ws-ghost" });
    }
  });

  it("registers the Spectra visual skill as a substantive visualization skill", () => {
    const skill = listRegisteredSkills().find((entry) => entry.id === "spectra-visual-skill");

    expect(skill).toBeDefined();
    expect(skill?.category).toBe("visualization");
    expect(skill?.sourcePath).toBe("/public/skills/spectra-visual-skill.md");
    expect(skill?.prompt?.split(/\s+/).length ?? 0).toBeGreaterThanOrEqual(2000);
  });

  it("activates the Spectra visual skill for visual requests but not non-visual ones", () => {
    const visualSkills = resolveSkillsForContext({
      message: "Create an SVG timeline showing the stages of mitosis.",
      mode: "explain",
      allowedToolBundles: ["skills", "artifact"],
    });
    const nonVisualSkills = resolveSkillsForContext({
      message: "Summarize mitosis in one paragraph.",
      mode: "general",
      allowedToolBundles: ["skills", "artifact"],
    });

    expect(visualSkills.some((skill) => skill.id === "spectra-visual-skill")).toBe(true);
    expect(nonVisualSkills.some((skill) => skill.id === "spectra-visual-skill")).toBe(false);
  });

  it("respects explicit scopeLevel parameter over inferred scope", () => {
    const input = buildClassifierInput({
      message: "Explain quantum mechanics",
      mode: "explain",
      activeWorkstreamId: "ws-1",
      activeWorkstreamTitle: "Physics",
      activeArtifactId: "artifact-5",
      activeArtifactTitle: "Quantum Notes",
      scopeLevel: "workspace",
      selectedAgentId: undefined,
      conversationHistory: [],
      userThinkingLevel: "medium",
      routerMode: "auto",
      memoryEnabled: true,
      usePersonalResources: true,
      availableAgents: [],
    });

    // When scopeLevel is explicitly "workspace", it should override the artifact inference
    expect(input.scope.level).toBe("workspace");
    // But itemIds should still include the artifact since it was specified
    expect(input.scope.itemIds).toEqual(["artifact-5"]);
  });
});