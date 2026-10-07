import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SPECTRA_PREFERENCES } from "../settings/schema";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import { devicePairing } from "../devices/pairing";

const { runLocalDeviceAction } = vi.hoisted(() => ({
  runLocalDeviceAction: vi.fn(async (request: { action: string }) => ({ status: "completed" as const, message: `ran ${request.action}` })),
}));
vi.mock("../devices/device-actions", () => ({ runLocalDeviceAction }));
import { spectraBus } from "../events";
import { clearLandings, pendingLanding } from "../anchors/open-anchor";

describe("application command dispatcher", () => {
  it("records where a work should land before asking the host to open it", async () => {
    clearLandings();
    let seen: unknown;
    const openArtifact = vi.fn((workId: string) => {
      seen = pendingLanding(workId)?.region;
    });
    const dispatch = createApplicationCommandDispatcher({
      openArtifact,
      navigate: vi.fn(),
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });
    await dispatch("app.work.open", { workId: "work-1", region: { id: "slide-2", label: "Slide 2: Results" } });
    expect(seen).toEqual({ id: "slide-2", label: "Slide 2: Results" });
    clearLandings();
    await dispatch("app.work.open", { workId: "work-1" });
    expect(pendingLanding("work-1")).toBeUndefined();
  });

  it("routes navigation and work opening through the shell host", async () => {
    const openArtifact = vi.fn();
    const navigate = vi.fn();
    const dispatch = createApplicationCommandDispatcher({
      openArtifact,
      navigate,
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });

    await dispatch("app.navigate", { destination: "settings", targetId: "workbar" });
    await dispatch("app.navigate", { destination: "artifact", targetId: "artifact-2" });
    await dispatch("app.work.open", { workId: "artifact-1", surface: "full" });
    await dispatch("app.calendar.open", {});
    await dispatch("app.work.openLibrary", {});
    await dispatch("app.work.openWorkspace", { workspaceId: "ws-1" });

    expect(openArtifact).toHaveBeenCalledWith("artifact-2", "panel");
    expect(openArtifact).toHaveBeenCalledWith("artifact-1", "full");
    expect(navigate).toHaveBeenCalledWith("settings", "workbar");
    expect(navigate).toHaveBeenCalledWith("calendar");
    expect(navigate).toHaveBeenCalledWith("library", undefined);
    expect(navigate).toHaveBeenCalledWith("workspace", "ws-1");
  });

  it("returns the typed effect and readiness acknowledgement from public actions", async () => {
    const readiness = {
      actionId: "action-1",
      targetId: "chat",
      view: "conversation" as const,
      routeGeneration: 4,
      status: "ready" as const,
    };
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate: vi.fn(),
      openRoute: vi.fn().mockResolvedValue(readiness),
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });
    await expect(dispatch("app.page.chat", {})).resolves.toMatchObject({
      commandId: "app.page.chat",
      effect: "navigate",
      status: "completed",
      readiness,
    });
  });

  it("merges account settings patches without inventing a parallel store", async () => {
    const replacePreferences = vi.fn();
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate: vi.fn(),
      replacePreferences,
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });

    await dispatch("app.settings.change", {
      patch: { workbar: { document: { groupOrder: { General: ["Font", "Paragraph"] } } } },
      section: "workbar",
    });

    expect(replacePreferences).toHaveBeenCalledWith(expect.objectContaining({
      workbar: { document: { groupOrder: { General: ["Font", "Paragraph"] } } },
    }));
  });

  it("merges a partial settings patch without wiping sibling workbar pins", async () => {
    const replacePreferences = vi.fn();
    const current = {
      ...DEFAULT_SPECTRA_PREFERENCES,
      workbar: {
        document: { commands: { "document.format.bold": { pinned: true } } },
        sheets: { commands: { "sheets.format.bold": { pinned: true } } },
      },
    };
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate: vi.fn(),
      replacePreferences,
      preferences: current,
    });

    await dispatch("app.settings.change", {
      patch: { workbar: { document: { commands: { "document.format.italic": { hidden: true } } } } },
    });

    expect(replacePreferences).toHaveBeenCalledWith(expect.objectContaining({
      workbar: {
        document: {
          commands: {
            "document.format.bold": { pinned: true },
            "document.format.italic": { hidden: true },
          },
        },
        sheets: { commands: { "sheets.format.bold": { pinned: true } } },
      },
    }));
  });

  it("fails loudly when a supported semantic mutation has no mounted host", async () => {
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate: vi.fn(),
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });

    await expect(dispatch("app.library.organize", {})).rejects.toThrow(
      "APPLICATION_COMMAND_HANDLER_UNAVAILABLE",
    );
  });

  it("does not claim a reference insertion succeeded without a mounted host", async () => {
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate: vi.fn(),
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });
    await expect(dispatch("app.reference.insert", {
      hostWorkId: "work-1",
      target: { workId: "work-2", kind: "work:root", path: ["work", "root"] },
    })).rejects.toThrow("APPLICATION_COMMAND_HANDLER_UNAVAILABLE");
  });

  it("routes semantic picking and mounted-surface commands through the bus", async () => {
    const calls: string[] = [];
    const removers = [
      spectraBus.handle("reference.beginPicking", () => { calls.push("reference"); }),
      spectraBus.handle("work.revealAnchor", () => { calls.push("reveal"); }),
      spectraBus.handle("run.openConversation", () => { calls.push("run"); }),
      spectraBus.handle("settings.clearLocalComputeCache", () => { calls.push("cache"); }),
    ];
    try {
      const dispatch = createApplicationCommandDispatcher({
        openArtifact: vi.fn(),
        navigate: vi.fn(),
        replacePreferences: vi.fn(),
        preferences: DEFAULT_SPECTRA_PREFERENCES,
      });
      await dispatch("app.reference.begin-picking", { hostWorkId: "work-1" });
      await dispatch("app.work.reveal-anchor", { anchor: { workId: "work-1" } });
      await dispatch("app.run.open-conversation", { runId: "run-1" });
      await dispatch("app.settings.clear-compute-cache", {});
      expect(calls).toEqual(["reference", "reveal", "run", "cache"]);
    } finally {
      for (const remove of removers) remove();
    }
  });

  it("routes settings, sync, memory, sharing and ManageBac through typed bus commands", async () => {
    const calls: string[] = [];
    const removers = [
      spectraBus.handle("settings.change", () => { calls.push("settings"); }),
      spectraBus.handle("sync.policy.change", () => { calls.push("sync"); }),
      spectraBus.handle("memory.write", () => { calls.push("memory"); }),
      spectraBus.handle("sharing.change", () => { calls.push("sharing"); }),
      spectraBus.handle("managebac.sync", () => { calls.push("managebac"); }),
      spectraBus.handle("managebac.selectClasses", () => { calls.push("managebac-selection"); }),
    ];
    try {
      const dispatch = createApplicationCommandDispatcher({
        openArtifact: vi.fn(),
        navigate: vi.fn(),
        replacePreferences: vi.fn(),
        preferences: DEFAULT_SPECTRA_PREFERENCES,
      });
      await dispatch("app.settings.change", { patch: { workbar: { document: { groupOrder: { General: ["Font", "Paragraph"] } } } } });
      await dispatch("app.sync.policy.change", { targetIds: ["work-1"], patch: { preset: "both" } });
      await dispatch("app.memory.write", { action: "create", content: "Prefer concise answers" });
      await dispatch("app.sharing.change", { resourceType: "artifact", resourceId: "work-1", action: "revoke", grantId: "grant-1" });
      await dispatch("app.managebac.sync", { purpose: "classes" });
      await dispatch("app.managebac.select-classes", {
        recordIds: ["class-101"],
        expectedRevision: 2,
        retention: "keep_in_spectra",
      });
      expect(calls).toEqual(["settings", "sync", "memory", "sharing", "managebac", "managebac-selection"]);
    } finally {
      for (const remove of removers) remove();
    }
  });

  it("returns the mounted handler result instead of treating listener count as completion", async () => {
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate: vi.fn(),
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });
    const remove = spectraBus.handle("managebac.selectClasses", () => ({
      status: "completed" as const,
      message: "Classes selected with revision 4.",
      data: { revision: 4 },
    }));
    try {
      await expect(dispatch("app.managebac.select-classes", {
        recordIds: ["class-1"],
      })).resolves.toMatchObject({
        status: "completed",
        message: "Classes selected with revision 4.",
        data: { revision: 4 },
      });
    } finally {
      remove();
    }
  });

  it("uses the canonical comment mutation when no editor is mounted", async () => {
    const addComment = vi.fn().mockResolvedValue(undefined);
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate: vi.fn(),
      addComment,
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });

    await expect(dispatch("app.comments.add", {
      artifactId: "artifact-1",
      body: "A durable comment",
    })).resolves.toMatchObject({
      status: "completed",
      data: { artifactId: "artifact-1" },
    });
    expect(addComment).toHaveBeenCalledWith({
      artifactId: "artifact-1",
      body: "A durable comment",
    });
  });

  it("opens Devices, asks the page to connect this computer, and runs local actions", async () => {
    const openRoute = vi.fn();
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate: vi.fn(),
      openRoute,
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });
    devicePairing().takeWanted();

    await expect(dispatch("app.devices.open", {})).resolves.toMatchObject({ status: "completed" });
    await dispatch("app.navigate", { destination: "devices" });
    expect(openRoute).toHaveBeenCalledWith("/devices");
    expect(openRoute).toHaveBeenCalledTimes(2);

    await expect(dispatch("app.devices.pair", {})).resolves.toMatchObject({ status: "pending" });
    expect(devicePairing().takeWanted()).toBe(true);
    expect(devicePairing().takeWanted()).toBe(false);

    await expect(dispatch("app.devices.add-folder", {})).resolves.toMatchObject({ status: "completed", message: "ran add_folder" });
    await dispatch("app.devices.pause", { paused: true });
    await dispatch("app.devices.pause", { paused: false });
    expect(runLocalDeviceAction.mock.calls.map(([request]) => request.action)).toEqual([
      "add_folder",
      "pause_syncing",
      "resume_syncing",
    ]);
  });
});
