// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFollowAi,
  clearAiLocation,
  disengageFollowAi,
  getAiLocation,
  getAiSurfaceLocation,
  getFollowedAiActorId,
  followAiActor,
  endFollowedRun,
  isFollowingAi,
  isProgrammaticOpen,
  noteAiLocation,
  noteAiSurface,
  setFollowingAi,
} from "../collaboration/follow-ai";
import { spectraBus } from "../events";
import { clearLandings, pendingLanding } from "../anchors/open-anchor";
import * as performanceStage from "../collaboration/performance-stage";

describe("follow AI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetFollowAi();
  });

  it("keeps following a completed run until its visible performance ends", () => {
    vi.useFakeTimers();
    try {
      const playing = vi.spyOn(performanceStage, "isRunPerforming").mockReturnValue(true);
      followAiActor("run");
      endFollowedRun("run");
      vi.advanceTimersByTime(2_000);
      expect(isFollowingAi()).toBe(true);
      expect(playing).toHaveBeenCalledWith("run");
      playing.mockReturnValue(false);
      vi.advanceTimersByTime(250);
      expect(isFollowingAi()).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("lets the user stop following while the final performance is still playing", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(performanceStage, "isRunPerforming").mockReturnValue(true);
      followAiActor("run");
      endFollowedRun("run");
      vi.advanceTimersByTime(1_700);
      setFollowingAi(false);
      followAiActor("another-run");
      vi.advanceTimersByTime(1_000);
      expect(getFollowedAiActorId()).toBe("another-run");
      expect(isFollowingAi()).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  function openEvents(): string[] {
    const opened: string[] = [];
    spectraBus.handle("work.open", ({ workId }) => {
      opened.push(workId);
    });
    return opened;
  }

  it("ignores a late studio frame after its run advances to the next artifact", () => {
    const opened = openEvents();
    followAiActor("run");
    noteAiLocation({ actorId: "run", artifactId: "first" });
    noteAiLocation({ actorId: "run", artifactId: "next" });
    noteAiLocation({ actorId: "run", artifactId: "first", path: "/blocks/old/text", refineOnly: true });
    expect(opened).toEqual(["first", "next"]);
    expect(getAiLocation()?.artifactId).toBe("next");
    noteAiLocation({ actorId: "run", artifactId: "next", path: "/blocks/new/text", refineOnly: true });
    expect(getAiLocation()?.path).toBe("/blocks/new/text");
  });

  it("never opens anything while the mode is off", () => {
    const opened = openEvents();
    noteAiLocation({ artifactId: "art-1", path: "/questions/2/prompt" });
    expect(opened).toEqual([]);
    expect(isFollowingAi()).toBe(false);
  });

  it("finishes the hand on screen before it moves the view on, then plays the moves in order", () => {
    vi.useFakeTimers();
    try {
      const opened = openEvents();
      const navigated: string[] = [];
      spectraBus.handle("navigation.show", ({ route, target }) => {
        navigated.push(`${route}:${target ?? ""}`);
      });
      const playing = vi.spyOn(performanceStage, "isRunPerforming").mockReturnValue(false);
      followAiActor("run");
      noteAiLocation({ actorId: "run", artifactId: "plan" });
      expect(opened).toEqual(["plan"]);
      // The plan is still being typed here while the run already schedules.
      playing.mockReturnValue(true);
      noteAiSurface({ actorId: "run", route: "calendar", target: "mon", note: "Scheduling" });
      noteAiLocation({ actorId: "run", artifactId: "plan", path: "/blocks/3/text", refineOnly: true });
      vi.advanceTimersByTime(400);
      noteAiSurface({ actorId: "run", route: "calendar", target: "tue", note: "Scheduling" });
      vi.advanceTimersByTime(2_000);
      expect(navigated).toEqual([]);
      expect(getAiLocation()?.path).toBe("/blocks/3/text");
      playing.mockReturnValue(false);
      vi.advanceTimersByTime(200);
      expect(navigated).toEqual(["calendar:mon"]);
      // A replayed move is news on arrival, so what it placed is shown arriving.
      expect(getAiSurfaceLocation()).toMatchObject({ target: "mon" });
      expect(Date.now() - getAiSurfaceLocation()!.updatedAt).toBeLessThan(200);
      vi.advanceTimersByTime(450);
      expect(navigated).toEqual(["calendar:mon", "calendar:tue"]);
    } finally { vi.useRealTimers(); }
  });

  it("never holds a view that is not following", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(performanceStage, "isRunPerforming").mockReturnValue(true);
      noteAiSurface({ actorId: "run", route: "calendar", target: "mon" });
      expect(getAiSurfaceLocation()).toMatchObject({ target: "mon" });
    } finally { vi.useRealTimers(); }
  });

  it("brings the record up to date when the user stops following during a hold", () => {
    vi.useFakeTimers();
    try {
      const opened = openEvents();
      const playing = vi.spyOn(performanceStage, "isRunPerforming").mockReturnValue(false);
      followAiActor("run");
      noteAiLocation({ actorId: "run", artifactId: "plan" });
      playing.mockReturnValue(true);
      noteAiLocation({ actorId: "run", artifactId: "task" });
      expect(opened).toEqual(["plan"]);
      disengageFollowAi();
      expect(getAiLocation()?.artifactId).toBe("task");
      vi.advanceTimersByTime(1_000);
      expect(opened).toEqual(["plan"]);
    } finally { vi.useRealTimers(); }
  });

  it("carries a followed actor across app routes without moving a non-followed viewport", () => {
    const navigated: string[] = [];
    spectraBus.handle("navigation.show", ({ route }) => {
      navigated.push(route);
    });
    noteAiSurface({
      route: "settings",
      target: "toolbar",
      note: "Changing the Document toolbar",
    });
    expect(navigated).toEqual([]);
    setFollowingAi(true);
    expect(navigated).toEqual(["settings"]);
    noteAiSurface({ route: "calendar", note: "Reviewing next week" });
    expect(navigated).toEqual(["settings", "calendar"]);
  });

  it("follows exactly one actor while another continues silently", () => {
    const navigated: string[] = [];
    spectraBus.handle("navigation.show", ({ route }) => {
      navigated.push(route);
    });
    noteAiSurface({ actorId: "run-a", route: "library", note: "Organizing" });
    noteAiSurface({ actorId: "run-b", route: "settings", note: "Configuring" });
    followAiActor("run-a");
    expect(getFollowedAiActorId()).toBe("run-a");
    expect(navigated).toEqual(["library"]);
    noteAiSurface({ actorId: "run-b", route: "calendar", note: "Scheduling" });
    expect(navigated).toEqual(["library"]);
    noteAiSurface({ actorId: "run-a", route: "workspace", note: "Returning" });
    expect(navigated).toEqual(["library", "workspace"]);
  });

  it("does not redispatch an unchanged followed surface", () => {
    const navigated: string[] = [];
    spectraBus.handle("navigation.show", ({ route }) => {
      navigated.push(route);
    });
    noteAiSurface({ route: "settings", target: "toolbar", note: "Editing" });
    setFollowingAi(true);
    noteAiSurface({ route: "settings", target: "toolbar", note: "Editing" });
    expect(navigated).toEqual(["settings"]);
  });

  it("clears a remembered surface even when no artifact is open", () => {
    noteAiSurface({ route: "settings", target: "toolbar" });
    clearAiLocation();
    expect(getAiLocation()).toBeNull();
    expect(getAiSurfaceLocation()).toBeNull();
  });

  it("opens the artifact the AI moves to while following", () => {
    const opened = openEvents();
    setFollowingAi(true);
    noteAiLocation({ artifactId: "art-1", path: "/questions/2/prompt" });
    noteAiLocation({ artifactId: "art-1", path: "/questions/3/prompt" });
    expect(opened).toEqual(["art-1"]);

    noteAiLocation({ artifactId: "art-2", path: "/cards/0/front" });
    expect(opened).toEqual(["art-1", "art-2"]);
  });

  it("opens the current location immediately when the mode is switched on", () => {
    const opened = openEvents();
    noteAiLocation({ artifactId: "art-1" });
    setFollowingAi(true);
    expect(opened).toEqual(["art-1"]);
  });

  it("marks its own opens as programmatic so shells do not disengage", () => {
    setFollowingAi(true);
    noteAiLocation({ artifactId: "art-1" });
    expect(isProgrammaticOpen()).toBe(true);
  });

  it("does not re-dispatch the same open in a burst of path updates", () => {
    const opened = openEvents();
    setFollowingAi(true);
    noteAiLocation({ artifactId: "art-1", path: "/a" });
    noteAiLocation({ artifactId: "art-1", path: "/b" });
    noteAiLocation({ artifactId: "art-1", path: "/c" });
    expect(opened).toEqual(["art-1"]);
  });

  it("stops opening the moment the user takes control", () => {
    const opened = openEvents();
    setFollowingAi(true);
    disengageFollowAi();
    expect(isFollowingAi()).toBe(false);
    noteAiLocation({ artifactId: "art-9" });
    expect(opened).toEqual([]);
  });

  it("tracks the latest location for the thread panel", () => {
    noteAiLocation({
      artifactId: "art-1",
      path: "/questions/3/prompt",
      note: "Rewriting question 3",
    });
    expect(getAiLocation()).toMatchObject({
      artifactId: "art-1",
      path: "/questions/3/prompt",
      note: "Rewriting question 3",
    });
    clearAiLocation("art-1");
    expect(getAiLocation()).toBeNull();
  });

  it("does not republish an unchanged semantic location", () => {
    noteAiLocation({
      artifactId: "art-1",
      path: "/questions/3/prompt",
      note: "Rewriting question 3",
    });
    const first = getAiLocation();
    expect(first).not.toBeNull();

    noteAiLocation({
      artifactId: "art-1",
      path: "/questions/3/prompt",
      note: "Rewriting question 3",
    });

    expect(getAiLocation()).toBe(first);
  });

  it("locks the most recent attributed actor when Follow is toggled on", () => {
    const opened = openEvents();
    noteAiLocation({ actorId: "run-a", artifactId: "art-a" });
    noteAiLocation({ actorId: "run-b", artifactId: "art-b" });
    setFollowingAi(true);
    expect(getFollowedAiActorId()).toBe("run-b");
    expect(opened).toEqual(["art-b"]);
    noteAiLocation({ actorId: "run-a", artifactId: "art-a2" });
    expect(opened).toEqual(["art-b"]);
  });

  it("does not navigate for unattributed events after an actor is locked", () => {
    const opened = openEvents();
    followAiActor("run-a");
    noteAiLocation({ actorId: "run-a", artifactId: "art-a" });
    expect(opened).toEqual(["art-a"]);
    noteAiLocation({ artifactId: "art-other" });
    expect(opened).toEqual(["art-a"]);
  });

  it("still follows a named actor through followAiActor after a later run appears", () => {
    noteAiLocation({ actorId: "run-a", artifactId: "art-a" });
    noteAiLocation({ actorId: "run-b", artifactId: "art-b" });
    followAiActor("run-a");
    expect(getFollowedAiActorId()).toBe("run-a");
    const opened = openEvents();
    noteAiLocation({ actorId: "run-b", artifactId: "art-b2" });
    expect(opened).toEqual([]);
    noteAiLocation({ actorId: "run-a", artifactId: "art-a2" });
    expect(opened).toEqual(["art-a2"]);
  });

  it("opens the artifact at the place Spectra asked to show, and moves there when already open", () => {
    clearLandings();
    const regions: unknown[] = [];
    spectraBus.handle("work.open", ({ region }) => {
      regions.push(region);
    });
    setFollowingAi(true);
    noteAiLocation({ artifactId: "art-1", region: { id: "slide-2" } });
    expect(regions).toEqual([{ id: "slide-2" }]);
    noteAiLocation({ artifactId: "art-1", path: "/slides/4", region: { id: "slide-5" } });
    expect(regions).toHaveLength(1);
    expect(pendingLanding("art-1")?.region).toEqual({ id: "slide-5" });
    clearLandings();
  });

  it("does not move a view that is not following to the place Spectra named", () => {
    clearLandings();
    noteAiLocation({ artifactId: "art-1", region: { id: "slide-2" } });
    noteAiLocation({ artifactId: "art-1", path: "/x", region: { id: "slide-3" } });
    expect(pendingLanding("art-1")).toBeUndefined();
  });

  it("ignores a programmatic-open window that has expired", () => {
    vi.useFakeTimers();
    try {
      setFollowingAi(true);
      noteAiLocation({ artifactId: "art-1" });
      expect(isProgrammaticOpen()).toBe(true);
      vi.advanceTimersByTime(5000);
      expect(isProgrammaticOpen()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
