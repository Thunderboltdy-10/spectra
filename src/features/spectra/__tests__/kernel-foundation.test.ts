import { describe, expect, it, vi } from "vitest";
import { WORK_TYPE_KEYS } from "@/features/spectra/artifacts/types";
import {
  capabilityData,
  capabilityIsActionable,
} from "@/features/spectra/core/capability-truth";
import { TypedSpectraBus } from "@/features/spectra/events/bus";
import {
  DEFAULT_SPECTRA_PREFERENCES,
  migratePreferences,
  resolvePreferences,
} from "@/features/spectra/settings/schema";
import { listWorkDefinitions } from "@/features/spectra/work/registry";
import {
  editingRemainsAvailable,
  projectLegacyWorkSession,
} from "@/features/spectra/work/session/session-controller";
import {
  inspectorController,
  responsiveSurfaceController,
  saveProjectionController,
} from "@/features/spectra/work/session/controllers";
import { getWorkDefinition } from "@/features/spectra/work/registry";

describe("architectural kernel foundation", () => {
  it("registers every current work type with required contracts", () => {
    const definitions = listWorkDefinitions();
    expect(definitions.map((definition) => definition.key)).toEqual(
      WORK_TYPE_KEYS,
    );
    for (const definition of definitions) {
      expect(definition.userFacingName).not.toMatch(/artifact/i);
      expect(definition.modes.length).toBeGreaterThan(0);
      expect(definition.surfaces.full).toBeTruthy();
      expect(definition.surfaces.panel).toBeTruthy();
      expect(definition.surfaces.read_only).toBeTruthy();
      expect(definition.references.collapsed).toBeTruthy();
      expect(definition.references.expanded).toBeTruthy();
      expect(definition.responsive.minInlineSize).toBeGreaterThanOrEqual(320);
      expect(definition.responsive.preferredInlineSize).toBeGreaterThan(
        definition.responsive.minInlineSize,
      );
    }
  });

  it("separates commands, events, and query state", () => {
    type Commands = { open: { id: string } };
    type Events = { opened: { id: string } };
    type Queries = { active: { id: string | null } };
    const bus = new TypedSpectraBus<Commands, Events, Queries>();
    const command = vi.fn();
    const event = vi.fn();
    const query = vi.fn();
    bus.handle("open", command);
    bus.on("opened", event);
    bus.subscribe("active", query);
    bus.command("open", { id: "work-1" });
    bus.emit("opened", { id: "work-1" });
    bus.setQuery("active", { id: "work-1" });
    expect(command).toHaveBeenCalledWith({ id: "work-1" });
    expect(event).toHaveBeenCalledWith({ id: "work-1" });
    expect(query).toHaveBeenCalledWith({ id: "work-1" });
    expect(bus.getQuery("active")).toEqual({ id: "work-1" });
  });

  it("resolves capability truth without turning failure into empty data", () => {
    expect(capabilityData({ kind: "partial", data: [1], details: "One class failed" })).toEqual([1]);
    expect(capabilityIsActionable({ kind: "permission_denied" })).toBe(false);
    expect(capabilityIsActionable({ kind: "stale", data: [], updatedAt: 1 })).toBe(true);
  });

  it("migrates preferences and applies device overrides last", () => {
    expect(migratePreferences({ theme: "dark", continueThread: false })).toMatchObject({
      appearance: { theme: "dark" },
      ai: { continueCurrentConversation: false },
    });
    expect(
      resolvePreferences([
        { scope: "account", values: { appearance: { density: "compact" } } },
        { scope: "device", values: { appearance: { density: "comfortable" } } },
      ]).appearance.density,
    ).toBe("comfortable");
    expect(DEFAULT_SPECTRA_PREFERENCES.ai.openConversationAfterSend).toBe(false);
  });

  it("projects legacy studio state through the Work session controller", () => {
    const works = new Map([
      ["a", { _id: "a", title: "A" }],
      ["b", { _id: "b", title: "B" }],
    ]);
    const session = projectLegacyWorkSession(
      works,
      [
        { type: "artifact", id: "a", label: "A", presentation: "tab" },
        { type: "thread", id: "t", label: "T", presentation: "thread-panel" },
      ],
      "artifact:a",
      ["a", "missing"],
    );
    expect(session.activeWork?._id).toBe("a");
    expect(session.tabs).toEqual([{ workId: "a", openedAt: 0 }]);
    expect([...session.dirtyIds]).toEqual(["a"]);
    expect(
      editingRemainsAvailable({
        local: "pending",
        live: "offline",
        durable: "delayed",
      }),
    ).toBe(true);
  });

  it("keeps save, inspector, and responsive state under domain controllers", () => {
    expect(
      saveProjectionController({
        localPending: 2,
        connected: false,
        synchronized: false,
        projectionPending: true,
        projectionDelayed: true,
      }),
    ).toEqual({ local: "pending", live: "offline", durable: "delayed" });
    expect(
      inspectorController(
        { open: false, tab: "overview", width: 360 },
        { type: "select_comment", commentId: "comment-1" },
      ),
    ).toMatchObject({ open: true, tab: "comments", selectedCommentId: "comment-1" });
    expect(
      responsiveSurfaceController(getWorkDefinition("sheets"), 400),
    ).toEqual({ kind: "tab_fallback" });
  });
});
