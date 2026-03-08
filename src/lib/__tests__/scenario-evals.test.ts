import { describe, expect, it } from "vitest";
import { buildRoutePlan } from "@/lib/orchestrator/route-plan";
import { isFlashcardDeckStructured, normalizeFlashcardDeck } from "@/lib/flashcard-format";
import { parseGeneratedDocument } from "@/lib/document-generator";

describe("scenario evals", () => {
  it("simple question stays simple", () => {
    const plan = buildRoutePlan({
      message: "What does ATP do in a cell?",
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
    });

    expect(plan.taskClass).toBe("simple_question");
    expect(plan.responseBudget).toBe("simple");
    expect(plan.allowedToolBundles).toEqual(["none"]);
  });

  it("personal question consults user soul only when relevant", () => {
    const plan = buildRoutePlan({
      message: "I prefer concise explanations. Remember that for me.",
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
    });

    expect(plan.personalTask).toBe(true);
    expect(plan.shouldConsultMemory).toBe(true);
    expect(plan.memoryScopes).toEqual(["user_global"]);
  });

  it("file summary uses scoped retrieval", () => {
    const plan = buildRoutePlan({
      message: "Summarize the uploaded PDF from my class pack.",
      mode: "general",
      selectedMode: "general",
      hasAttachments: true,
      hasAgent: false,
      hasPack: true,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "medium",
    });

    expect(plan.retrievalScopes).toEqual(["pack"]);
    expect(plan.allowedToolBundles).toContain("retrieval");
    expect(plan.allowedToolBundles).toContain("vision");
  });

  it("current-info prompts trigger search eligibility", () => {
    const plan = buildRoutePlan({
      message: "What are the latest AI exam policy changes this week?",
      mode: "research",
      selectedMode: "research",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "high",
      complexity: "complex",
    });

    expect(plan.shouldUseWebSearch).toBe(true);
    expect(plan.allowedToolBundles).toContain("search");
  });

  it("flashcard output remains validator-compatible", () => {
    const candidate = normalizeFlashcardDeck(`
<<FLASHCARDS_START>>
FRONT: Mitochondria
BACK: Organelle that produces ATP.

FRONT: Ribosome
BACK: Site of protein synthesis.

FRONT: Nucleus
BACK: Stores genetic material.

FRONT: Golgi apparatus
BACK: Modifies and packages proteins.
<<FLASHCARDS_END>>
`);

    expect(candidate).toBeTruthy();
    expect(isFlashcardDeckStructured(candidate ?? "")).toBe(true);
  });

  it("agent-based questions retain focused scope", () => {
    const plan = buildRoutePlan({
      message: "Use the chemistry mentor to explain reaction rates from my pack notes.",
      mode: "tutor",
      selectedMode: "tutor",
      hasAttachments: false,
      hasAgent: true,
      hasPack: true,
      hasPersonalResources: false,
      hasAgentResources: true,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "medium",
      selectedAgent: {
        _id: "agent_chem",
        name: "Chemistry mentor",
      },
    });

    expect(plan.agentContract?.resourceScopes).toEqual(["agent"]);
    expect(plan.retrievalScopes).toEqual(["pack", "agent"]);
  });

  it("document generation payloads parse into a usable artifact", () => {
    const parsed = parseGeneratedDocument(`
Here is your study guide.

<<DOCUMENT_START>>
{"type":"study_guide","title":"Cell Respiration","summary":"Core review","sections":[{"heading":"Overview","content":"Cell respiration converts glucose into ATP."}]}
<<DOCUMENT_END>>
`);

    expect(parsed.document?.type).toBe("study_guide");
    expect(parsed.document?.title).toBe("Cell Respiration");
  });

  it("simple research-mode prompts stay bounded unless live info is needed", () => {
    const plan = buildRoutePlan({
      message: "Research the main causes of the French Revolution.",
      mode: "research",
      selectedMode: "research",
      hasAttachments: false,
      hasAgent: false,
      hasPack: false,
      hasPersonalResources: false,
      hasAgentResources: false,
      autoSearchEnabled: false,
      thinkingLevel: "medium",
      complexity: "simple",
    });

    expect(plan.responseBudget).toBe("normal");
    expect(plan.shouldUseWebSearch).toBe(false);
    expect(plan.allowSubAgents).toBe(false);
  });
});
