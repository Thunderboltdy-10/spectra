import { describe, expect, it } from "vitest";
import { resolveStableModelAnchor, type StableModelAnchor } from "@/lib/model-anchor";
import type { CatalogModelEntry } from "@/lib/model-selection";

const now = Date.UTC(2026, 4, 12);

function anchor(overrides: Partial<StableModelAnchor> = {}): StableModelAnchor {
  return {
    modelId: "alpha/stable",
    source: "auto",
    routeKey: "tutor:normal:no-search:no-rag:text",
    reason: "previous route",
    requiredCapabilities: [],
    spendingTier: "normal",
    createdAt: now - 1_000,
    updatedAt: now - 1_000,
    expiresAt: now + 60_000,
    ...overrides,
  };
}

const catalog: CatalogModelEntry[] = [
  {
    modelId: "alpha/stable",
    provider: "alpha",
    tags: ["chat"],
    inputCostPerM: 1,
    outputCostPerM: 2,
    createdAt: now - 10 * 24 * 60 * 60 * 1000,
  },
  {
    modelId: "beta/vision",
    provider: "beta",
    tags: ["vision"],
    multimodalRating: "strong",
    capabilities: { vision: 8 },
    inputCostPerM: 1,
    outputCostPerM: 2,
    createdAt: now - 10 * 24 * 60 * 60 * 1000,
  },
];

describe("resolveStableModelAnchor", () => {
  it("reuses a compatible unexpired anchor", () => {
    const resolved = resolveStableModelAnchor({
      existingAnchor: anchor(),
      selectedModelId: "beta/vision",
      routerMode: "auto",
      mode: "tutor",
      spendingTier: "normal",
      catalog,
      routeReason: "new ranking",
      now,
    });

    expect(resolved.reuseModelId).toBe("alpha/stable");
    expect(resolved.anchor.modelId).toBe("alpha/stable");
    expect(resolved.whyThisModel).toContain("stable conversation model anchor reused");
  });

  it("falls back when route capabilities no longer match the anchor", () => {
    const resolved = resolveStableModelAnchor({
      existingAnchor: anchor(),
      selectedModelId: "beta/vision",
      routerMode: "auto",
      mode: "tutor",
      spendingTier: "normal",
      requiredCapabilities: ["vision"],
      catalog,
      routeReason: "vision route",
      now,
    });

    expect(resolved.reuseModelId).toBeUndefined();
    expect(resolved.fallbackReason).toContain("anchor missing vision");
    expect(resolved.anchor.modelId).toBe("beta/vision");
  });

  it("records manual override as an anchor replacement reason", () => {
    const resolved = resolveStableModelAnchor({
      existingAnchor: anchor(),
      selectedModelId: "beta/vision",
      routerMode: "manual",
      manualModel: "beta/vision",
      mode: "tutor",
      spendingTier: "normal",
      catalog,
      routeReason: "Manual model lock",
      now,
    });

    expect(resolved.anchor.modelId).toBe("beta/vision");
    expect(resolved.fallbackReason).toBe("manual override replaced previous model anchor");
  });

  it("surfaces stale metadata penalty in why-this-model text", () => {
    const resolved = resolveStableModelAnchor({
      selectedModelId: "alpha/stable",
      routerMode: "auto",
      mode: "tutor",
      spendingTier: "normal",
      catalog: [
        {
          ...catalog[0]!,
          createdAt: now - 120 * 24 * 60 * 60 * 1000,
        },
      ],
      routeReason: "new ranking",
      now,
      metadataStaleAfterDays: 30,
    });

    expect(resolved.staleMetadataPenalty).toBeGreaterThan(0);
    expect(resolved.whyThisModel).toContain("stale metadata penalty");
  });
});
