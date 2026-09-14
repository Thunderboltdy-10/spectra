import { describe, expect, it } from "vitest";
import { parseModelOperation } from "../operations/schema";
import { normalizeAiPreferencePatch } from "../settings/schema/preferences";

describe("AI settings intent normalization", () => {
  it("maps common natural aliases onto persisted preference sections", () => {
    expect(
      normalizeAiPreferencePatch({
        interfaceDensity: "compact",
        globalBarOrder: "commands_first",
      }),
    ).toEqual({
      appearance: { density: "compact" },
      general: { globalCommandBehaviour: "commands_first" },
    });
  });

  it("does not invent a persisted command-bar position", () => {
    expect(
      normalizeAiPreferencePatch({
        commandBar: { pinned: true, position: "top" },
        interfaceDensity: "compact",
      }),
    ).toEqual({ appearance: { density: "compact" } });
  });

  it("normalizes aliases in model-emitted application operations", () => {
    const operation = parseModelOperation({
      type: "app.command",
      input: {
        command: "change_spectra_settings",
        args: {
          patch: {
            interfaceDensity: "compact",
            commandActionsPosition: "before_search",
          },
        },
      },
    });

    expect(operation).toEqual({
      type: "app.command",
      input: {
        command: "change_spectra_settings",
        args: {
          patch: {
            appearance: { density: "compact" },
            general: { globalCommandBehaviour: "commands_first" },
          },
        },
      },
    });
  });

  it("understands a toolbar-order paraphrase without persisting invented keys", () => {
    expect(
      normalizeAiPreferencePatch({
        toolbarLayout: { commandActionsBeforeSearch: true },
      }),
    ).toEqual({
      general: { globalCommandBehaviour: "commands_first" },
    });
  });
});
