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
  isFollowingAi,
  isProgrammaticOpen,
  noteAiLocation,
  noteAiSurface,
  setFollowingAi,
} from "../collaboration/follow-ai";
import { spectraBus } from "../events";

describe("follow AI", () => {
  beforeEach(() => {
    __resetFollowAi();
  });

  function openEvents(): string[] {
    const opened: string[] = [];
    spectraBus.handle("work.open", ({ workId }) => {
      opened.push(workId);
    });
    return opened;
  }

  it("never opens anything while the mode is off", () => {
    const opened = openEvents();
    noteAiLocation({ artifactId: "art-1", path: "/questions/2/prompt" });
    expect(opened).toEqual([]);
    expect(isFollowingAi()).toBe(false);
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
