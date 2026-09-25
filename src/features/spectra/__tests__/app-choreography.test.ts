import { describe, expect, it, vi } from "vitest";
import {
  arbitrateAppSurface,
  appSurfaceFromPathname,
  choreographyDisabledResult,
  resolveAppChoreographySurface,
} from "../collaboration/app-choreography";

describe("app choreography arbitration", () => {
  it.each(["settings", "school", "calendar", "library"] as const)("uses exact visibility on %s and requires reveal while following", (target) => {
    const viewport = { visibleSurfaces: [target], targetVisible: false, followingActor: false, actorId: "a", followedActorId: "a" };
    expect(arbitrateAppSurface(target, viewport)).toMatchObject({ animate: false, navigate: false });
    expect(arbitrateAppSurface(target, { ...viewport, followingActor: true })).toMatchObject({ animate: true, navigate: true });
    expect(arbitrateAppSurface(target, { ...viewport, targetVisible: true })).toMatchObject({ animate: true, navigate: false });
  });

  it("does not grant an unattributed actor the selected actor's Follow permission", () => {
    expect(arbitrateAppSurface("settings", { visibleSurfaces: [], followingActor: true, followedActorId: "a" }))
      .toMatchObject({ animate: false, navigate: false });
  });

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

  it("keeps workspace and library route identities distinct", () => {
    expect(appSurfaceFromPathname("/workspace")).toBe("workspace");
    expect(appSurfaceFromPathname("/workspace/class-1")).toBe("workspace");
    expect(appSurfaceFromPathname("/library")).toBe("library");
    expect(appSurfaceFromPathname("/school/course-1")).toBe("school");
  });

  it("commits identically when the visual layer is disabled", () => {
    const commit = vi.fn(() => "committed");
    expect(choreographyDisabledResult(commit)).toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
  });
});
