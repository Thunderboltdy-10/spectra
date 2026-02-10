import { describe, expect, it } from "vitest";
import { chooseModelRoute } from "@/lib/routing/heuristic";
import { MODEL_CONFIG } from "@/lib/model-config";
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

  it("routes tutor high thinking to paid smart model in normal tier", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "high",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 200,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
    });

    expect(route.primaryModel).toBe(MODEL_CONFIG.smartPaid);
  });

  it("prefers multimodal when file attachments are present", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "low",
      hasAttachments: true,
      attachmentTypes: ["pdf"],
      messageLength: 120,
      teacherStrictness: "soft",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
    });

    expect(route.primaryModel).toBe(MODEL_CONFIG.multimodal);
  });

  it("uses openrouter auto when explicitly requested in normal tier", () => {
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

  it("routes all 9 modes without error", () => {
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
      expect(route.primaryModel).toBeTruthy();
      expect(route.fallbackModels).toBeInstanceOf(Array);
      expect(route.reason).toBeTruthy();
    }
  });

  it("free-only tier enforces free models", () => {
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
      expect(
        route.primaryModel === MODEL_CONFIG.autoRouter || route.primaryModel.includes(":free"),
      ).toBe(true);
    }
  });

  it("search intent routes to sonar in paid tiers", () => {
    const route = chooseModelRoute({
      mode: "research",
      thinkingLevel: "medium",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 120,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "cheap_only",
      needsSearch: true,
    });

    expect(route.primaryModel).toBe(MODEL_CONFIG.searchFast);
    expect(route.searchEnabled).toBe(true);
  });
});

describe("StudyMode validation", () => {
  it("isValidStudyMode accepts all 9 modes", () => {
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

  it("STUDY_MODES has exactly 9 entries", () => {
    expect(STUDY_MODES).toHaveLength(9);
  });

  it("STUDY_MODES includes research mode", () => {
    expect(STUDY_MODES).toContain("research");
    expect(STUDY_MODES).toContain("quiz");
    expect(STUDY_MODES).toContain("flashcard");
    expect(STUDY_MODES).toContain("explain");
    expect(STUDY_MODES).toContain("general");
  });
});
