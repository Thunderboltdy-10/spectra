import { describe, expect, it } from "vitest";
import { settingsToggleActionSchema, SMART_COMPLETION_TARGET, smartCompletionValue } from "../actions/protocol/semantic-action";

describe("S11 exact settings action contract", () => {
  it.each([true, false])("retains the exact boolean %s", (value) => {
    expect(smartCompletionValue({ writing: { smartCompletion: value } })).toBe(value);
  });

  it.each([
    null, [], {}, { writing: {} }, { writing: { smartCompletion: "false" } },
    { writing: { smartCompletion: false, quickChatSuggestions: true } },
    { writing: { smartCompletion: false }, appearance: { theme: "light" } },
  ])("does not misrepresent a different or compound patch as one toggle: %j", (patch) => {
    expect(smartCompletionValue(patch)).toBeUndefined();
  });

  it("requires the full attempt/operation/epoch/step identity and exact control", () => {
    const action = {
      runId: "run", executionId: "execution", operationId: "operation", operationDigest: "a".repeat(64),
      epoch: 1, sequence: 0, kind: "settings_toggle", target: SMART_COMPLETION_TARGET,
      checked: false, expiresAt: 10_000,
    };
    expect(settingsToggleActionSchema.parse(action)).toEqual(action);
    for (const patch of [
      { executionId: "" }, { operationDigest: "not-a-digest" }, { epoch: 0 },
      { sequence: 1 }, { target: "/settings" }, { checked: "false" }, { permit: "client-issued" },
    ]) expect(settingsToggleActionSchema.safeParse({ ...action, ...patch }).success).toBe(false);
  });
});
