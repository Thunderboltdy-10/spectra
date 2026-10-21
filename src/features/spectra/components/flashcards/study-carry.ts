import type { SpectraFlashcardRating } from "../../data/api";
import type { DeckStudyItem } from "../artifact-content-model";

/**
 * A study session on its way from the side panel to the whole window. Opening
 * the work full mounts its deck afresh; the session waits here, keyed by the
 * work, so the learner lands on the same card rather than a new queue.
 */
export type CarriedStudy = {
  queue: DeckStudyItem[];
  index: number;
  revealed: boolean;
  complete: boolean;
  typedAnswer: string;
  typedCorrect: boolean | undefined;
  typingChoice: boolean | undefined;
  ratings: Record<SpectraFlashcardRating, number>;
};

/** A carried session is for the deck that mounts next, not one opened later. */
const CARRY_MS = 5000;

const carried = new Map<string, { session: CarriedStudy; at: number }>();

export function carryStudy(artifactId: string, session: CarriedStudy) {
  carried.set(artifactId, { session, at: Date.now() });
}

/** The session carried for this work, if any; `dropCarriedStudy` once taken up. */
export function carriedStudy(artifactId: string) {
  const entry = carried.get(artifactId);
  return entry && Date.now() - entry.at < CARRY_MS ? entry.session : undefined;
}

export function dropCarriedStudy(artifactId: string) {
  carried.delete(artifactId);
}
