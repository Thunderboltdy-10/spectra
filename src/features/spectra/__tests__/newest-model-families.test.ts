import { describe, expect, it } from "vitest";
import { newestInEachFamily } from "../ai/harness/subscription-runtime";

describe("model menus", () => {
  it("show only the newest model of each family, in the order given", () => {
    const listed = [
      "gpt-6.1-sol",
      "gpt-6-astra",
      "gpt-6.1-terra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ].map((id) => ({ id }));
    expect(newestInEachFamily(listed).map((model) => model.id)).toEqual(["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"]);
  });

  it("keeps a newer model listed after an older one, and names without numbers", () => {
    const listed = ["gpt-5.6-mini", "opus", "gpt-5.10-mini", "claude-fable-5-1"].map((id) => ({ id }));
    expect(newestInEachFamily(listed).map((model) => model.id)).toEqual(["opus", "gpt-5.10-mini", "claude-fable-5-1"]);
  });
});
