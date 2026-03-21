import { describe, expect, it } from "vitest";
import { buildDirectiveMemoryEntries } from "@/lib/orchestrator/post-process";

describe("memory directive routing helpers", () => {
  it("builds layer-2 compatible entries for remember directives", () => {
    const entries = buildDirectiveMemoryEntries({
      statement: "I study IB HL Physics",
      directiveType: "remember",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.category).toBe("academic");
    expect(entries[0]?.text).toBe("I study IB HL Physics");
  });

  it("normalizes profile updates into profile entries", () => {
    const entries = buildDirectiveMemoryEntries({
      statement: "I prefer concise explanations",
      directiveType: "update_profile",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.key).toBe("profile_update");
    expect(entries[0]?.category).toBe("preference");
  });
});
