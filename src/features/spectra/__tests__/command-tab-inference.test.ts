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
  // The name patterns match at the start of a word. As substrings they read
  // "review" in "Preview", "row" in "Arrow", "add" in "Padding" and "order" in
  // "Border", and those commands landed on tabs that do not own them.
  it.each([
    ["quiz", "preview", "Preview", "General"],
    ["sheets", "preview", "Print preview", "General"],
    ["sheets", "arrow", "Arrow", "General"],
    ["document", "padding", "Cell padding", "General"],
    ["sheets", "address", "Cell address", "General"],
    ["presentation", "border", "Border", "General"],
  ] as const)("does not read a pattern inside a word (%s %s)", (type, id, label, tab) => {
    const command = commandForBinding(type, { id, label, onSelect: () => {} }, 0);
    expect(command.defaultPlacement.tab).toBe(tab);
  });

  it.each([
    ["presentation", "ungroup", "Ungroup", "Arrange"],
    ["presentation", "reorder", "Reorder", "Arrange"],
    ["sheets", "unfreeze", "Unfreeze", "Data"],
    ["agent", "rerun", "Rerun", "Evaluate"],
    ["sheets", "review-comments", "Review comments", "Review"],
    ["sheets", "sort-rows", "Sort rows", "Data"],
  ] as const)("still reads whole words and their un-/re- forms (%s %s)", (type, id, label, tab) => {
    const command = commandForBinding(type, { id, label, onSelect: () => {} }, 0);
    expect(command.defaultPlacement.tab).toBe(tab);
  });

  it("keeps an explicit tab over the name", () => {
    const command = commandForBinding("quiz", { id: "preview", label: "Preview as learner", tab: "Review", onSelect: () => {} }, 0);
    expect(command.defaultPlacement.tab).toBe("Review");
  });
});
