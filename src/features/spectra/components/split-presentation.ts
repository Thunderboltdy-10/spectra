/**
 * One authority for how a side-by-side studio fits the workbench (CANON D44).
 *
 * A split only makes sense when the host can honor both floors at once: the
 * library keeps its reserve, the studio keeps its registry `minInlineSize`.
 * Below that width the two used to fight — the JS fitter asked for the floor
 * while the CSS cap squeezed the panel under it, producing a clipped studio
 * beside an unreadable library. Now the panel is promoted to an overlay that
 * covers the content column: the library stays mounted underneath (state,
 * scroll, and selection preserved) and the studio gets the full width it
 * needs. Widening the window demotes it back to a split.
 *
 * The hysteresis band stops the boundary from flapping on a one-pixel resize
 * or a scrollbar appearing.
 */

/** Extra room required before an overlay demotes back to a split. */
export const SPLIT_OVERLAY_HYSTERESIS_PX = 32;

/** Extra room required before an auto-railed sidebar expands again. */
export const SIDEBAR_RAIL_HYSTERESIS_PX = 48;

/** Chrome sidebar inline sizes; the app-shell width/padding classes mirror
 *  these literals (Tailwind needs the literal class, the resolver needs the
 *  number — keep the two in sync). */
export const SIDEBAR_EXPANDED_PX = 240;
export const SIDEBAR_RAILED_PX = 76;

/** Width the library/workspace canvas keeps while any panel sits beside it. */
export const WORKBENCH_CONTENT_RESERVE_PX = 420;

/**
 * The width each page keeps before the shell gives way (SHELL.md, "Width
 * rules"): first the chrome rails, then the Side floats over the stage.
 */
export function stageMinimumFor(pathname: string) {
  if (/^\/calendar(\/|$)/.test(pathname)) return 640;
  if (/^\/managebac(\/|$)/.test(pathname)) return 600;
  if (/^\/(library|workspace)(\/|$)/.test(pathname)) return 560;
  return WORKBENCH_CONTENT_RESERVE_PX;
}

/** Floor for the conversation and run side panels (their controls and
 *  message bubbles stop working below this). */
export const SIDE_PANEL_FLOOR_PX = 360;

export function resolveSplitOverlay({
  hostWidth,
  panelMinWidth,
  contentReserve,
  overlay,
}: {
  /** Inline size of the row that hosts library content plus panels. */
  hostWidth: number;
  /** The open work's own floor (`responsive.minInlineSize`). */
  panelMinWidth: number;
  /** Width the main canvas keeps when the panel sits beside it. */
  contentReserve: number;
  /** Current presentation, so the boundary does not flap. */
  overlay: boolean;
}): boolean {
  // An unmeasured host must not change anyone's mind.
  if (hostWidth <= 0) return overlay;
  const needed = panelMinWidth + contentReserve;
  if (overlay) return hostWidth < needed + SPLIT_OVERLAY_HYSTERESIS_PX;
  return hostWidth < needed;
}

/**
 * The whole workbench row, one budget (CANON D44).
 *
 * Sidebar, library, studio, thread and run panels share one row of pixels.
 * Each side panel used to negotiate alone: the thread and run panels could
 * not overlay at all, so at narrower widths they squeezed the library into
 * an unreadable strip and forced the studio into its overlay long before
 * the row was actually full. Now every panel is resolved together:
 *
 * - Panels walk in priority order (the open work first, then the thread,
 *   then the run detail). A panel stays in flow only while the region left
 *   beside it can still hold the library reserve *and* every panel that has
 *   already been promoted to an overlay (overlays cover that same region,
 *   so it must stay wider than their floors).
 * - A panel that does not fit leaves the flow and overlays the content
 *   region; in-flow siblings keep their pixels because the overlay spares
 *   their combined width on the inline-end side.
 * - The sidebar is the first pressure valve, not the last casualty: when
 *   the expanded sidebar would force an overlay that the railed sidebar
 *   avoids, the shell asks chrome to rail it (auto-rail is presentational;
 *   the stored preference is untouched and manual toggles always win).
 *
 * Hysteresis on both boundaries stops one-pixel resizes and scrollbar
 * appearances from flapping the row.
 */
export interface WorkbenchPaneSpec {
  /** Stable identity for hysteresis across renders. */
  id: string;
  /** Minimum inline size the panel can work at. */
  floor: number;
  /** Lower stays in flow longest; the open work is 0. */
  priority: number;
  /** Current presentation, so the boundary does not flap. */
  overlay: boolean;
}

export function resolveWorkbenchPanes({
  hostWidth,
  contentReserve,
  panes,
}: {
  /** Inline size of the whole workbench row (after the sidebar). */
  hostWidth: number;
  /** Width the main canvas keeps while any panel sits beside it. */
  contentReserve: number;
  panes: readonly WorkbenchPaneSpec[];
}): Record<string, boolean> {
  const ordered = [...panes].sort((a, b) => a.priority - b.priority);
  const result: Record<string, boolean> = {};
  let splitFloors = 0;
  let overlayFloor = 0;
  for (const pane of ordered) {
    if (hostWidth <= 0) {
      result[pane.id] = pane.overlay;
      continue;
    }
    // The region left for the library and any overlays once this panel
    // takes its floor. It must feed both: the library reserve while
    // anything is in flow, and the widest overlay already promoted.
    const remaining = hostWidth - splitFloors - pane.floor;
    const needed = Math.max(contentReserve, overlayFloor);
    const fits = pane.overlay
      ? remaining >= needed + SPLIT_OVERLAY_HYSTERESIS_PX
      : remaining >= needed;
    result[pane.id] = !fits;
    if (fits) splitFloors += pane.floor;
    else overlayFloor = Math.max(overlayFloor, pane.floor);
  }
  return result;
}

export interface WorkbenchPaneAllocation extends WorkbenchPaneSpec {
  /** The width the user chose (drag) or accepted (default). */
  intent: number;
  /** Larger means more recently dragged; explicit choices outrank priority. */
  recency: number;
  /** The widest this panel grows; 960 unless it carries its own side pane. */
  cap?: number;
}

/**
 * One allocator for every in-flow panel width. Per-panel fitters measuring
 * each other oscillate (each refit chases room the other just took) and can
 * sum over budget; a single pure pass cannot. Floors are dealt first, then
 * the remaining width goes to the most recently dragged panel and then by
 * priority, so the open work wins by default and an explicit drag always
 * wins over defaults. The library's reserve is subtracted up front, which
 * makes "the library never goes below its reserve while anything splits"
 * true by construction. Overlay panels hold no in-flow width and are
 * skipped.
 */
export function allocateWorkbenchPanes({
  hostWidth,
  contentReserve,
  panes,
}: {
  hostWidth: number;
  contentReserve: number;
  panes: readonly WorkbenchPaneAllocation[];
}): Record<string, number> {
  const split = panes
    .filter((pane) => !pane.overlay)
    .sort((a, b) => a.priority - b.priority);
  if (split.length === 0 || hostWidth <= 0) return {};
  const budget = Math.max(0, hostWidth - contentReserve);
  const floors = split.reduce((total, pane) => total + pane.floor, 0);
  const result: Record<string, number> = {};
  if (floors >= budget) {
    // The walk overlays a panel before this can happen; if it ever disagrees,
    // degrade to proportional shares instead of overflowing the row.
    for (const pane of split)
      result[pane.id] = Math.max(1, Math.floor((pane.floor / floors) * budget));
    return result;
  }
  let slack = budget - floors;
  for (const pane of split) result[pane.id] = pane.floor;
  const order = [...split].sort(
    (a, b) => b.recency - a.recency || a.priority - b.priority,
  );
  for (const pane of order) {
    if (slack <= 0) break;
    const want = Math.max(0, Math.min(pane.intent, pane.cap ?? 960) - pane.floor);
    const give = Math.min(want, slack);
    result[pane.id] += give;
    slack -= give;
  }
  return result;
}

/**
 * Whether the chrome sidebar should rail itself to make room for open
 * workbench panels. Based on the window, not the row, so the rail itself
 * changing the row width cannot feed back into the decision.
 */
export function resolveSidebarRail({
  windowWidth,
  expandedWidth,
  railedWidth,
  demand,
  railed,
}: {
  windowWidth: number;
  /** Expanded sidebar inline size. */
  expandedWidth: number;
  /** Railed sidebar inline size. */
  railedWidth: number;
  /** contentReserve plus the floors of every open panel; 0 when none. */
  demand: number;
  /** Current presentation, so the boundary does not flap. */
  railed: boolean;
}): boolean {
  if (demand <= 0 || windowWidth <= 0) return false;
  if (railedWidth >= expandedWidth) return false;
  const expandedHost = windowWidth - expandedWidth;
  if (railed) return expandedHost < demand + SIDEBAR_RAIL_HYSTERESIS_PX;
  return expandedHost < demand;
}
