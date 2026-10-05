import type { CollapseStep, LabelPolicy } from "./adaptive-bar";

/*
 * The grouped form of AdaptiveBar's collapse plan (LANGUAGE.md, "Adaptive
 * commands"; EDITORS.md, "The workbar").
 *
 * AdaptiveBar's plan knows two steps: hide a label, and move a command (or a
 * group) into the bar's one More menu. Ribbon-like bars need a third, between
 * them: a whole group gives way *as a unit* into its own dropdown, shown as the
 * group's icon and a caret (or its name), so a command whose meaning lives in
 * its words is never shrunk to an ambiguous icon. This module is that engine.
 * It is pure, so every authored plan can be proved at every width in a test.
 *
 * Steps (applied in order until the bar fits):
 *   { hideLabel: "<id>" }          one command shows its icon only
 *   { hideLabel: "group:<g>" }     every command of a group does
 *   { groupMenu: "<g>" }           the group becomes one dropdown
 *   { toMenu: "<id>" | "group:<g>" } the command or group moves into More
 *
 * Steps never touch pinned commands, never hide an `always` label, and a group
 * holding a pinned command never folds. When an authored plan runs out, the bar
 * still never wraps or clips: the remaining groups fold into dropdowns from the
 * end, then move into More from the end. A plan that relies on that fallback is
 * a plan to fix, and the plan tests say so.
 */

export type GroupedStep = CollapseStep | { groupMenu: string };

export type GroupedItem = {
  id: string;
  group: string;
  labelPolicy?: LabelPolicy;
  pinned?: boolean;
  /** Width with its label, and as an icon only. Equal for controls that never lose their words. */
  widths: { full: number; icon: number };
};

export type GroupedLayout = {
  labelHidden: ReadonlySet<string>;
  groupMenus: ReadonlySet<string>;
  inMore: ReadonlySet<string>;
  /** True when the authored plan ran out and the fallback had to act. */
  fellBack: boolean;
};

export type GroupedMetrics = {
  /** Space between commands inside a group. */
  gap: number;
  /** Space between two groups, including their divider. */
  groupGap: number;
  /** The More trigger. */
  more: number;
  /** Each group's dropdown trigger. */
  groupMenu: Readonly<Record<string, number>>;
  /** Room taken by More even with nothing collapsed (it already holds rare commands). */
  moreAlways?: boolean;
};

/** The groups in the order their first command appears. */
export function groupOrderOf(items: readonly GroupedItem[]): string[] {
  const order: string[] = [];
  for (const item of items) if (!order.includes(item.group)) order.push(item.group);
  return order;
}

export function groupedWidth(
  items: readonly GroupedItem[],
  layout: Pick<GroupedLayout, "labelHidden" | "groupMenus" | "inMore">,
  metrics: GroupedMetrics,
): number {
  let total = 0;
  let shownGroups = 0;
  for (const group of groupOrderOf(items)) {
    const members = items.filter((item) => item.group === group && !layout.inMore.has(item.id));
    if (!members.length) continue;
    let width: number;
    if (layout.groupMenus.has(group)) {
      const pinned = members.filter((item) => item.pinned);
      width = (metrics.groupMenu[group] ?? 32) + pinned.reduce((sum, item) => sum + item.widths.icon + metrics.gap, 0);
    } else {
      width = members.reduce((sum, item) => {
        const iconOnly = item.labelPolicy === "never" || layout.labelHidden.has(item.id);
        return sum + (iconOnly ? item.widths.icon : item.widths.full);
      }, 0);
      width += Math.max(0, members.length - 1) * metrics.gap;
    }
    total += width;
    shownGroups += 1;
  }
  total += Math.max(0, shownGroups - 1) * metrics.groupGap;
  if (layout.inMore.size || metrics.moreAlways) total += metrics.more + (shownGroups ? metrics.gap : 0);
  return total;
}

export function planGroupedLayout({
  items,
  plan,
  available,
  metrics,
}: {
  items: readonly GroupedItem[];
  plan: readonly GroupedStep[];
  available: number;
  metrics: GroupedMetrics;
}): GroupedLayout {
  const labelHidden = new Set<string>();
  const groupMenus = new Set<string>();
  const inMore = new Set<string>();
  const byId = new Map(items.map((item) => [item.id, item]));
  const groups = groupOrderOf(items);
  const pinnedGroups = new Set(items.filter((item) => item.pinned).map((item) => item.group));
  const fits = () => groupedWidth(items, { labelHidden, groupMenus, inMore }, metrics) <= available + 0.5;
  const done = (fellBack: boolean): GroupedLayout => ({ labelHidden, groupMenus, inMore, fellBack });
  if (fits()) return done(false);

  const membersOf = (ref: string) =>
    ref.startsWith("group:") ? items.filter((item) => item.group === ref.slice(6)) : byId.has(ref) ? [byId.get(ref)!] : [];

  for (const step of plan) {
    if ("hideLabel" in step) {
      for (const item of membersOf(step.hideLabel)) {
        if (item.pinned || item.labelPolicy === "always" || item.labelPolicy === "never") continue;
        labelHidden.add(item.id);
      }
    } else if ("groupMenu" in step) {
      if (groups.includes(step.groupMenu) && !pinnedGroups.has(step.groupMenu)) groupMenus.add(step.groupMenu);
    } else {
      for (const item of membersOf(step.toMenu)) if (!item.pinned) inMore.add(item.id);
    }
    if (fits()) return done(false);
  }

  // The plan ran out. Fold whole groups from the end, then move them into More.
  for (let index = groups.length - 1; index >= 0 && !fits(); index -= 1) {
    const group = groups[index]!;
    if (!pinnedGroups.has(group)) groupMenus.add(group);
  }
  for (let index = groups.length - 1; index >= 0 && !fits(); index -= 1) {
    const group = groups[index]!;
    if (pinnedGroups.has(group)) continue;
    for (const item of items) if (item.group === group) inMore.add(item.id);
    groupMenus.delete(group);
  }
  return done(true);
}

/**
 * The order a person chose, applied over the shipped order: ids the person
 * placed come first in their order, everything else keeps its shipped place
 * after them. Unknown ids are ignored, so a stale saved order cannot hide or
 * duplicate anything.
 */
export function applyOrder<T>(values: readonly T[], keyOf: (value: T) => string, saved: readonly string[] | undefined): T[] {
  if (!saved?.length) return [...values];
  const rank = new Map(saved.map((key, index) => [key, index]));
  return values
    .map((value, index) => ({ value, index, rank: rank.get(keyOf(value)) }))
    .sort((left, right) => {
      if (left.rank !== undefined && right.rank !== undefined) return left.rank - right.rank;
      if (left.rank !== undefined) return -1;
      if (right.rank !== undefined) return 1;
      return left.index - right.index;
    })
    .map((entry) => entry.value);
}

/** Moves `id` to just before `before` (or to the end) in an ordered key list. */
export function moveKey(order: readonly string[], id: string, before: string | null): string[] {
  const next = order.filter((key) => key !== id);
  const at = before === null ? next.length : next.indexOf(before);
  next.splice(at < 0 ? next.length : at, 0, id);
  return next;
}
