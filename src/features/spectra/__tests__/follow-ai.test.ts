// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFollowAi,
  clearAiLocation,
  disengageFollowAi,
  getAiLocation,
  isFollowingAi,
  isProgrammaticOpen,
  noteAiLocation,
  setFollowingAi,
} from "../collaboration/follow-ai";

describe("follow AI", () => {
  beforeEach(() => {
    __resetFollowAi();
  });

  function openEvents(): string[] {
    const opened: string[] = [];
    window.addEventListener("spectra:open-artifact", (event) => {
      const artifactId = (event as CustomEvent<{ artifactId?: string }>).detail
        ?.artifactId;
      if (artifactId) opened.push(artifactId);
    });
    return opened;
  }

  it("never opens anything while the mode is off", () => {
    const opened = openEvents();
    noteAiLocation({ artifactId: "art-1", path: "/questions/2/prompt" });
    expect(opened).toEqual([]);
    expect(isFollowingAi()).toBe(false);
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
