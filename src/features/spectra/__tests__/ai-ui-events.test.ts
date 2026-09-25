// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  handleSpectraAiUiEvent,
  rememberCommittedArtifactResult,
} from "../collaboration/ai-ui-events";
import {
  __resetFollowAi,
  followAiActor,
  getAiSurfaceLocation,
  noteAiSurface,
  setFollowingAi,
} from "../collaboration/follow-ai";
import { spectraBus } from "../events";
import { AppChoreographyMount } from "../collaboration/app-choreography-host";

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

  it("enqueues app choreography when a run id is present", async () => {
    const { getAppChoreographyCoordinator, __resetAppChoreographyHost } =
      await import("../collaboration/app-choreography-host");
    __resetAppChoreographyHost();
    setFollowingAi(true);
    handleSpectraAiUiEvent({
      key: "organize_library",
      runId: "run-wired",
      payload: { targetId: "folder-1", note: "Created Sources" },
    });
    expect(getAppChoreographyCoordinator().snapshot()).toContainEqual(
      expect.objectContaining({
        actorId: "run-wired",
        target: "library",
        status: "performing",
      }),
    );
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
});

