import { describe, expect, it, vi } from "vitest";
import {
  arbitrateAppSurface,
  choreographyDisabledResult,
  resolveAppChoreographySurface,
} from "../collaboration/app-choreography";

describe("app choreography arbitration", () => {
  it("animates a visible target exactly once", () => {
    expect(
      arbitrateAppSurface("library", {
        visibleSurfaces: ["library"],
        followingActor: false,
      }),
    ).toMatchObject({ animate: true, navigate: false, surface: "library" });
  });

  it("does not steal a viewport for an off-screen non-followed actor", () => {
    expect(
      arbitrateAppSurface("settings", {
        visibleSurfaces: ["library"],
        recentSurface: "library",
        followingActor: false,
      }),
    ).toMatchObject({ animate: false, navigate: false, surface: "none" });
  });

  it("navigates only when Follow AI is enabled", () => {
    expect(
      arbitrateAppSurface("calendar", {
        visibleSurfaces: ["library"],
        followingActor: true,
      }),
    ).toMatchObject({ animate: true, navigate: true, surface: "calendar" });
  });

  it("does not navigate for a different followed actor", () => {
    expect(
      arbitrateAppSurface("settings", {
        visibleSurfaces: ["library"],
        followingActor: true,
        followedActorId: "ai-a",
        actorId: "ai-b",
      }),
    ).toMatchObject({ animate: false, navigate: false, surface: "none" });
  });

  it("chooses exactly one of four visible rename surfaces", () => {
    const decision = resolveAppChoreographySurface(
      ["library", "workspace", "settings", "artifact"],
      "library",
      {
        visibleSurfaces: ["library", "workspace", "settings", "artifact"],
        focusedSurface: "artifact",
        recentSurface: "workspace",
        followingActor: false,
      },
    );
    expect(decision).toMatchObject({ surface: "library", animate: true, navigate: false });
  });

  it("commits identically when the visual layer is disabled", () => {
    const commit = vi.fn(() => "committed");
    expect(choreographyDisabledResult(commit)).toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
  });
});
