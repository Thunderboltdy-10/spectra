import { describe, expect, it } from "vitest";
import { buildDirectiveMemoryEntries } from "@/lib/orchestrator/post-process";

describe("memory directive routing helpers", () => {
  it("builds layer-2 compatible entries for remember directives", () => {
    const entries = buildDirectiveMemoryEntries({
      statement: "I study IB HL Physics",
      directiveType: "remember",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.key).toBe("remember_i_study_ib_hl_physics");
    expect(entries[0]?.category).toBe("academic");
    expect(entries[0]?.text).toBe("I study IB HL Physics");
  });

  it("derives distinct remember keys from each statement", () => {
    const first = buildDirectiveMemoryEntries({
      statement: "Remember that I love chemistry labs",
      directiveType: "remember",
    });
    const second = buildDirectiveMemoryEntries({
      statement: "Remember that World War II is my strongest topic",
      directiveType: "remember",
    });
    expect(first[0]?.key).not.toBe(second[0]?.key);
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
