import { describe, expect, it } from "vitest";
import {
  ACCESS_INSPECT,
  ACCESS_MODIFY,
  artifactAccessBanner,
  sharedSessionIsReadOnly,
} from "../components/artifact-access-copy";

describe("shared session access chrome", () => {
  it("keeps an owner editable when the live room briefly reports read", () => {
    expect(
      sharedSessionIsReadOnly({
        ownership: "owned",
        durableReadOnly: false,
        liveLevel: "read",
      }),
    ).toBe(false);
  });

  it("treats a live read token as inspect-only for a shared collaborator", () => {
    expect(
      sharedSessionIsReadOnly({
        ownership: "shared",
        durableReadOnly: false,
        liveLevel: "read",
      }),
    ).toBe(true);
  });

  it("does not say You can modify after a live downgrade even if the Library snapshot still says modify", () => {
    const banner = artifactAccessBanner({
      ownership: "shared",
      accessLevel: "modify",
      accessReason: "direct_share",
      liveLevel: "read",
    });
    expect(banner?.tone).toBe("inspect");
    expect(banner?.text).toContain("Shared directly with you");
    expect(banner?.text).toContain(ACCESS_INSPECT);
    expect(banner?.text).not.toContain(ACCESS_MODIFY);
  });

  it("names inspect-only once durable access is already read", () => {
    const banner = artifactAccessBanner({
      ownership: "shared",
      accessLevel: "read",
      accessReason: "direct_share",
      liveLevel: "modify",
    });
    expect(banner?.tone).toBe("inspect");
    expect(banner?.text).toContain(ACCESS_INSPECT);
  });
});
