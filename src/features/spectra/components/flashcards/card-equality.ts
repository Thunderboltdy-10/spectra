import type { DeckCard } from "../artifact-content-model";

const blank = (value: unknown) =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

/**
 * A card's authored content, independent of how the store happened to write
 * it: empty fields and study progress are left out and keys are sorted, so a
 * card that only went through normalization still counts as unchanged.
 */
export function cardFingerprint(card: DeckCard) {
  const entries = Object.entries(card)
    .filter(([key, value]) => key !== "review" && !blank(value))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}
