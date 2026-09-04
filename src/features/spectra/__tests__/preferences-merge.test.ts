import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { knownCapabilityIds } from "../capabilities/catalog";
import { swapWorkbarCommandOrders } from "../commands/registry";
import {
  DEFAULT_SPECTRA_PREFERENCES,
  applyPreferencePatch,
  mergePreferenceValues,
  pruneWorkbarCommandOverrides,
  remotePreferenceLayersAreReady,
  resolvePreferences,
  restoreDefaultPreferences,
  updatePreference,
} from "../settings/schema";

const known = knownCapabilityIds();

describe("preference merge (P3.I4)", () => {
  it("uses one deep merge so a partial workbar patch cannot wipe sibling pins", () => {
    const current = applyPreferencePatch(DEFAULT_SPECTRA_PREFERENCES, {
      workbar: {
        document: {
          expanded: true,
          commands: {
            "document.format.bold": { pinned: true },
            "document.format.italic": { hidden: true },
          },
        },
        sheets: {
          commands: { "sheets.format.bold": { pinned: true } },
        },
      },
    });
    const next = applyPreferencePatch(current, {
      workbar: {
        document: {
          commands: { "document.format.bold": { order: 2 } },
        },
      },
    });
    expect(next.workbar.document?.expanded).toBe(true);
    expect(next.workbar.document?.commands?.["document.format.bold"]).toMatchObject({
      pinned: true,
      order: 2,
    });
    expect(next.workbar.document?.commands?.["document.format.italic"]).toEqual({ hidden: true });
    expect(next.workbar.sheets?.commands?.["sheets.format.bold"]).toEqual({ pinned: true });
  });

  it("lets an empty work-type object reset that type without touching others", () => {
    const current = applyPreferencePatch(DEFAULT_SPECTRA_PREFERENCES, {
      workbar: {
        document: { commands: { "document.format.bold": { pinned: true } } },
        sheets: { commands: { "sheets.format.bold": { pinned: true } } },
      },
    });
    const next = updatePreference(current, "workbar", { document: {} });
    expect(next.workbar.document).toEqual({});
    expect(next.workbar.sheets?.commands?.["sheets.format.bold"]).toEqual({ pinned: true });
  });

  it("resolves layers with the same algorithm as dispatcher patches", () => {
    const resolved = resolvePreferences([
      {
        scope: "account",
        values: {
          appearance: { density: "compact", theme: "dark" },
          workbar: {
            document: { commands: { "document.format.bold": { pinned: true } } },
          },
        },
      },
      {
        scope: "device",
        values: {
          appearance: { density: "comfortable" },
          workbar: {
            document: { commands: { "document.format.italic": { hidden: true } } },
          },
        },
      },
    ]);
    expect(resolved.appearance.density).toBe("comfortable");
    expect(resolved.appearance.theme).toBe("dark");
    expect(resolved.workbar.document?.commands?.["document.format.bold"]).toEqual({ pinned: true });
    expect(resolved.workbar.document?.commands?.["document.format.italic"]).toEqual({ hidden: true });
  });

  it("keeps class shelf choice on the integrations preference layer", () => {
    expect(DEFAULT_SPECTRA_PREFERENCES.integrations.classShelvesStatus).toBe(
      "pending",
    );
    const next = applyPreferencePatch(DEFAULT_SPECTRA_PREFERENCES, {
      integrations: {
        classShelvesStatus: "skipped",
        classShelfRecordIds: [],
      },
    });
    expect(next.integrations.classShelvesStatus).toBe("skipped");
    expect(next.integrations.schoolDataEnabled).toBe(true);
  });

  it("keeps class shelf choice when restoring Settings defaults", () => {
    const current = applyPreferencePatch(DEFAULT_SPECTRA_PREFERENCES, {
      appearance: { theme: "dark", reducedMotion: true },
      ai: { continueCurrentConversation: false },
      integrations: {
        classShelvesStatus: "chosen",
        classShelfRecordIds: ["class-econ", "class-tok"],
      },
    });
    const next = restoreDefaultPreferences(current);
    expect(next.appearance.theme).toBe("system");
    expect(next.appearance.reducedMotion).toBe(false);
    expect(next.ai.continueCurrentConversation).toBe(true);
    expect(next.integrations.classShelvesStatus).toBe("chosen");
    expect(next.integrations.classShelfRecordIds).toEqual([
      "class-econ",
      "class-tok",
    ]);
  });

  it("prunes zombie command ids against the IR", () => {
    const pruned = pruneWorkbarCommandOverrides(
      {
        document: {
          commands: {
            "document.format.bold": { pinned: true },
            "document.format.ghostFromNova": { label: "Dead", pinned: true },
          },
        },
      },
      known,
    );
    expect(pruned.document?.commands).toEqual({
      "document.format.bold": { pinned: true },
    });
    const resolved = resolvePreferences(
      [
        {
          scope: "account",
          values: {
            workbar: {
              document: {
                commands: {
                  "document.format.bold": { pinned: true },
                  "document.format.ghostFromNova": { pinned: true },
                },
              },
            },
          },
        },
      ],
      { knownCommandIds: known },
    );
    expect(resolved.workbar.document?.commands).toEqual({
      "document.format.bold": { pinned: true },
    });
  });

  it("clears a command override with an empty object rather than leaving the old pin", () => {
    const current = applyPreferencePatch(DEFAULT_SPECTRA_PREFERENCES, {
      workbar: {
        document: {
          commands: {
            "document.format.bold": { pinned: true },
            "document.format.italic": { hidden: true },
          },
        },
      },
    });
    const next = applyPreferencePatch(
      current,
      {
        workbar: {
          document: {
            commands: { "document.format.bold": {} },
          },
        },
      },
      { knownCommandIds: known },
    );
    expect(next.workbar.document?.commands).toEqual({
      "document.format.italic": { hidden: true },
    });
  });

  it("does not treat an empty subscription as remote truth", () => {
    expect(remotePreferenceLayersAreReady(undefined)).toBe(false);
    expect(remotePreferenceLayersAreReady([])).toBe(false);
    expect(remotePreferenceLayersAreReady([{ scope: "account", values: {} }])).toBe(true);
  });

  it("keeps Convex one-level sibling keys when merging nested objects", () => {
    const stored = mergePreferenceValues(
      {
        ai: { showLiveDockProgress: true, retainCompletedRunTabs: true },
        workbar: {
          document: {
            commands: { "document.format.bold": { pinned: true } },
          },
        },
      },
      {
        ai: { showLiveDockProgress: false },
        workbar: {
          document: {
            commands: { "document.format.italic": { hidden: true } },
          },
        },
      },
    );
    expect(stored).toMatchObject({
      ai: { showLiveDockProgress: false, retainCompletedRunTabs: true },
      workbar: {
        document: {
          commands: {
            "document.format.bold": { pinned: true },
            "document.format.italic": { hidden: true },
          },
        },
      },
    });
  });

  it("swaps two command orders in one layout write", () => {
    const next = swapWorkbarCommandOrders(
      {
        commands: {
          "document.format.bold": { order: 1 },
          "document.format.italic": { order: 4 },
        },
      },
      {
        sourceId: "document.format.bold",
        targetId: "document.format.italic",
        sourceOrder: 1,
        targetOrder: 4,
        tab: "Format",
      },
    );
    expect(next.commands?.["document.format.bold"]).toEqual({ order: 4, tab: "Format" });
    expect(next.commands?.["document.format.italic"]).toEqual({ order: 1 });
  });

  it("parks preference-layer subscriptions after the first snapshot", () => {
    const idle = readFileSync(
      path.join(process.cwd(), "src/features/spectra/data/idle-surface.ts"),
      "utf8",
    );
    const store = readFileSync(
      path.join(process.cwd(), "src/features/spectra/settings/preference-store.ts"),
      "utf8",
    );
    expect(idle).toContain("export const IDLE_SURFACE_REFRESH_MS = 180_000");
    expect(idle).toContain("document.visibilityState !== \"visible\"");
    expect(store).toContain("subscribeIdleSurfaceRefresh");
    expect(store).toContain("unsub?.()");
    expect(store).toContain("refreshLayersRef.current()");
  });
});
