import { ensurePresentationReadingOrders } from "./layouts";
import type { PresentationContent } from "./model";

/**
 * Normalize accessibility without changing the authored slide sequence.
 *
 * Citations belong to their narrative slides and export as attribution and
 * speaker notes. A bibliography is an explicit content choice, not a side
 * effect of citing a source or editing an unrelated slide. Preserve existing
 * bibliography slides; the editor's bibliography command can refresh them.
 * Evidence validation stays at the source-evidence and quality boundaries.
 */
export function enforceAiPresentationContentPolicy(
  deck: PresentationContent,
  // Retain the writer's call contract; prose is not a structural mutation API.
  _prompt?: string,
) {
  ensurePresentationReadingOrders(deck);
  return deck;
}
