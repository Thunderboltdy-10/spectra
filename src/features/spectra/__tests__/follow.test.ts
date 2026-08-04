// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFollowAi,
  disengageFollowAi,
  isFollowingAi,
  setFollowingAi,
} from "../collaboration/follow-ai";
import {
  __resetFollow,
  disengageFollow,
  follow,
  followTargetsEqual,
  getFollowSnapshot,
  isFollowing,
  isProgrammaticFollowOpen,
  noteFollowLocation,
  peekOnce,
  planCatchUp,
  resumeFollow,
} from "../collaboration/follow";

describe("follow (collaborator/presenter/AI)", () => {
  beforeEach(() => {
    // follow-ai reset clears the generalised store's sync subscription;
    // resetting the generalised store afterwards re-primes it.
    __resetFollowAi();
    __resetFollow();
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

  function revealEvents(): Array<{ artifactId?: string; path?: string }> {
    const revealed: Array<{ artifactId?: string; path?: string }> = [];
    window.addEventListener("spectra:reveal-target", (event) => {
      revealed.push(
        (event as CustomEvent<{ artifactId?: string; path?: string }>).detail,
      );
    });
    return revealed;
  }

  const person = {
    kind: "collaborator",
    clientId: "c-1",
    label: "Ada",
  } as const;

  it("follows a collaborator and tracks their published location", () => {
    follow(person);
    expect(getFollowSnapshot().target).toEqual(person);
    expect(isFollowing()).toBe(true);
    expect(isFollowing("c-1")).toBe(true);
    expect(isFollowing("c-2")).toBe(false);

    noteFollowLocation({
      clientId: "c-1",
      artifactId: "art-1",
      path: "/rows/4/cells/cost",
      note: "Editing the budget table",
    });
    expect(getFollowSnapshot().location).toMatchObject({
      artifactId: "art-1",
      path: "/rows/4/cells/cost",
      note: "Editing the budget table",
    });

    noteFollowLocation({
      clientId: "someone-else",
      artifactId: "art-9",
      path: "/a",
    });
    expect(getFollowSnapshot().location?.artifactId).toBe("art-1");
  });

  it("ignores locations published while nobody is followed", () => {
    noteFollowLocation({ clientId: "c-1", artifactId: "art-1", path: "/a" });
    expect(getFollowSnapshot().location).toBeNull();
  });

  it("does not re-emit an unchanged location", () => {
    follow(person);
    noteFollowLocation({ clientId: "c-1", artifactId: "art-1", path: "/a" });
    const seen: number[] = [];
    const snapshotAfter = getFollowSnapshot();
    noteFollowLocation({ clientId: "c-1", artifactId: "art-1", path: "/a" });
    expect(getFollowSnapshot()).toBe(snapshotAfter);
    expect(seen).toEqual([]);
  });

  it("opens the artifact a followed person moves to, once per move", () => {
    const opened = openEvents();
    follow(person);
    noteFollowLocation({ clientId: "c-1", artifactId: "art-1", path: "/a" });
    noteFollowLocation({ clientId: "c-1", artifactId: "art-2", path: "/b" });
    expect(opened).toEqual(["art-2"]);
    expect(isProgrammaticFollowOpen()).toBe(true);

    noteFollowLocation({ clientId: "c-1", artifactId: "art-2", path: "/c" });
    expect(opened).toEqual(["art-2"]);
  });

  it("marks only a recent programmatic open as programmatic", () => {
    vi.useFakeTimers();
    try {
      follow(person);
      noteFollowLocation({ clientId: "c-1", artifactId: "art-1" });
      noteFollowLocation({ clientId: "c-1", artifactId: "art-2" });
      expect(isProgrammaticFollowOpen()).toBe(true);
      vi.advanceTimersByTime(5000);
      expect(isProgrammaticFollowOpen()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a resumable handle when the user takes control", () => {
    follow(person);
    disengageFollow("user_input");
    expect(getFollowSnapshot().target).toBeNull();
    expect(getFollowSnapshot().disengagedFrom).toEqual(person);

    expect(resumeFollow()).toEqual(person);
    expect(getFollowSnapshot().target).toEqual(person);
    expect(getFollowSnapshot().disengagedFrom).toBeNull();
  });

  it("does not offer a return after an explicit stop", () => {
    follow(person);
    disengageFollow("explicit");
    expect(getFollowSnapshot().disengagedFrom).toBeNull();
    expect(resumeFollow()).toBeNull();
  });

  it("never leaves a return handle for AI targets", () => {
    follow({ kind: "ai" });
    disengageFollow("user_input");
    expect(getFollowSnapshot().disengagedFrom).toBeNull();
  });

  it("delegates AI follow to Follow AI in both directions", () => {
    follow({ kind: "ai" });
    expect(isFollowingAi()).toBe(true);
    expect(getFollowSnapshot().target).toEqual({ kind: "ai" });

    disengageFollow();
    expect(isFollowingAi()).toBe(false);
    expect(getFollowSnapshot().target).toBeNull();
  });

  it("reconciles an external Follow AI toggle into this store", () => {
    setFollowingAi(true);
    expect(getFollowSnapshot().target).toEqual({ kind: "ai" });

    disengageFollowAi();
    expect(getFollowSnapshot().target).toBeNull();
  });

  it("re-following a new target while following switches cleanly", () => {
    follow(person);
    follow({ kind: "presenter", clientId: "c-9", label: "Rui" });
    expect(getFollowSnapshot().target).toEqual({
      kind: "presenter",
      clientId: "c-9",
      label: "Rui",
    });
    expect(isFollowing("c-1")).toBe(false);
    expect(isFollowing("c-9")).toBe(true);
  });

  it("peek reveals once without engaging follow", () => {
    const revealed = revealEvents();
    expect(peekOnce({ artifactId: "art-3", path: "/cards/2" })).toBe(true);
    expect(revealed).toEqual([{ artifactId: "art-3", path: "/cards/2" }]);
    expect(getFollowSnapshot().target).toBeNull();
    expect(peekOnce({ artifactId: "" })).toBe(false);
  });

  it("plans a bounded late-join catch-up", () => {
    const at = (ms: number) => ({ at: ms });
    const frames = [100, 200, 300, 400, 500, 600, 700].map(at);
    const { frames: replayed, skipped } = planCatchUp({
      frames,
      followedAt: 400,
      lookbackMs: 250,
      maxFrames: 2,
    });
    // eligible: at >= 150 → 200..700 (6 frames), capped to last 2
    expect(replayed).toEqual([at(600), at(700)]);
    expect(skipped).toBe(4);
  });

  it("compares follow targets structurally", () => {
    expect(followTargetsEqual({ kind: "ai" }, { kind: "ai" })).toBe(true);
    expect(followTargetsEqual(person, { ...person })).toBe(true);
    expect(
      followTargetsEqual(person, {
        kind: "collaborator",
        clientId: "c-1",
        label: "Grace",
      }),
    ).toBe(false);
    expect(followTargetsEqual(person, null)).toBe(false);
  });
});
