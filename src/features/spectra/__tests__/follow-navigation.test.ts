// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAVIGATION_DESTINATIONS } from "@/app/api/spectra/run/harness/application-commands";
import { OPEN_IN_SPECTRA_DESTINATIONS } from "../ai/harness/tools/app";
import { __resetFollowAi, followAiActor, setFollowingAi } from "../collaboration/follow-ai";
import {
  FOLLOW_ROUTES,
  followRouteHref,
  navigationAllowed,
  registerInPageNavigation,
  startFollowNavigation,
} from "../collaboration/follow-navigation";
import { spectraBus } from "../events";
import type { NavigationShow } from "../collaboration/follow-navigation";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("follow navigation", () => {
  let push: ReturnType<typeof vi.fn<(href: string) => void>>;
  let stop: () => void;

  beforeEach(() => {
    __resetFollowAi();
    window.history.replaceState(null, "", "/chat");
    push = vi.fn<(href: string) => void>();
    stop = startFollowNavigation(push);
  });
  afterEach(() => stop());

  it("has a page for every destination the AI can name", () => {
    expect([...NAVIGATION_DESTINATIONS].sort()).toEqual([...FOLLOW_ROUTES].sort());
    expect([...OPEN_IN_SPECTRA_DESTINATIONS].sort()).toEqual([...FOLLOW_ROUTES].sort());
    expect(followRouteHref("agents")).toBe("/agents");
    expect(followRouteHref("agents", "tutor 1")).toBe("/agents/tutor%201");
    expect(followRouteHref("school")).toBe("/school");
    expect(followRouteHref("analytics")).toBe("/analytics");
    expect(followRouteHref("settings", "ai")).toBe("/settings?section=ai");
    expect(followRouteHref("devices", "connect")).toBe("/devices?connect=1");
    expect(followRouteHref("workspace", "ws1")).toBe("/library?workspaceId=ws1");
    expect(followRouteHref("artifact", "wx1")).toBe("/library/wx1");
  });

  it("moves the view only for an explicit request or the actor the user follows", () => {
    expect(navigationAllowed({})).toBe(false);
    expect(navigationAllowed({ intent: "explicit" })).toBe(true);
    setFollowingAi(true);
    expect(navigationAllowed({ actorId: "any" })).toBe(true);
    followAiActor("run-a");
    expect(navigationAllowed({ actorId: "run-a" })).toBe(true);
    expect(navigationAllowed({ actorId: "run-b" })).toBe(false);
    expect(navigationAllowed({})).toBe(false);
  });

  it("pushes the destination with the client router on any page", async () => {
    spectraBus.command("navigation.show", { route: "school" });
    await settle();
    expect(push).not.toHaveBeenCalled();

    setFollowingAi(true);
    spectraBus.command("navigation.show", { route: "analytics" });
    spectraBus.command("navigation.show", { route: "agents", target: "a1" });
    await settle();
    expect(push.mock.calls.map(([href]) => href)).toEqual(["/analytics", "/agents/a1"]);
  });

  it("connects this computer on an explicit request without following", async () => {
    spectraBus.command("navigation.show", { route: "devices", intent: "explicit", target: "connect" });
    await settle();
    expect(push).toHaveBeenCalledWith("/devices?connect=1");
  });

  it("does not push the page the user is already on", async () => {
    window.history.replaceState(null, "", "/calendar");
    spectraBus.command("navigation.show", { route: "calendar", intent: "explicit" });
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it("asks a page's in-page navigator first", async () => {
    const seen: NavigationShow[] = [];
    const remove = registerInPageNavigation((detail) => {
      seen.push(detail);
      return detail.route === "workspace";
    });
    spectraBus.command("navigation.show", { route: "workspace", target: "ws1", intent: "explicit" });
    spectraBus.command("navigation.show", { route: "school", intent: "explicit" });
    await settle();
    remove();
    expect(seen.map((detail) => detail.route)).toEqual(["workspace", "school"]);
    expect(push.mock.calls.map(([href]) => href)).toEqual(["/school"]);
  });

  it("opens an artifact where an artifact surface is open, and its page otherwise", async () => {
    spectraBus.command("navigation.show", { route: "artifact", target: "wx1", intent: "explicit" });
    await settle();
    expect(push).toHaveBeenCalledWith("/library/wx1");

    push.mockClear();
    const opened: string[] = [];
    const remove = spectraBus.handle("work.open", ({ workId }) => { opened.push(workId); });
    spectraBus.command("navigation.show", { route: "artifact", target: "wx2", intent: "explicit" });
    await settle();
    remove();
    expect(opened).toEqual(["wx2"]);
    expect(push).not.toHaveBeenCalled();
  });

  it("is the only navigation.show handler: the workbench and Devices request use it", () => {
    const root = join(__dirname, "..");
    const shell = readFileSync(join(root, "pages", "spectra-shell.tsx"), "utf8");
    expect(shell).not.toContain('spectraBus.handle("navigation.show"');
    expect(shell).toContain("registerInPageNavigation(");
    const events = readFileSync(join(root, "collaboration", "ai-ui-events.ts"), "utf8");
    expect(events).not.toContain("window.location.assign");
  });
});
