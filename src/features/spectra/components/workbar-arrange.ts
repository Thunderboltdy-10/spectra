import type { LabelPolicy } from "@/components/ui/adaptive-bar";
import { applyOrder, type GroupedItem } from "@/components/ui/adaptive-groups";
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
 * with its commands in the person's order. Rare commands (`advanced`) are kept
 * apart; they live in More, under their group's name. Pure, so the plan tests
 * arrange a tab exactly as the bar does.
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
};

export type ArrangedGroup = { name: string; actions: ArrangedAction[] };

export type ArrangedTab = {
  history: ArrangedAction[];
  groups: ArrangedGroup[];
  advanced: ArrangedGroup[];
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
  });
  const history = actions.filter((action) => isHistoryCommand(type, action.id)).map(arranged);
  const onTab = actions
    .filter((action) => !isHistoryCommand(type, action.id) && actionOnTab(action, tab))
    .map(arranged);
  const ordered = applyOrder(onTab, (action) => action.id, layout?.commandOrder?.[tab]);
  const group = (list: readonly ArrangedAction[]) => {
    const names = applyOrder(
      [...new Set(list.map((action) => action.group))],
      (name) => name,
      layout?.groupOrder?.[tab],
    );
    return names.map((name) => ({ name, actions: list.filter((action) => action.group === name) }));
  };
  return {
    history,
    groups: group(ordered.filter((action) => action.priority !== "advanced")),
    advanced: group(ordered.filter((action) => action.priority === "advanced")),
  };
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
