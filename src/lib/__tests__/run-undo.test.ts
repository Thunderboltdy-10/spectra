import { describe, expect, it } from "vitest";
import { commandCanBeReversed, commandHasNothingToUndo, runUndoSummary } from "../../../shared/run-undo";

describe("undoing a whole AI run", () => {
  it("names every kind of lasting change it reversed", () => {
    expect(runUndoSummary({ works: 2, restored: 1, events: 3, settings: 1 })).toBe(
      "Undone: moved 2 new works to the Trash, restored 1 work, put 3 calendar changes back and put 1 setting back.",
    );
  });

  it("says so when nothing was left", () => {
    expect(runUndoSummary({})).toBe("There was nothing left to undo.");
  });

  it("arms on lasting changes, not on opening a work", () => {
    expect(commandCanBeReversed("create_calendar_personal_event")).toBe(true);
    expect(commandCanBeReversed("change_spectra_settings")).toBe(true);
    expect(commandCanBeReversed("show_work")).toBe(false);
    expect(commandHasNothingToUndo("show_work")).toBe(true);
    expect(commandCanBeReversed(undefined)).toBe(false);
  });
});
