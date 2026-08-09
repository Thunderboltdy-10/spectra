/**
 * The three actors who build this page.
 *
 * These are ordinary Spectra identities. Nothing here is landing-specific:
 * the colours come from the product's presence palette, the AI is
 * owner-attributed exactly as the product requires, and the labels are
 * whatever `actorLabel` derives. If Spectra changes how presence identity
 * works, the landing changes with it.
 */

import {
  actorLabel,
  presenceColor,
  type ActorIdentity,
} from "@/features/spectra/collaboration/interaction-model";

/** Spectra itself: the product's own AI, not owned by any one person. */
export const SPECTRA: ActorIdentity = {
  clientId: "story-spectra",
  kind: "ai",
  name: "Spectra",
  accountId: "spectra",
};

/** The human. */
export const PABLO: ActorIdentity = {
  clientId: "story-pablo",
  kind: "human",
  name: "Pablo",
  accountId: "pablo",
};

/**
 * Pablo's AI. Owner-attributed, so the product derives both its label
 * ("Pablo's AI") and its colour from Pablo. The relationship is visible
 * rather than asserted.
 */
export const PABLO_AI: ActorIdentity = {
  clientId: "story-pablo-ai",
  kind: "ai",
  name: "Assistant",
  accountId: "pablo-ai",
  ownerAccountId: "pablo",
  ownerName: "Pablo",
};

export type ActorId = "spectra" | "pablo" | "pabloAi";

export const ACTORS: Record<ActorId, ActorIdentity> = {
  spectra: SPECTRA,
  pablo: PABLO,
  pabloAi: PABLO_AI,
};

export function actorColor(id: ActorId): string {
  return presenceColor(ACTORS[id]);
}

export function actorName(id: ActorId): string {
  return actorLabel(ACTORS[id]);
}

/** The landing canvas is one artifact; every semantic target lives on it. */
export const STORY_ARTIFACT = "spectra-landing";
