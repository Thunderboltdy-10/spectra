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
