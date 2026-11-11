import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/* A1: the order a run follows when the person's own runtime can't answer. */
describe("If it can't answer", () => {
  it("offers the other subscription only when it is ready, and always Spectra and Stop", async () => {
    const { runtimeThenOptions } = await import("../settings/ui/runtime-settings");
    expect(runtimeThenOptions("codex", true, ["spectra"]).map((option) => [option.value, option.label])).toEqual([
      ["claude,spectra", "Claude Code, then Spectra"],
      ["spectra", "Spectra"],
      ["claude", "Claude Code"],
      ["stop", "Stop"],
    ]);
    expect(runtimeThenOptions("claude", false, []).map((option) => option.value)).toEqual(["spectra", "stop"]);
  });

  it("shows Stop in the closed control once chosen (F16)", async () => {
    const { runtimeThenOptions, runtimeThenValue } = await import("../settings/ui/runtime-settings");
    const value = runtimeThenValue([]);
    expect(runtimeThenOptions("codex", true, []).find((option) => option.value === value)?.label).toBe("Stop");
  });

  it("keeps a saved choice visible after that runtime stops being ready", async () => {
    const { runtimeThenOptions } = await import("../settings/ui/runtime-settings");
    expect(runtimeThenOptions("codex", false, ["claude", "spectra"])[0]).toEqual({ value: "claude,spectra", label: "Claude Code, then Spectra" });
  });

  it("defaults to Spectra's model, as before, and keeps an emptied order empty", async () => {
    const { spectraPreferencesSchema } = await import("../settings/schema/preferences");
    const ai = spectraPreferencesSchema.shape.ai.parse(undefined);
    expect(ai.runtimeThen).toEqual(["spectra"]);
    expect(ai.thinking).toBe("medium");
    const { runtimeOrder } = await import("@/app/api/spectra/run/harness/environment");
    expect(runtimeOrder(undefined)).toEqual(["spectra"]);
    expect(runtimeOrder([])).toEqual([]);
    expect(runtimeOrder(["claude", "claude", "nonsense", "spectra"])).toEqual(["claude", "spectra"]);
  });
});

describe("Claude Code's models", () => {
  it("names them by the CLI's aliases, and moves a saved dated id onto its alias", async () => {
    const { claudeModelAlias } = await import("../ai/model-config");
    expect(claudeModelAlias("claude-fable-5-1")).toBe("fable");
    expect(claudeModelAlias("claude-haiku-5-5")).toBe("haiku");
    expect(claudeModelAlias("opus")).toBe("opus");
    expect(claudeModelAlias("")).toBe("");
  });
});
