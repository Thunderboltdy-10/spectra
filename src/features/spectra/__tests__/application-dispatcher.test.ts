import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SPECTRA_PREFERENCES } from "../settings/schema";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
import {
  __resetBridgeIntents,
  pendingBridgeIntent,
  takePendingBridgeIntent,
} from "../commands/bridge-intents";
import { spectraBus } from "../events";

describe("application command dispatcher", () => {
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
      patch: { workbar: { document: { expanded: true } } },
      section: "workbar",
    });

    expect(replacePreferences).toHaveBeenCalledWith(expect.objectContaining({
      workbar: { document: { expanded: true } },
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
      spectraBus.handle("context.beginPicking", () => { calls.push("context"); }),
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
      await dispatch("app.context.begin-picking", { source: "composer" });
      await dispatch("app.reference.begin-picking", { hostWorkId: "work-1" });
      await dispatch("app.work.reveal-anchor", { anchor: { workId: "work-1" } });
      await dispatch("app.run.open-conversation", { runId: "run-1" });
      await dispatch("app.settings.clear-compute-cache", {});
      expect(calls).toEqual(["context", "reference", "reveal", "run", "cache"]);
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
      await dispatch("app.settings.change", { patch: { workbar: { document: { expanded: true } } } });
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

  it("retains an off-page Bridge retry and lets the mounted surface consume it once", async () => {
    __resetBridgeIntents();
    const navigate = vi.fn().mockResolvedValue({
      actionId: "settings-1",
      targetId: "devices",
      view: "settings" as const,
      routeGeneration: 1,
      status: "ready" as const,
    });
    const dispatch = createApplicationCommandDispatcher({
      openArtifact: vi.fn(),
      navigate,
      replacePreferences: vi.fn(),
      preferences: DEFAULT_SPECTRA_PREFERENCES,
    });
    try {
      await expect(dispatch("app.bridge.setup", {
        action: "retry-folder",
        grantId: "grant-7",
        actionId: "bridge-action-7",
      })).resolves.toMatchObject({
        status: "pending",
        data: { actionId: "bridge-action-7", handoff: true },
      });
      expect(navigate).toHaveBeenCalledWith("settings", "devices");
      expect(pendingBridgeIntent()).toMatchObject({
        actionId: "bridge-action-7",
        kind: "setup",
        input: { action: "retry-folder", grantId: "grant-7" },
      });

      const intent = takePendingBridgeIntent();
      expect(intent).toMatchObject({ actionId: "bridge-action-7" });
      expect(takePendingBridgeIntent()).toBeNull();
      if (!intent || intent.kind !== "setup") throw new Error("Expected a setup handoff.");
      const calls: string[] = [];
      const remove = spectraBus.handle("bridge.setup", (input) => {
        calls.push(`${input.action}:${input.grantId}`);
        return { status: "completed" as const, message: "Folder retry completed." };
      });
      try {
        await spectraBus.commandAsync("bridge.setup", intent!.input);
      } finally {
        remove();
      }
      expect(calls).toEqual(["retry-folder:grant-7"]);
    } finally {
      __resetBridgeIntents();
    }
  });
});
