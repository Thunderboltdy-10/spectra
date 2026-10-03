import { describe, expect, it } from "vitest";
import {
  permissionDecision,
  permissionSummary,
  readPermissionPrefs,
} from "../permissions";
import { patchTouchesAiPermissions } from "@/features/spectra/settings/schema/ai-permissions";
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
    expect(patchTouchesAiPermissions({ ai: { researchDepth: "deep" } })).toBe(false);
    expect(patchTouchesAiPermissions({ appearance: { theme: "dark" } })).toBe(false);
  });
});
