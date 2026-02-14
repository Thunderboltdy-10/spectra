import { describe, expect, it } from "vitest";
import { normalizeModeArg, parseSlashCommand } from "@/lib/slash-commands";

describe("slash commands", () => {
  it("parses known commands", () => {
    const parsed = parseSlashCommand("/mode quiz");
    expect(parsed?.id).toBe("mode");
    expect(parsed?.args).toEqual(["quiz"]);
  });

  it("returns null for unknown commands", () => {
    expect(parseSlashCommand("/unknown x")).toBeNull();
  });

  it("normalizes mode aliases", () => {
    expect(normalizeModeArg("draft-coach")).toBe("draft_coach");
    expect(normalizeModeArg("quiz")).toBe("quiz");
    expect(normalizeModeArg("invalid")).toBeNull();
  });
});
