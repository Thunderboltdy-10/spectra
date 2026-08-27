import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SPECTRA_PREFERENCES } from "../settings/schema";
import { createApplicationCommandDispatcher } from "../commands/application-dispatcher";
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
      expect(calls).toEqual(["settings", "sync", "memory", "sharing", "managebac"]);
    } finally {
      for (const remove of removers) remove();
    }
  });
});
