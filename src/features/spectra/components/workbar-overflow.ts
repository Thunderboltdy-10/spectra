/**
 * Real-time workbar overflow.
 *
 * Room is measured in pixels, not in a density guess. Disabled and low-value
 * commands leave the row first; essentials keep their labels until the bar
 * actually runs out of space. The assignment is recomputed on every resize.
 */

export type WorkbarOverflowPriority = "essential" | "secondary" | "advanced";

export type WorkbarOverflowItem = {
  id: string;
  /** Width with icon and label. */
  fullWidth: number;
  /** Width as icon-only. */
  iconWidth: number;
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
  if (item.disabled) return 0;
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
  const hidden = new Set<string>();

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
    const nextIcon = collapseOrder.find(
      (id) => !hidden.has(id) && !iconOnly.has(id),
    );
    if (nextIcon) {
      const item = items.find((entry) => entry.id === nextIcon);
      if (item && item.fullWidth - Math.max(ICON_ONLY_FLOOR, item.iconWidth) >= 8) {
        iconOnly.add(nextIcon);
        continue;
      }
    }
    const nextHide = collapseOrder.find((id) => !hidden.has(id));
    if (!nextHide) break;
    hidden.add(nextHide);
    iconOnly.delete(nextHide);
  }

  return {
    visibleIds: visible.filter((id) => !hidden.has(id)),
    iconOnlyIds: [...iconOnly],
    overflowIds: visible.filter((id) => hidden.has(id)),
  };
}
