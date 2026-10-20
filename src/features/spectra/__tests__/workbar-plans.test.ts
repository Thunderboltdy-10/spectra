import { Circle } from "lucide-react";
import { describe, expect, it } from "vitest";
import { groupOrderOf, planGroupedLayout } from "@/components/ui/adaptive-groups";
import { capabilityForLocalId } from "../capabilities/catalog";
import {
  allTabsFor,
  commandContext,
  commandForBinding,
  resolveCommandLayout,
  type CommandBinding,
} from "../commands";
import { documentCommandBindings, documentStubHandlers } from "../commands/office/document-commands";
import { presentationCommandBindings, presentationStubHandlers } from "../commands/office/presentation-commands";
import { sheetsCommandBindings, sheetsStubHandlers } from "../commands/office/sheets-commands";
import { arrangeWorkbar, groupedItemsOf, rareSteps, type WorkbarAction } from "../components/workbar-arrange";
import {
  HISTORY_GROUP,
  HISTORY_IDS,
  WORKBAR_METRICS,
  WORKBAR_PLANS,
  estimateGroupMenuWidth,
  planStepsFor,
} from "../components/workbar-plans";
import type { WorkType } from "../work/registry";

/*
 * Every editor's collapse plan, proved at the widths the bar really gets
 * (EDITORS.md: the Side at its minimum and default, fullscreen with and
 * without the companion). A plan passes when, at each width, its own steps
 * make the tab fit without the engine's fallback, undo and redo stay inline,
 * and no command whose meaning is in its words loses them.
 */

const icon = Circle;
const button = (id: string, label: string, extra: Partial<CommandBinding> = {}): CommandBinding => ({
  id,
  label,
  icon,
  onSelect: () => {},
  ...extra,
});
const select = (id: string, label: string, extra: Partial<CommandBinding> = {}): CommandBinding => ({
  ...button(id, label, extra),
  control: { kind: "select", value: "week", options: [{ value: "week", label: "Week" }] },
});
const advanced = { priority: "advanced" as const };
const history = [button("undo", "Undo"), button("redo", "Redo")];

/** The small editors' bindings, as their studios declare them (see each studio). */
const SMALL_EDITORS: Partial<Record<WorkType, CommandBinding[]>> = {
  quiz: [
    ...history,
    button("preview", "Preview as learner", { tab: "Review" }),
    button("settings", "Quiz settings"),
    button("questions", "Hide questions"),
    button("add-question", "Add question", { keepLabel: true }),
    button("question-details", "Question details"),
    button("cohort", "Cohort responses"),
    button("attempts", "Your attempts"),
    button("import", "Import questions", advanced),
  ],
  flashcard_deck: [
    ...history,
    button("add-card", "Add card", { keepLabel: true }),
    button("rail", "Hide cards"),
    button("browse", "Read the deck"),
    button("progress", "Your progress"),
    button("import", "Import cards"),
    ...[
      ["add-section", "Add section"],
      ["template-concept", "Concept card"],
      ["template-language", "Vocabulary card"],
      ["template-formula", "Formula card"],
    ].map(([id, label]) => button(id!, label!, { tab: "Cards", priority: "secondary", keepLabel: true })),
    ...[
      ["export-csv", "CSV file"],
      ["export-tsv", "TSV file"],
      ["export-package", "Deck package"],
      ["print", "Print or PDF"],
    ].map(([id, label]) => button(id!, label!, { tab: "Export", priority: "secondary", keepLabel: true })),
  ],
  whiteboard: [
    ...history,
    button("zoom-out", "Zoom out"),
    button("zoom-in", "Zoom in"),
    button("fit", "Fit to content"),
    button("pages", "Hide pages"),
    button("present", "Present board", { ...advanced, keepLabel: true }),
  ],
  code: [
    button("controls", "Controls"),
    button("files", "Hide files"),
    button("find", "Find"),
    button("format", "Format"),
    button("settings", "Settings"),
    button("publish", "Publish update", { keepLabel: true }),
    ...[
      ["file-new", "New file"],
      ["file-rename", "Rename"],
      ["file-duplicate", "Duplicate"],
      ["file-entry", "Run this first"],
      ["file-delete", "Delete file"],
      ["import-files", "Import files"],
      ["import-folder", "Import a folder"],
      ["export-archive", "Download all"],
      ["download-file", "Download file"],
    ].map(([id, label]) => button(id!, label!, { tab: "Files", priority: "secondary" })),
    ...[
      ["export-html", "Web page"],
      ["export-svg", "SVG"],
      ["export-png", "PNG"],
      ["export-pdf", "PDF"],
      ["export-webm", "Video"],
    ].map(([id, label]) => button(id!, label!, { tab: "Export", priority: "secondary" })),
  ],
  planner_task: [
    ...history,
    button("find", "Find tasks"),
    button("filters", "Filters"),
    button("import", "Import tasks"),
    button("export-csv", "Export as a spreadsheet", advanced),
  ],
  timetable: [
    ...history,
    button("today", "Today", { general: true, keepLabel: true }),
    button("previous", "Previous range", { general: true }),
    button("next", "Next range", { general: true }),
    select("view", "Calendar view", { general: true }),
    button("calendars", "Calendars", { general: true }),
    button("add", "Add time", { general: true, keepLabel: true }),
    button("import", "Import calendar", { tab: "Schedule", ...advanced }),
  ],
};

const OFFICE: Partial<Record<WorkType, CommandBinding[]>> = {
  document: documentCommandBindings(documentStubHandlers()),
  presentation: presentationCommandBindings(presentationStubHandlers()),
  sheets: sheetsCommandBindings(sheetsStubHandlers()),
};

/** Room the bar's other parts take on the command rail: selector, modes, context, primary. */
const RESERVED: Partial<Record<WorkType, number>> = {
  document: 0,
  presentation: 200,
  sheets: 220,
  quiz: 340,
  flashcard_deck: 330,
  whiteboard: 300,
  code: 420,
  planner_task: 380,
  timetable: 150,
};

/** The editor widths that occur: Side minimum, Side default, fullscreen with and without the companion. */
const EDITOR_WIDTHS: Partial<Record<WorkType, number[]>> = {
  document: [360, 720, 1000, 1360],
  presentation: [480, 720, 1000, 1360],
  sheets: [520, 720, 1000, 1360],
  quiz: [360, 720, 1000, 1360],
  flashcard_deck: [340, 720, 1000, 1360],
  whiteboard: [460, 720, 1000, 1360],
  code: [480, 720, 1000, 1360],
  planner_task: [360, 720, 1000, 1360],
  timetable: [420, 720, 1000, 1360],
};

/** The bar's frame (padding, border, the rail's gap) and More. */
const FRAME = 40;
/** The least room the commands ever get: undo, redo, one dropdown and More, with their gaps. */
const FLOOR = 220;

function bindingsOf(type: WorkType) {
  return OFFICE[type] ?? SMALL_EDITORS[type] ?? [];
}

function placedActions(type: WorkType, bindings: readonly CommandBinding[]): WorkbarAction[] {
  const ctx = commandContext(type, () => true, "edit");
  return bindings
    .map((binding, index) => ({ binding, command: resolveCommandLayout(commandForBinding(type, binding, index)) }))
    .filter(({ command }) => command.availability(ctx).state !== "hidden")
    .map(({ binding, command }) => ({
      ...binding,
      id: command.id,
      group: command.defaultPlacement.group,
      placedTab: command.defaultPlacement.tab,
      sourceTab: command.sourceTab,
      contextualTab: command.contextualTab,
    }));
}

const PLANNED = Object.keys(EDITOR_WIDTHS) as WorkType[];

describe("workbar plans", () => {
  it("names only commands and tabs the editor really has", () => {
    for (const type of PLANNED) {
      const plan = WORKBAR_PLANS[type];
      const local = new Set(bindingsOf(type).map((binding) => binding.id));
      const known = (id: string) => local.has(id) || Boolean(capabilityForLocalId(type, id));
      const ids = [
        ...plan.symbols,
        ...plan.worded,
        ...Object.keys(plan.groups ?? {}),
        ...Object.values(plan.tabs).flatMap((steps) =>
          steps.flatMap((step) =>
            "hideLabel" in step ? [step.hideLabel] : "toMenu" in step ? [step.toMenu] : [],
          ),
        ),
      ].filter((id) => !id.startsWith("group:"));
      expect(ids.filter((id) => !known(id)), type).toEqual([]);
      expect(Object.keys(plan.tabs).filter((tab) => !allTabsFor(type).includes(tab)), type).toEqual([]);
    }
  });

  it("names only groups that exist on the tab", () => {
    for (const type of PLANNED) {
      const actions = placedActions(type, bindingsOf(type));
      for (const tab of allTabsFor(type)) {
        const arranged = arrangeWorkbar({ type, tab, actions });
        const groups = new Set(arranged.groups.map((group) => group.name));
        const named = (WORKBAR_PLANS[type].tabs[tab] ?? []).flatMap((step) =>
          "groupMenu" in step
            ? [step.groupMenu]
            : "toMenu" in step && step.toMenu.startsWith("group:")
              ? [step.toMenu.slice(6)]
              : "hideLabel" in step && step.hideLabel.startsWith("group:")
                ? [step.hideLabel.slice(6)]
                : [],
        );
        expect(named.filter((group) => !groups.has(group)), `${type} ${tab}`).toEqual([]);
      }
    }
  });

  it("fits every tab at every editor width by its own steps", () => {
    const failures: string[] = [];
    for (const type of PLANNED) {
      const actions = placedActions(type, bindingsOf(type));
      for (const tab of allTabsFor(type)) {
        const arranged = arrangeWorkbar({ type, tab, actions });
        const items = groupedItemsOf(arranged);
        if (!items.length) continue;
        const groupMenu = Object.fromEntries(groupOrderOf(items).map((group) => [group, estimateGroupMenuWidth(group)]));
        for (const width of EDITOR_WIDTHS[type]!) {
          const reserved = tab === "General" ? RESERVED[type] ?? 0 : 0;
          const available = Math.max(FLOOR, width - FRAME - reserved);
          const layout = planGroupedLayout({
            items,
            // As the bar plans it: rare commands give way before the authored steps.
            plan: [...rareSteps(arranged), ...planStepsFor(type, tab)],
            available,
            metrics: { ...WORKBAR_METRICS, groupMenu },
          });
          if (layout.fellBack) failures.push(`${type} ${tab} @${width} (${available}px)`);
          const worded = arranged.groups.flatMap((group) => group.actions).filter((action) => action.labelPolicy === "always");
          for (const action of worded) {
            if (layout.labelHidden.has(action.id)) failures.push(`${type} ${tab}: ${action.id} lost its words`);
          }
          for (const action of arranged.history) {
            if (layout.inMore.has(action.id)) failures.push(`${type} ${tab}: ${action.id} left the bar`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("shows every command inline when there is room", () => {
    const actions = placedActions("quiz", bindingsOf("quiz"));
    const arranged = arrangeWorkbar({ type: "quiz", tab: "General", actions });
    const layout = planGroupedLayout({
      items: groupedItemsOf(arranged),
      plan: planStepsFor("quiz", "General"),
      available: 2000,
      metrics: { ...WORKBAR_METRICS, groupMenu: {} },
    });
    expect(layout.labelHidden.size + layout.groupMenus.size + layout.inMore.size).toBe(0);
  });
});

describe("arranging a tab", () => {
  const type = "document" as const;
  const actions = placedActions(type, bindingsOf(type));

  it("leads every tab with undo and redo, icon only and pinned", () => {
    for (const tab of ["General", "Insert", "Format", "Table"]) {
      const arranged = arrangeWorkbar({ type, tab, actions });
      expect(arranged.history.map((action) => action.id)).toEqual(HISTORY_IDS.document.map((id) => `document.${id}`));
      const items = groupedItemsOf(arranged);
      expect(items.slice(0, 2).every((item) => item.pinned && item.group === HISTORY_GROUP && item.labelPolicy === "never")).toBe(true);
      expect(arranged.groups.flatMap((group) => group.actions).some((action) => action.history)).toBe(false);
    }
  });

  it("never labels a universal symbol and never shrinks a worded command", () => {
    const format = arrangeWorkbar({ type, tab: "Format", actions }).groups.flatMap((group) => group.actions);
    expect(format.find((action) => action.id === "document.format.bold")?.labelPolicy).toBe("never");
    const insert = arrangeWorkbar({ type, tab: "Insert", actions }).groups.flatMap((group) => group.actions);
    expect(insert.find((action) => action.id === "document.insert.citation")?.labelPolicy).toBe("always");
    expect(insert.find((action) => action.id === "document.insert.table")?.labelPolicy).toBe("whenRoom");
  });

  it("puts rare commands on the bar after the common ones, first to give way", () => {
    const insert = arrangeWorkbar({ type, tab: "Insert", actions });
    const names = insert.groups.map((group) => group.name);
    expect(names).toContain("Callouts");
    expect(names.indexOf("Callouts")).toBe(names.length - 1);
    expect(insert.groups.find((group) => group.name === "Callouts")?.actions.every((action) => action.rare)).toBe(true);
  });

  it("applies a person's group and command order, and the plan follows the ids", () => {
    const arranged = arrangeWorkbar({
      type,
      tab: "Insert",
      actions,
      layout: {
        groupOrder: { Insert: ["References", "Tables"] },
        commandOrder: { Insert: ["document.insert.footnote", "document.insert.citation"] },
      },
    });
    expect(arranged.groups.slice(0, 2).map((group) => group.name)).toEqual(["References", "Tables"]);
    // The person's order leads; the group's other commands follow in shipped order.
    expect(arranged.groups[0]!.actions.slice(0, 2).map((action) => action.id)).toEqual([
      "document.insert.footnote",
      "document.insert.citation",
    ]);
    const layout = planGroupedLayout({
      items: groupedItemsOf(arranged),
      plan: [...rareSteps(arranged), ...planStepsFor(type, "Insert")],
      available: 420,
      metrics: { ...WORKBAR_METRICS, groupMenu: {} },
    });
    expect(layout.groupMenus.has("References")).toBe(true);
    expect(layout.fellBack).toBe(false);
  });

  it("raises a contextual tab only for its own commands", () => {
    const table = arrangeWorkbar({ type, tab: "Table", actions });
    expect(table.groups.map((group) => group.name)).toEqual(["Rows", "Columns", "Cells", "Structure"]);
    expect(table.groups.flatMap((group) => group.actions).every((action) => action.id.startsWith("document.table."))).toBe(true);
  });
});
