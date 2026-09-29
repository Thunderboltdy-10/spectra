import { describe, expect, it } from "vitest";
import { COMMAND_TABS, commandForBinding, tabsFor } from "../commands/registry";
import type { WorkType } from "../work/registry";

// A command whose name says "new", "add" or "insert" goes on the Insert tab —
// but only for a type that has one. Code, quiz, flashcards, plan, agent and
// timetable have no Insert tab, so such a command landed on a tab that is
// never shown and could not be reached from the workbar at all.

const typesWithoutInsert = (Object.keys(COMMAND_TABS) as WorkType[]).filter(
  (type) => !COMMAND_TABS[type].includes("Insert"),
);

describe("workbar tab inference", () => {
  it.each(typesWithoutInsert)("puts a %s add/new/insert command on a tab the bar shows", (type) => {
    for (const label of ["New file", "Add question", "Insert image", "Add table", "New chart"]) {
      const command = commandForBinding(type, { id: label.toLowerCase().replace(" ", "-"), label, onSelect: () => {} }, 0);
      expect(tabsFor(type)).toContain(command.defaultPlacement.tab);
    }
  });

  it("still puts them on Insert where the type has one", () => {
    const command = commandForBinding("presentation", { id: "add-image", label: "Add image", onSelect: () => {} }, 0);
    expect(command.defaultPlacement.tab).toBe("Insert");
  });
});
