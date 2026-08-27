// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { capabilityForLocalId } from "../capabilities";
import { DOCUMENT_NATIVE_REASONS } from "../capabilities/office-reasons";
import {
  commandContext,
  commandForBinding,
  dispatchFormatChrome,
  eventBelongsToFocusedStudio,
  executeCommand,
  findBindings,
} from "../commands";
import {
  gateAiArtifactMutation,
  gateOperation,
} from "../commands/office/operation-gate";

describe("P3.I3 dispatch and gate wiring", () => {
  it("refuses a no-delta native write even when the region reads NATIVE", () => {
    const human = capabilityForLocalId("document", "insert.link")!.availability(
      commandContext("document", () => true, "edit", undefined, {
        compatibilityProfile: "strict-native",
        fidelity: { hyperlinks: "NATIVE" },
      }),
    );
    expect(human.state).toBe("disabled");
    const reason =
      human.state === "disabled" ? human.reason : "";
    expect(reason).toBe(DOCUMENT_NATIVE_REASONS.hyperlink);

    const gate = gateOperation({
      type: "document",
      operation: "document.insert.link",
      compatibilityProfile: "strict-native",
      fidelity: { hyperlinks: "NATIVE" },
    });
    expect(gate).toEqual({ allowed: false, reason });
  });

  it("gates a whole-content AI write through the implied rewrite", () => {
    const gate = gateAiArtifactMutation({
      type: "sheets",
      compatibilityProfile: "strict-native",
      fidelity: { cells: "PRESERVED" },
    });
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.reason).toContain("cannot edit it yet");
  });

  it("wires replace-all through the shared navigate.replace param", () => {
    const replaceAll = vi.fn();
    const bindings = findBindings({
      toggle: vi.fn(),
      toggleReplace: vi.fn(),
      replaceAll,
    });
    const replace = commandForBinding("document", bindings[1]!, 1);
    executeCommand(
      replace,
      commandContext("document", () => true, "edit"),
      true,
    );
    expect(replaceAll).toHaveBeenCalledTimes(1);
  });

  it("resolves field format chrome to the IR local id, not a hyphenated ghost", () => {
    expect(capabilityForLocalId("quiz", "format.bold")?.id).toBe("quiz.format.bold");
    const run = vi.fn();
    expect(
      dispatchFormatChrome({
        type: "quiz",
        label: "Bold",
        run,
        can: () => true,
        role: "edit",
      }),
    ).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    const blocked = vi.fn();
    expect(
      dispatchFormatChrome({
        type: "quiz",
        label: "Bold",
        run: blocked,
        can: () => false,
        role: "read_only",
      }),
    ).toBe(false);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("lets only the focused studio handle a split-view shortcut", () => {
    document.body.innerHTML = `
      <div data-spectra-studio="a"></div>
      <div data-spectra-studio="b"><button id="inside-b">b</button></div>
    `;
    const insideB = document.getElementById("inside-b")!;
    insideB.focus();
    const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true });
    Object.defineProperty(event, "target", { value: insideB });

    expect(eventBelongsToFocusedStudio(event, "b")).toBe(true);
    expect(eventBelongsToFocusedStudio(event, "a")).toBe(false);

    document.body.innerHTML = "";
    expect(
      eventBelongsToFocusedStudio(
        new KeyboardEvent("keydown", { key: "b", ctrlKey: true }),
        "solo",
      ),
    ).toBe(true);
  });

  it("keeps applyAiArtifactMutation on the same gate", () => {
    const source = readFileSync(
      "src/features/spectra/ai/yjs-artifact-operation.ts",
      "utf8",
    );
    expect(source).toContain("gateAiArtifactMutation");
    expect(source).toContain("AI_OPERATION_REFUSED");
    expect(source).toContain("replacePendingCreate");
  });
});
