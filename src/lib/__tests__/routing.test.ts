import { describe, expect, it } from "vitest";
import { chooseModelRoute } from "@/lib/routing/heuristic";
import { MODEL_CONFIG, ROUTER_FALLBACKS } from "@/lib/model-config";
import { STUDY_MODES, isValidStudyMode, safeStudyMode } from "@/lib/contracts/studyModes";

describe("chooseModelRoute", () => {
  it("routes marker mode to marker model", () => {
    const route = chooseModelRoute({
      mode: "marker",
      thinkingLevel: "medium",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 320,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
    });

    expect(route.primaryModel).toBe(MODEL_CONFIG.marker);
    expect(route.verificationModel).toBe(MODEL_CONFIG.verify);
  });

  it("produces a valid trace for all modes", () => {
    for (const mode of STUDY_MODES) {
      const route = chooseModelRoute({
        mode,
        thinkingLevel: "medium",
        hasAttachments: false,
        attachmentTypes: [],
        messageLength: 200,
        teacherStrictness: "medium",
        routerMode: "auto",
        studentSeemsStuck: false,
        spendingTier: "normal",
        needsSearch: false,
        promptCategory: "general",
      });

      expect(route.trace.candidates.length).toBeGreaterThan(0);
      expect(route.trace.selected.modelId).toBe(route.primaryModel);
      expect(route.trace.inputs.mode).toBe(mode);
    }
  });

  it("free-only never returns openrouter/auto and uses free primary", () => {
    for (const mode of STUDY_MODES) {
      const route = chooseModelRoute({
        mode,
        thinkingLevel: "medium",
        hasAttachments: false,
        attachmentTypes: [],
        messageLength: 200,
        teacherStrictness: "medium",
        routerMode: "auto",
        studentSeemsStuck: false,
        spendingTier: "free_only",
        needsSearch: false,
      });

      expect(route.primaryModel).not.toBe(MODEL_CONFIG.autoRouter);
      expect(route.primaryModel.includes(":free")).toBe(true);
    }
  });

  it("auto mode never returns openrouter/auto for all study modes", () => {
    for (const mode of STUDY_MODES) {
      const route = chooseModelRoute({
        mode,
        thinkingLevel: "medium",
        hasAttachments: false,
        attachmentTypes: [],
        messageLength: 200,
        teacherStrictness: "medium",
        routerMode: "auto",
        studentSeemsStuck: false,
        spendingTier: "normal",
        needsSearch: false,
      });

      expect(route.primaryModel).not.toBe(MODEL_CONFIG.autoRouter);
    }
  });

  it("openrouter auto can still be explicitly selected", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 120,
      teacherStrictness: "medium",
      routerMode: "openrouter_auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
    });

    expect(route.primaryModel).toBe(MODEL_CONFIG.autoRouter);
  });

  it("selection varies by prompt complexity for tutor mode", () => {
    const simple = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "low",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 50,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
    });

    const complex = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "high",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 1500,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: true,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "research",
    });

    expect(simple.primaryModel).not.toBe(complex.primaryModel);
  });

  it("captures tier-based eliminations in trace candidates", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "high",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 1200,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "free_only",
      needsSearch: false,
      promptCategory: "creative",
    });

    expect(route.trace.candidates.every((candidate) => candidate.modelId.includes(":free"))).toBe(true);
    expect(route.trace.inputs.spendingTier).toBe("free_only");
  });

  it("marks multimodal need in trace inputs", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "low",
      hasAttachments: true,
      attachmentTypes: ["png"],
      messageLength: 120,
      teacherStrictness: "soft",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
    });

    expect(route.trace.inputs.needsVision).toBe(true);
  });

  it("detects multimodal need from MIME attachment types", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "low",
      hasAttachments: true,
      attachmentTypes: ["image/png"],
      messageLength: 120,
      teacherStrictness: "soft",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
    });

    expect(route.trace.inputs.needsVision).toBe(true);
  });

  it("marks tabular analysis when spreadsheet attachments are present", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: true,
      attachmentTypes: ["csv"],
      messageLength: 180,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
    });

    expect(route.trace.inputs.needsTabular).toBe(true);
    expect(route.trace.toolchain).toContain("tabular_analysis");
  });

  it("applies cost efficiency penalty for expensive model on simple prompts", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "low",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 40,
      teacherStrictness: "soft",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
    });

    const scored = route.trace.candidates.find((candidate) => candidate.allowed && candidate.scoreBreakdown?.length);
    expect(scored?.scoreBreakdown?.join(" ")).toContain("costEfficiency");
  });

  it("boosts agent top model when provided", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 250,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
      agentTopModels: [{ modelId: MODEL_CONFIG.smartPaid, score: 1 }],
      agentPreferredModel: MODEL_CONFIG.smartPaid,
    });

    expect(route.trace.candidates.some((candidate) =>
      candidate.modelId === MODEL_CONFIG.smartPaid &&
      (candidate.scoreBreakdown ?? []).some((line) => line.includes("agent_model_boost"))
    )).toBe(true);
  });

  it("GLM is never the first fallback", () => {
    for (const fallbacks of Object.values(ROUTER_FALLBACKS)) {
      if (fallbacks.length === 0) continue;
      expect(fallbacks[0]).not.toBe(MODEL_CONFIG.glmAir);
    }
  });
});

describe("StudyMode validation", () => {
  it("isValidStudyMode accepts all 10 modes", () => {
    for (const mode of STUDY_MODES) {
      expect(isValidStudyMode(mode)).toBe(true);
    }
  });

  it("isValidStudyMode rejects invalid modes", () => {
    expect(isValidStudyMode("invalid")).toBe(false);
    expect(isValidStudyMode("")).toBe(false);
    expect(isValidStudyMode(null)).toBe(false);
    expect(isValidStudyMode(undefined)).toBe(false);
    expect(isValidStudyMode(42)).toBe(false);
  });

  it("safeStudyMode coerces invalid to general", () => {
    expect(safeStudyMode("invalid")).toBe("general");
    expect(safeStudyMode("")).toBe("general");
    expect(safeStudyMode(null)).toBe("general");
    expect(safeStudyMode(undefined)).toBe("general");
  });

  it("safeStudyMode passes through valid modes", () => {
    for (const mode of STUDY_MODES) {
      expect(safeStudyMode(mode)).toBe(mode);
    }
  });

  it("STUDY_MODES has exactly 11 entries", () => {
    expect(STUDY_MODES).toHaveLength(11);
  });

  it("STUDY_MODES includes research mode", () => {
    expect(STUDY_MODES).toContain("research");
    expect(STUDY_MODES).toContain("quiz");
    expect(STUDY_MODES).toContain("flashcard");
    expect(STUDY_MODES).toContain("explain");
    expect(STUDY_MODES).toContain("general");
  });
});
