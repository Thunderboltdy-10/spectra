import { describe, expect, it } from "vitest";
import {
  PREFERENCE_SAVE_FAILURE,
  PREFERENCE_SAVING,
  preferenceSaveStatus,
} from "../settings/preference-save-status";

describe("preference save status", () => {
  it("shows bounded waiting while a remote settings write is in flight", () => {
    expect(
      preferenceSaveStatus({ saving: true, saveError: null }),
    ).toBe(PREFERENCE_SAVING);
  });

  it("surfaces the retry copy after a failed write, not a settled toggle", () => {
    expect(
      preferenceSaveStatus({
        saving: false,
        saveError: PREFERENCE_SAVE_FAILURE,
      }),
    ).toBe(PREFERENCE_SAVE_FAILURE);
  });

  it("keeps the failure copy even if a later write is still in flight", () => {
    expect(
      preferenceSaveStatus({
        saving: true,
        saveError: PREFERENCE_SAVE_FAILURE,
      }),
    ).toBe(PREFERENCE_SAVE_FAILURE);
  });

  it("is silent when nothing is pending", () => {
    expect(preferenceSaveStatus({ saving: false, saveError: null })).toBeNull();
  });
});
