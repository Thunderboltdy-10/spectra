import { describe, expect, it } from "vitest";
import { decideAiAuthority } from "../authority-policy";

describe("AI authority policy", () => {
  it.each([
    ["read", "proceed"],
    ["navigation", "proceed"],
    ["content", "proceed"],
    ["settings", "always-confirm"],
    ["tree", "notify"],
    ["tree_delete", "confirm"],
    ["sharing", "confirm"],
    ["local_file", "confirm"],
    ["managebac_sync", "notify"],
    ["managebac_mapping", "confirm"],
    ["memory", "notify"],
    ["credential", "prohibited"],
    ["bridge_pair", "prohibited"],
    ["account_security", "prohibited"],
  ] as const)("maps %s to %s", (target, decision) => {
    expect(decideAiAuthority({ target }).decision).toBe(decision);
  });

  it("keeps non-bypassable controls prohibited in permissive mode", () => {
    expect(
      decideAiAuthority({ target: "credential", mode: "permissive" }).decision,
    ).toBe("prohibited");
    expect(
      decideAiAuthority({ target: "bridge_pair", mode: "permissive" }).decision,
    ).toBe("prohibited");
    expect(
      decideAiAuthority({ target: "settings", mode: "permissive" }).decision,
    ).toBe("always-confirm");
  });

  it("states the concrete local-file consequence", () => {
    expect(
      decideAiAuthority({ target: "local_file", fileCount: 3 }).consequence,
    ).toBe("This will affect 3 files on this PC.");
  });
});
