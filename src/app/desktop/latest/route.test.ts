import { afterEach, describe, expect, it, vi } from "vitest";

const latestRelease = vi.fn();
vi.mock("@/lib/desktop-releases", () => ({ latestRelease: () => latestRelease() }));

const { GET } = await import("./route");

describe("/desktop/latest", () => {
  afterEach(() => latestRelease.mockReset());

  it.each([
    ["desktop-v0.2.0", "0.2.0"],
    ["bridge-v0.1.3", "0.1.3"],
    ["v0.1.2", "0.1.2"],
  ])("reads the version from the %s tag", async (tag, version) => {
    latestRelease.mockResolvedValue({ tag_name: tag });
    await expect((await GET()).json()).resolves.toEqual({ version });
  });

  it("says unknown when there is no release", async () => {
    latestRelease.mockResolvedValue(null);
    await expect((await GET()).json()).resolves.toEqual({ version: null });
  });
});
