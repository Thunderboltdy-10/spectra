/**
 * Real-time workbar overflow.
 *
 * Room is measured in pixels, not in a density guess. Advanced extras leave
 * first; honest-disabled controls stay visible so a refused native write does
 * not vanish and leave an apparently fully-enabled bar (CMD-3).
 */

export type WorkbarOverflowPriority = "essential" | "secondary" | "advanced";

export type WorkbarOverflowItem = {
  id: string;
  /** Width with icon and label. */
  fullWidth: number;
  /** Width as icon-only. */
  iconWidth: number;
  /**
   * False for text-only actions and compound controls. Collapsing either one
   * to the icon budget would create an empty button or a control whose value
   * disappeared, so those items move to the labelled overflow instead.
   */
  canCollapseToIcon?: boolean;
  disabled?: boolean;
  priority?: WorkbarOverflowPriority;
};

export type WorkbarOverflowPlan = {
  visibleIds: string[];
  iconOnlyIds: string[];
  overflowIds: string[];
};

const ICON_ONLY_FLOOR = 28;

export function overflowRank(item: Pick<WorkbarOverflowItem, "disabled" | "priority">) {
  // Disabled is not low-value: it is the honest refusal. Shed by priority
  // only, so a greyed-out Bold stays as visible as an enabled Bold.
  if (item.priority === "advanced") return 1;
  if (item.priority === "secondary") return 2;
  return 3;
}

/**
 * Lowest rank leaves first. Equal ranks keep visual order by collapsing from
 * the right, which is how a person reads "these extras did not fit".
 */
export function planWorkbarOverflow(
  items: readonly WorkbarOverflowItem[],
  availablePx: number,
  overflowControlPx = 36,
): WorkbarOverflowPlan {
  const visible = items.map((item) => item.id);
  const iconOnly = new Set<string>();
  // Advanced commands are overflow commands by meaning, not merely when the
  // row happens to be narrow. Keeping them here at every width makes the
  // documented information architecture stable and keeps rare/destructive
  // actions out of the immediate command rail.
  const hidden = new Set(
    items
      .filter((item) => item.priority === "advanced")
      .map((item) => item.id),
  );

  const widthOf = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item || hidden.has(id)) return 0;
    return iconOnly.has(id) ? Math.max(ICON_ONLY_FLOOR, item.iconWidth) : item.fullWidth;
  };

  const used = () =>
    visible.reduce((total, id) => total + widthOf(id), 0) +
    (hidden.size > 0 ? overflowControlPx : 0);

  const collapseOrder = [...items]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rankDelta = overflowRank(left.item) - overflowRank(right.item);
      if (rankDelta !== 0) return rankDelta;
      return right.index - left.index;
    })
    .map((entry) => entry.item.id);

  let guard = items.length * 4;
  while (used() > availablePx && guard > 0) {
    guard -= 1;
    const nextIcon = collapseOrder.find((id) => {
      if (hidden.has(id) || iconOnly.has(id)) return false;
      const item = items.find((entry) => entry.id === id);
      return Boolean(
        item &&
          item.canCollapseToIcon !== false &&
          item.fullWidth - Math.max(ICON_ONLY_FLOOR, item.iconWidth) >= 8,
      );
    });
    if (nextIcon) {
      iconOnly.add(nextIcon);
      continue;
    }
    const nextHide = collapseOrder.find((id) => !hidden.has(id));
    if (!nextHide) break;
    hidden.add(nextHide);
    iconOnly.delete(nextHide);
  }

  return {
    visibleIds: visible.filter((id) => !hidden.has(id)),
    // State updates and tests consume visual order, never the internal order
    // in which pressure happened to collapse the commands.
    iconOnlyIds: visible.filter((id) => iconOnly.has(id)),
    overflowIds: visible.filter((id) => hidden.has(id)),
  };
}

/**
 * First paint and command remounts report 0px. Applying that as "nothing fits"
 * clears a real plan, the next frame restores it, and the workbar loops.
 */
export function shouldCommitWorkbarPlan(
  widths: Iterable<{ full: number }>,
): boolean {
  for (const entry of widths) {
    if (entry.full > 0) return true;
  }
  return false;
}

export function sameIdList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function workbarPlanKey(plan: Pick<WorkbarOverflowPlan, "iconOnlyIds" | "overflowIds">) {
  return `${plan.iconOnlyIds.join("\u001f")}\n${plan.overflowIds.join("\u001f")}`;
}

/**
 * Overflow measurements and ResizeObserver can bounce A→B→A when the overflow
 * control itself changes the row. Keep the committed plan instead of looping.
 */
export function shouldReplaceWorkbarPlan(
  nextKey: string,
  committedKey: string | null,
  previousKey: string | null,
) {
  if (committedKey === nextKey) return false;
  if (previousKey === nextKey) return false;
  return true;
}

/**
 * Hiding a command must not count as a host resize. The commands row is flex-1,
 * so its clientWidth is stable; ResizeObserver still fires when inner content
 * changes, and treating that as a new measurement walks unique overflow plans
 * until React hits its update cap.
 */
export function shouldIgnoreWorkbarHostResize(
  previousWidth: number | null,
  nextWidth: number,
) {
  return previousWidth !== null && previousWidth === nextWidth;
}

const warnedEssentialBudgets = new Set<string>();

/** Dev contract: essential actions that cannot fit the bar should warn once per tab, not every render. */
export function shouldWarnEssentialOverBudget(
  key: string,
  essentialWeight: number,
  budget: number,
) {
  if (essentialWeight <= budget) return false;
  if (warnedEssentialBudgets.has(key)) return false;
  warnedEssentialBudgets.add(key);
  return true;
}
