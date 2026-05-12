import { describe, expect, it, vi } from "vitest";
import { chooseModelRoute } from "@/lib/routing/heuristic";
import { CHEAP_MODEL_DEFAULTS, MODEL_CONFIG, MODEL_COST_BLOCK_LIST, ROUTER_FALLBACKS } from "@/lib/model-config";
import { STUDY_MODES, isValidStudyMode, safeStudyMode } from "@/lib/contracts/studyModes";
import type { StableModelAnchor } from "@/lib/model-anchor";


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

  it("keeps manual fallback candidates inside the live catalog when the selected model is stale", () => {
    const catalog = [
      {
        modelId: "openai/gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        provider: "openai",
        description: "Fast general model",
        tags: ["fast"],
        isFree: false,
      },
      {
        modelId: "google/gemini-2.0-flash-exp:free",
        name: "Gemini Flash Free",
        provider: "google",
        description: "Budget-safe fallback",
        tags: ["free"],
        isFree: true,
      },
    ];

    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 180,
      teacherStrictness: "medium",
      routerMode: "manual",
      manualModel: "legacy/removed-model",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      modelCatalog: catalog,
    });

    const catalogIds = new Set(catalog.map((item) => item.modelId));
    expect(catalogIds.has(route.primaryModel)).toBe(true);
    expect(route.fallbackModels.every((modelId) => catalogIds.has(modelId))).toBe(true);
  });

  it("rotates away from the previous auto-selected model for simple independent prompts", () => {
    const catalog = [
      {
        modelId: "alpha/fast-general",
        name: "Fast General",
        provider: "alpha",
        description: "Fast cheap model",
        inputCostPerM: 1,
        outputCostPerM: 2,
        speedRating: "high" as const,
        reasoningRating: "medium" as const,
        tags: ["fast"],
      },
      {
        modelId: "beta/fast-general",
        name: "Another Fast General",
        provider: "beta",
        description: "Fast cheap model",
        inputCostPerM: 1,
        outputCostPerM: 2,
        speedRating: "high" as const,
        reasoningRating: "medium" as const,
        tags: ["fast"],
      },
    ];

    const route = chooseModelRoute({
      mode: "general",
      thinkingLevel: "low",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 48,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
      previousModelUsed: "alpha/fast-general",
      modelCatalog: catalog,
    });

    expect(route.primaryModel).toBe("beta/fast-general");
    expect(
      route.trace.candidates.some(
        (candidate) =>
          candidate.modelId === "alpha/fast-general"
          && candidate.eliminatedBecause === "simple-turn diversity guard",
      ),
    ).toBe(true);
  });

  it("does not let the previously used model win simple auto-routing by default", () => {
    const route = chooseModelRoute({
      mode: "general",
      thinkingLevel: "low",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 90,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
      previousModelUsed: "alpha/model-a",
      modelCatalog: [
        {
          modelId: "alpha/model-a",
          name: "Model A",
          provider: "alpha",
          description: "Fast general model",
          tags: ["fast"],
          speedRating: "high",
          costRating: "low",
        },
        {
          modelId: "beta/model-b",
          name: "Model B",
          provider: "beta",
          description: "Fast general model",
          tags: ["fast"],
          speedRating: "high",
          costRating: "low",
        },
      ],
    });

    expect(route.primaryModel).toBe("beta/model-b");
  });

  it("reuses a compatible stable model anchor for non-simple auto routes", () => {
    const now = Date.now();
    const modelAnchor: StableModelAnchor = {
      modelId: "alpha/model-a",
      source: "auto",
      routeKey: "tutor:normal:no-search:no-rag:text",
      reason: "previous anchored route",
      requiredCapabilities: [],
      spendingTier: "normal",
      createdAt: now - 1_000,
      updatedAt: now - 1_000,
      expiresAt: now + 60_000,
    };

    const input: Parameters<typeof chooseModelRoute>[0] = {
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 240,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
      modelCatalog: [
        {
          modelId: "alpha/model-a",
          name: "Model A",
          provider: "alpha",
          description: "Fast general model",
          tags: ["fast"],
          speedRating: "medium",
          costRating: "low",
        },
        {
          modelId: "beta/model-b",
          name: "Model B",
          provider: "beta",
          description: "Fast general model",
          tags: ["fast"],
          speedRating: "high",
          costRating: "low",
        },
      ],
    };
    (input as typeof input & { modelAnchor: StableModelAnchor }).modelAnchor = modelAnchor;
    const route = chooseModelRoute(input);

    expect(route.primaryModel).toBe("alpha/model-a");
    expect(route.trace.selected.reason).toContain("stable conversation model anchor reused");
    expect(route.trace.requestPlan?.affinity?.retained).toBe(true);
  });

  it("does not reuse an anchor when a capability mismatch requires fallback", () => {
    const now = Date.now();
    const input: Parameters<typeof chooseModelRoute>[0] = {
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: true,
      attachmentTypes: ["image/png"],
      messageLength: 240,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
      modelCatalog: [
        {
          modelId: "alpha/model-a",
          name: "Model A",
          provider: "alpha",
          description: "Fast general model",
          tags: ["fast"],
          speedRating: "high",
          costRating: "low",
          multimodalRating: "none",
        },
        {
          modelId: "beta/vision",
          name: "Vision Model",
          provider: "beta",
          description: "Vision model",
          tags: ["vision"],
          multimodalRating: "strong",
          capabilities: { vision: 8 },
          speedRating: "medium",
          costRating: "low",
        },
      ],
    };
    (input as typeof input & { modelAnchor: StableModelAnchor }).modelAnchor = {
      modelId: "alpha/model-a",
      source: "auto",
      routeKey: "tutor:normal:no-search:no-rag:text",
      reason: "previous anchored route",
      requiredCapabilities: [],
      spendingTier: "normal",
      createdAt: now - 1_000,
      updatedAt: now - 1_000,
      expiresAt: now + 60_000,
    };
    const route = chooseModelRoute(input);

    expect(route.primaryModel).toBe("beta/vision");
    expect(route.trace.selected.reason).toContain("anchor missing vision");
    expect(route.trace.requestPlan?.affinity?.retained).toBe(false);
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

  it("rotates away from the previous model on simple independent auto-routed prompts", () => {
    const catalog = [
      {
        modelId: "openai/gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        provider: "openai",
        description: "Fast general model",
        tags: ["fast"],
        isFree: false,
      },
      {
        modelId: "google/gemini-2.0-flash-exp:free",
        name: "Gemini Flash Free",
        provider: "google",
        description: "Fast budget-safe model",
        tags: ["fast", "free"],
        isFree: true,
      },
    ];

    const route = chooseModelRoute({
      mode: "general",
      thinkingLevel: "low",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 60,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
      previousModelUsed: "openai/gpt-4.1-mini",
      modelCatalog: catalog,
    });

    expect(route.primaryModel).toBe("google/gemini-2.0-flash-exp:free");
    expect(route.trace.candidates.some((candidate) => candidate.eliminatedBecause === "simple-turn diversity guard")).toBe(true);
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

  it("enforces cheap-only budget routing", () => {
    const route = chooseModelRoute({
      mode: "research",
      thinkingLevel: "high",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 620,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "cheap_only",
      needsSearch: true,
      promptCategory: "research",
    });

    expect(route.primaryModel).not.toBe(MODEL_CONFIG.autoRouter);
    expect(
      route.primaryModel.includes(":free") || CHEAP_MODEL_DEFAULTS.has(route.primaryModel),
    ).toBe(true);
    expect(route.trace.inputs.spendingTier).toBe("cheap_only");
  });

  it("blocks expensive models when expensive_blocked tier is active", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 280,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "expensive_blocked",
      needsSearch: false,
      promptCategory: "general",
    });

    expect(route.primaryModel).not.toBe(MODEL_CONFIG.autoRouter);
    expect(MODEL_COST_BLOCK_LIST.has(route.primaryModel)).toBe(false);
    expect(route.trace.inputs.spendingTier).toBe("expensive_blocked");
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

  it("retains manual model lock on multimodal turns while queuing a vision fallback", () => {
    const manualModel = "openai/gpt-4.1-mini";
    const visionModel = "google/gemini-2.5-flash-image";
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: true,
      attachmentTypes: ["image/png"],
      messageLength: 220,
      teacherStrictness: "medium",
      routerMode: "manual",
      manualModel,
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      modelCatalog: [
        {
          modelId: manualModel,
          name: "GPT-4.1 Mini",
          provider: "openai",
          tags: ["chat"],
          multimodalRating: "none",
          inputCostPerM: 1,
          outputCostPerM: 2,
        },
        {
          modelId: visionModel,
          name: "Gemini Image",
          provider: "google",
          tags: ["vision", "image_generation"],
          multimodalRating: "strong",
        },
      ],
    });

    expect(route.primaryModel).toBe(manualModel);
    expect(route.fallbackModels).toContain(visionModel);
    expect(route.reason).toContain("manual lock retained");
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(safeStudyMode("invalid")).toBe("general");
    expect(safeStudyMode("")).toBe("general");
    expect(safeStudyMode(null)).toBe("general");
    expect(safeStudyMode(undefined)).toBe("general");
    warnSpy.mockRestore();
  });

  it("safeStudyMode passes through valid modes", () => {
    for (const mode of STUDY_MODES) {
      expect(safeStudyMode(mode)).toBe(mode);
    }
  });

  it("STUDY_MODES has exactly 12 entries", () => {
    expect(STUDY_MODES).toHaveLength(12);
  });

  it("STUDY_MODES includes research mode", () => {
    expect(STUDY_MODES).toContain("research");
    expect(STUDY_MODES).toContain("quiz");
    expect(STUDY_MODES).toContain("flashcard");
    expect(STUDY_MODES).toContain("explain");
    expect(STUDY_MODES).toContain("general");
  });
});
