import { describe, expect, it } from "vitest";
import { canPublishAgentArtifact } from "../components/agent-publish-gates";

describe("agent publish capability hydration", () => {
  it("keeps an owned agent publishable when capabilities are not hydrated yet", () => {
    expect(
      canPublishAgentArtifact({ ownership: "owned", capabilities: [] }),
    ).toBe(true);
  });

  it("does not grant publish to a shared viewer without the explicit capability", () => {
    expect(
      canPublishAgentArtifact({ ownership: "shared", capabilities: ["read", "use"] }),
    ).toBe(false);
  });

  it("honours an explicit publish capability without relying on ownership", () => {
    expect(
      canPublishAgentArtifact({ ownership: "shared", capabilities: ["read", "publish"] }),
    ).toBe(true);
  });
});
