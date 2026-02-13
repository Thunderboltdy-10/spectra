import { describe, expect, it } from "vitest";
import { chooseModelRoute } from "@/lib/routing/heuristic";

describe("route trace", () => {
  it("is JSON serializable without circular references", () => {
    const route = chooseModelRoute({
      mode: "tutor",
      thinkingLevel: "medium",
      hasAttachments: false,
      attachmentTypes: [],
      messageLength: 180,
      teacherStrictness: "medium",
      routerMode: "auto",
      studentSeemsStuck: false,
      spendingTier: "normal",
      needsSearch: false,
      promptCategory: "general",
      needsRag: true,
      promptEnhanced: true,
    });

    const serialized = JSON.stringify(route.trace);
    expect(serialized.length).toBeGreaterThan(20);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});
