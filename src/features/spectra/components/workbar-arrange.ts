import type { LabelPolicy } from "@/components/ui/adaptive-bar";
import { applyOrder, type GroupedItem, type GroupedStep } from "@/components/ui/adaptive-groups";
import type { CommandBinding, CommandLayout } from "../commands";
import type { WorkType } from "../work/registry";
import {
  HISTORY_GROUP,
  estimateCommandWidths,
  isHistoryCommand,
  planGroupOf,
  planLabelPolicy,
} from "./workbar-plans";

/*
 * What one tab of the workbar holds, in the order it shows: undo and redo
 * first, then the tab's groups in the person's order (or the shipped one), each
 * with its commands in the person's order. Rare commands (`advanced`) are on
 * the bar too, after the common ones: a group of only rare commands shows as
 * its own dropdown, and they are the first to give way into More when the bar
 * runs short. More is for a bar that is out of room, not a drawer for things
 * that are used less. Pure, so the plan tests arrange a tab exactly as the bar
 * does.
 */

export type WorkbarAction = CommandBinding & {
  /** The command's place before any person moved it. */
  sourceTab?: string;
  placedTab?: string;
};

export type ArrangedAction = WorkbarAction & {
  group: string;
  labelPolicy: LabelPolicy;
  history: boolean;
  /** Used less often: shown when there is room, first into More when not. */
  rare: boolean;
};

export type ArrangedGroup = { name: string; actions: ArrangedAction[] };

export type ArrangedTab = {
  history: ArrangedAction[];
  groups: ArrangedGroup[];
};

export function actionOnTab(action: WorkbarAction, tab: string) {
  return action.placedTab === tab || action.sourceTab === tab || action.contextualTab === tab;
}

export function arrangeWorkbar({
  type,
  tab,
  actions,
  layout,
}: {
  type: WorkType;
  tab: string;
  /** Every visible action of the bar, on any tab, with full (`type.`) ids. */
  actions: readonly WorkbarAction[];
  layout?: CommandLayout;
}): ArrangedTab {
  const arranged = (action: WorkbarAction): ArrangedAction => ({
    ...action,
    group: planGroupOf(type, action.id, action.group, tab),
    labelPolicy: planLabelPolicy(type, action.id, action),
    history: isHistoryCommand(type, action.id),
    rare: action.priority === "advanced",
  });
  const history = actions.filter((action) => isHistoryCommand(type, action.id)).map(arranged);
  const onTab = actions
    .filter((action) => !isHistoryCommand(type, action.id) && actionOnTab(action, tab))
    .map(arranged);
  // Shipped order puts rare commands last, so a group of only rare ones comes
  // after every common group; an order the person chose still wins.
  const shipped = [...onTab.filter((action) => !action.rare), ...onTab.filter((action) => action.rare)];
  const ordered = applyOrder(shipped, (action) => action.id, layout?.commandOrder?.[tab]);
  const names = applyOrder(
    [...new Set(ordered.map((action) => action.group))],
    (name) => name,
    layout?.groupOrder?.[tab],
  );
  return {
    history,
    groups: names.map((name) => ({ name, actions: ordered.filter((action) => action.group === name) })),
  };
}

/** Groups of only rare commands, which open as a dropdown rather than a row. */
export function rareGroupsOf(tab: ArrangedTab): string[] {
  return tab.groups
    .filter((group) => group.actions.length > 1 && group.actions.every((action) => action.rare))
    .map((group) => group.name);
}

/**
 * The steps that come before a tab's authored plan: rare commands move into
 * More, from the end of the bar, before any common command loses its words.
 */
export function rareSteps(tab: ArrangedTab): GroupedStep[] {
  return [...tab.groups].reverse().flatMap((group) => {
    const rare = group.actions.filter((action) => action.rare);
    if (!rare.length) return [];
    if (rare.length === group.actions.length) return [{ toMenu: `group:${group.name}` }];
    return [...rare].reverse().map((action) => ({ toMenu: action.id }));
  });
}

/** The tab as the collapse engine sees it, undo and redo first and pinned. */
export function groupedItemsOf(
  tab: ArrangedTab,
  widthOf: (action: ArrangedAction) => { full: number; icon: number } = estimateCommandWidths,
): GroupedItem[] {
  return [
    ...tab.history.map((action) => ({
      id: action.id,
      group: HISTORY_GROUP,
      labelPolicy: "never" as const,
      pinned: true,
      widths: widthOf(action),
    })),
    ...tab.groups.flatMap((group) =>
      group.actions.map((action) => ({
        id: action.id,
        group: group.name,
        labelPolicy: action.labelPolicy,
        widths: widthOf(action),
      })),
    ),
  ];
}
