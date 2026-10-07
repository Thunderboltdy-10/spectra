// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleSpectraAiUiEvent,
  rememberCommittedArtifactResult,
} from "../collaboration/ai-ui-events";
import {
  __resetFollowAi,
  followAiActor,
  getAiLocation,
  getAiSurfaceLocation,
  noteAiSurface,
  setFollowingAi,
} from "../collaboration/follow-ai";
import { spectraBus } from "../events";
import { AppChoreographyMount } from "../collaboration/app-choreography-host";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const reveal = vi.hoisted(() => ({ post: vi.fn(), success: vi.fn() }));
vi.mock("../data/api", async (original) => ({ ...(await original<typeof import("../data/api")>()), postSpectra: reveal.post }));
vi.mock("@/components/ui/toast", async (original) => {
  const actual = await original<typeof import("@/components/ui/toast")>();
  return { ...actual, toast: Object.assign(actual.toast, { success: reveal.success }) };
});

describe("AI UI events", () => {
  beforeEach(() => __resetFollowAi());

  it("remembers semantic navigation without moving a non-followed viewport", () => {
    const navigated: string[] = [];
    spectraBus.handle("navigation.show", ({ route }) => {
      navigated.push(route);
    });

    handleSpectraAiUiEvent({
      key: "navigate",
      payload: { destination: "settings", targetId: "toolbar" },
    });

    expect(navigated).toEqual([]);
    expect(getAiSurfaceLocation()).toMatchObject({
      route: "settings",
      target: "toolbar",
    });

    setFollowingAi(true);
    expect(navigated).toEqual(["settings"]);
  });

  it("opens an artifact only after Follow AI is enabled", () => {
    const opened: string[] = [];
    spectraBus.handle("work.open", ({ workId }) => {
      opened.push(workId);
    });

    handleSpectraAiUiEvent({
      key: "navigate",
      payload: { destination: "artifact", targetId: "artifact-7" },
    });
    expect(opened).toEqual([]);
    expect(getAiLocation()?.note).toBe("Opening the requested work");

    setFollowingAi(true);
    expect(opened).toEqual(["artifact-7"]);
  });

  it("waits for a committed artifact id before Follow AI opens a new artifact", () => {
    const opened: string[] = [];
    const remove = spectraBus.handle("work.open", ({ workId }) => {
      opened.push(workId);
    });
    followAiActor("run-created");

    rememberCommittedArtifactResult({
      runId: "run-created",
      affected: [{ type: "pending_artifact", id: "pending-1" }],
    });
    expect(opened).toEqual([]);

    rememberCommittedArtifactResult({
      runId: "run-created",
      affected: [{ type: "artifact", id: "saved-artifact-1" }],
    });
    expect(opened).toEqual(["saved-artifact-1"]);
    remove();
  });

  it("projects Library and settings mutations into semantic surfaces", () => {
    handleSpectraAiUiEvent({
      key: "organize_library",
      payload: { targetId: "folder-1", note: "Created Sources" },
    });
    expect(getAiSurfaceLocation()).toMatchObject({
      route: "library",
      target: "folder-1",
      note: "Created Sources",
    });
    handleSpectraAiUiEvent({
      key: "settings_changed",
      payload: { note: "Updated toolbar" },
    });
    expect(getAiSurfaceLocation()).toMatchObject({
      route: "settings",
      target: "preferences",
      note: "Updated toolbar",
    });
  });

  it("keeps Follow on the prepared settings section after its saved event", () => {
    const targets: Array<string | undefined> = [];
    const remove = spectraBus.handle("navigation.show", ({ target }) => { targets.push(target); });
    followAiActor("settings-run");
    noteAiSurface({ actorId: "settings-run", route: "settings", target: "writing", note: "Updating Smart completion" });
    handleSpectraAiUiEvent({
      key: "settings_changed", runId: "settings-run",
      payload: { targetId: "writing", note: "Updated Spectra settings" },
    });
    expect(getAiSurfaceLocation()).toMatchObject({ target: "writing" });
    expect(targets).toEqual(["writing"]);
    remove();
  });

  it("remembers a saved outcome without replaying a fictitious control action", async () => {
    const { getAppChoreographyCoordinator, __resetAppChoreographyHost } =
      await import("../collaboration/app-choreography-host");
    __resetAppChoreographyHost();
    setFollowingAi(true);
    handleSpectraAiUiEvent({
      key: "organize_library",
      runId: "run-wired",
      payload: { targetId: "folder-1", note: "Created Sources" },
    });
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
    expect(getAiSurfaceLocation()).toMatchObject({ target: "folder-1", note: "Created Sources" });
    __resetAppChoreographyHost();
  });

  it("does not choreograph an internal authority notice", async () => {
    const { getAppChoreographyCoordinator, __resetAppChoreographyHost } =
      await import("../collaboration/app-choreography-host");
    __resetAppChoreographyHost();
    setFollowingAi(true);
    handleSpectraAiUiEvent({
      key: "authority_notice",
      runId: "run-authority",
      payload: { note: "Approval is required." },
    });
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
    __resetAppChoreographyHost();
  });

  it("does not turn an unacknowledged reference event into a save claim", async () => {
    const receipts: Array<Record<string, unknown>> = [];
    const remove = spectraBus.on("ai.ui.referenceReceipt", (payload) => {
      receipts.push(payload as Record<string, unknown>);
    });
    handleSpectraAiUiEvent({
      key: "reference_insert",
      runId: "run-ref",
      payload: {
        hostWorkId: "host-1",
        targetWorkId: "target-1",
        targetWorkType: "document",
        note: "Insert a live reference",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(receipts.some((row) => row.phase === "queued_refresh")).toBe(true);
    expect(receipts.every((row) => row.ok === false)).toBe(true);
    remove();
  });

  it("displays a saved reference on replay without asking any editor to insert it", () => {
    const receipts: Array<Record<string, unknown>> = [];
    let inserted = 0;
    const stopInsert = spectraBus.handle("reference.insert", () => { inserted += 1; });
    const stopReceipt = spectraBus.on("ai.ui.referenceReceipt", (payload) => { receipts.push(payload); });
    const event = { key: "reference_insert", payload: { hostWorkId: "host", targetWorkId: "target",
      receipt: { phase: "canonical_write", operationId: "operation", embedId: "embed", versionId: "version" } } };
    handleSpectraAiUiEvent(event);
    handleSpectraAiUiEvent(event);
    expect(inserted).toBe(0);
    expect(receipts).toHaveLength(2);
    expect(receipts.every((row) => row.ok === true && row.phase === "canonical_write")).toBe(true);
    stopInsert();
    stopReceipt();
  });

  it("shows a Spectra-wide Follow AI cursor at the active application target and removes it when unfollowed", async () => {
    const routes: string[] = [];
    const stopNavigation = spectraBus.handle("navigation.show", ({ route }) => {
      routes.push(route);
    });
    const host = document.createElement("div");
    const container = document.createElement("div");
    const appSurface = document.createElement("main");
    appSurface.dataset.spectraAppSurface = "true";
    const appearance = document.createElement("section");
    appearance.dataset.spectraAiTarget = "appearance";
    appearance.getBoundingClientRect = () => ({
      x: 120, y: 160, left: 120, top: 160, right: 400, bottom: 220,
      width: 280, height: 60, toJSON: () => ({}),
    }) as DOMRect;
    appSurface.append(appearance);
    host.append(appSurface);
    document.body.append(host, container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(createElement(AppChoreographyMount));
      });
      await act(async () => {
        noteAiSurface({ actorId: "run-ui", route: "settings", target: "appearance", note: "Changing the theme" });
        followAiActor("run-ui");
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(routes).toEqual(["settings"]);
      // The app-wide navigator moves the page with the client router.
      expect(router.push).toHaveBeenCalledWith("/settings?section=appearance");
      expect(container.querySelector("[data-spectra-follow-ai-viewport='true']")?.textContent)
        .toContain("Changing the theme");
      const cursor = container.querySelector<SVGElement>("[data-spectra-follow-ai-cursor='true']");
      expect(cursor).not.toBeNull();
      expect(cursor?.style.left).toBe("132px");
      expect(cursor?.style.top).toBe("172px");

      await act(async () => {
        followAiActor(null);
      });
      expect(container.querySelector("[data-spectra-follow-ai-viewport='true']")).toBeNull();
      expect(container.querySelector("[data-spectra-follow-ai-cursor='true']")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      container.remove();
      stopNavigation();
      if (previousActEnvironment === undefined)
        delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
      else actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  it("shows a public link Spectra made to the user once, fetched with their session, never from the event", async () => {
    window.localStorage.clear();
    reveal.post.mockResolvedValue({ url: "/public#secret-token" });
    const event = { key: "public_link_created", runId: "run-1", payload: { targetId: "work", resourceType: "artifact", linkId: "link", operationId: "op-1" } };
    expect(JSON.stringify(event)).not.toContain("secret-token");
    handleSpectraAiUiEvent(event);
    handleSpectraAiUiEvent(event); // a replay after reload
    await vi.waitFor(() => expect(reveal.success).toHaveBeenCalledTimes(1));
    expect(reveal.post).toHaveBeenCalledTimes(1);
    expect(reveal.post).toHaveBeenCalledWith({ action: "revealAiPublicLink", runId: "run-1", operationId: "op-1" });
    const [message, options] = reveal.success.mock.calls[0]!;
    expect(message).toBe("Spectra made a public link");
    expect(options.action.label).toBe("Copy link");
  });

  it("tells an open Code editor that Spectra changed its published build", () => {
    const changed: string[] = [];
    const off = spectraBus.on("code.publishedChanged", ({ artifactId }) => changed.push(artifactId));
    handleSpectraAiUiEvent({ key: "runtime_published", runId: "run-1", payload: { targetId: "code-1", note: "Published the live build" } });
    off();
    expect(changed).toEqual(["code-1"]);
    expect(getAiLocation()).toMatchObject({ artifactId: "code-1" });
  });

  it("tells an open agent studio that Spectra changed the agent's releases", () => {
    const changed: string[] = [];
    const off = spectraBus.on("agent.releasesChanged", ({ agentId }) => changed.push(agentId));
    handleSpectraAiUiEvent({ key: "agent_released", runId: "run-1", payload: { targetId: "agent-1", note: "Published release 3" } });
    handleSpectraAiUiEvent({ key: "agent_checked", runId: "run-1", payload: { targetId: "agent-1", note: "The agent passed its checks" } });
    off();
    expect(changed).toEqual(["agent-1", "agent-1"]);
    expect(getAiLocation()).toMatchObject({ artifactId: "agent-1" });
  });

  it("points Follow at a school resource Spectra copied into the Library, and ignores an event with no work", () => {
    handleSpectraAiUiEvent({ key: "managebac_resource_imported", runId: "run-1", payload: { note: "Copied a school resource into your Library" } });
    expect(getAiLocation()).toBeNull();
    handleSpectraAiUiEvent({ key: "managebac_resource_imported", runId: "run-1", payload: { targetId: "work-9", note: "Copied a school resource into your Library" } });
    expect(getAiLocation()).toMatchObject({ artifactId: "work-9", note: "Copied a school resource into your Library" });
  });

  it("refreshes the notifications when Spectra answers an invitation", () => {
    let refreshed = 0;
    const off = spectraBus.on("notifications.changed", () => { refreshed += 1; });
    handleSpectraAiUiEvent({ key: "share_invitation_answered", runId: "run-1", payload: { note: "Accepted the invitation" } });
    off();
    expect(refreshed).toBe(1);
  });
});
