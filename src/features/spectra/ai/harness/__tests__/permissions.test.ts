import { describe, expect, it } from "vitest";
import {
  permissionDecision,
  permissionSummary,
  readPermissionPrefs,
} from "../permissions";
import {
  PERMISSION_CATEGORIES,
  fullControlPatch,
  patchTouchesAiPermissions,
  permissionChoice,
  permissionChoicePatch,
} from "@/features/spectra/settings/schema/ai-permissions";
import { preferenceLayerValuesSchema } from "@/features/spectra/settings/schema/preferences";

describe("permission policy", () => {
  const none = readPermissionPrefs(undefined);

  it("runs reads and writes without asking", () => {
    expect(permissionDecision("read", undefined, none)).toBe("allow");
    expect(permissionDecision("write", undefined, none)).toBe("allow");
  });

  it("asks for irreversible and settings effects by default", () => {
    expect(permissionDecision("irreversible", "permanent_delete", none)).toBe("ask");
    expect(permissionDecision("settings", "settings", none)).toBe("ask");
    expect(permissionDecision("settings", undefined, none)).toBe("ask");
  });

  it("honours Always allow per category", () => {
    const prefs = readPermissionPrefs({ permissionAllow: ["settings", "nonsense"] });
    expect(prefs.allow).toEqual(["settings"]);
    expect(permissionDecision("settings", "settings", prefs)).toBe("allow");
    expect(permissionDecision("settings", "sharing", prefs)).toBe("ask");
    expect(permissionDecision("irreversible", "permanent_delete", prefs)).toBe("ask");
  });

  it("honours full control for every category", () => {
    const prefs = readPermissionPrefs({ permissionFullControl: true });
    expect(permissionDecision("irreversible", "permanent_delete", prefs)).toBe("allow");
    expect(permissionDecision("settings", undefined, prefs)).toBe("allow");
    expect(permissionSummary(prefs)).toContain("full control");
  });

  it("summarises the choices in one plain line", () => {
    expect(permissionSummary(none)).toBe(
      "Changes that cannot be undone and settings changes ask the user first.",
    );
    expect(permissionSummary(readPermissionPrefs({ permissionAllow: ["sharing"] }))).toContain(
      "sharing changes",
    );
  });

  it("stores the choices in the existing preference layer", () => {
    const parsed = preferenceLayerValuesSchema.parse({
      ai: { permissionFullControl: true, permissionAllow: ["managebac"] },
    });
    expect(parsed.ai).toMatchObject({ permissionFullControl: true, permissionAllow: ["managebac"] });
  });

  it("recognises a patch that would change the AI's own permissions", () => {
    expect(patchTouchesAiPermissions({ ai: { permissionFullControl: true } })).toBe(true);
    expect(patchTouchesAiPermissions({ permissionAllow: ["settings"] })).toBe(true);
    expect(patchTouchesAiPermissions({ ai: { permissionDeny: [] } })).toBe(true);
    expect(patchTouchesAiPermissions({ ai: { permissionAllow: ["settings"] } })).toBe(true);
    expect(patchTouchesAiPermissions({ ai: { researchDepth: "deep" } })).toBe(false);
    expect(patchTouchesAiPermissions({ appearance: { theme: "dark" } })).toBe(false);
  });

  it("refuses a category set to Never, even under full control", () => {
    const prefs = readPermissionPrefs({ permissionFullControl: true, permissionAllow: ["sharing"], permissionDeny: ["sharing", "nonsense"] });
    expect(prefs.deny).toEqual(["sharing"]);
    expect(prefs.allow).toEqual([]);
    expect(permissionDecision("settings", "sharing", prefs)).toBe("deny");
    expect(permissionDecision("irreversible", "permanent_delete", prefs)).toBe("allow");
    // Never applies to effects that would ask; reads and writes still run.
    expect(permissionDecision("write", "sharing", prefs)).toBe("allow");
    expect(permissionSummary(prefs)).toMatch(/Never allowed[^.]*sharing changes/);
  });
});

describe("permission settings choices", () => {
  const base = { permissionFullControl: false, permissionAllow: [], permissionDeny: [] };
  const stored = (patch = {}) => ({ ...base, ...patch }) as Parameters<typeof permissionChoice>[0];

  it("shows Ask, Always allow or Never per category", () => {
    expect(permissionChoice(stored(), "sharing")).toBe("ask");
    expect(permissionChoice(stored({ permissionAllow: ["sharing"] }), "sharing")).toBe("allow");
    expect(permissionChoice(stored({ permissionFullControl: true }), "sharing")).toBe("allow");
    expect(permissionChoice(stored({ permissionFullControl: true, permissionDeny: ["sharing"] }), "sharing")).toBe("never");
  });

  it("moves one category between Ask, Always allow and Never", () => {
    const allowed = permissionChoicePatch(stored(), "sharing", "allow");
    expect(allowed).toEqual({ permissionFullControl: false, permissionAllow: ["sharing"], permissionDeny: [] });
    const never = permissionChoicePatch(allowed, "sharing", "never");
    expect(never).toEqual({ permissionFullControl: false, permissionAllow: [], permissionDeny: ["sharing"] });
    expect(permissionChoicePatch(never, "sharing", "ask")).toEqual(base);
  });

  it("keeps full control equal to every category allowed", () => {
    expect(fullControlPatch(true)).toEqual({ permissionFullControl: true, permissionAllow: [...PERMISSION_CATEGORIES], permissionDeny: [] });
    expect(fullControlPatch(false)).toEqual(base);
    const lowered = permissionChoicePatch(fullControlPatch(true), "managebac", "ask");
    expect(lowered.permissionFullControl).toBe(false);
    expect(lowered.permissionAllow).toEqual(PERMISSION_CATEGORIES.filter((category) => category !== "managebac"));
    let all = stored();
    for (const category of PERMISSION_CATEGORIES) all = permissionChoicePatch(all, category, "allow");
    expect(all.permissionFullControl).toBe(true);
  });
});
