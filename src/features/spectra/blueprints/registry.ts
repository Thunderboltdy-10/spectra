import { z } from "zod";
import type { ArtifactBlueprint } from "../core";
import { documentBlueprint } from "./document";
import { flashcardDeckBlueprint } from "./flashcard-deck";
import { plannerTaskBlueprint } from "./planner-task";
import { quizBlueprint } from "./quiz";

export const BUILT_IN_BLUEPRINTS = [
  documentBlueprint,
  flashcardDeckBlueprint,
  quizBlueprint,
  plannerTaskBlueprint,
] as const satisfies readonly ArtifactBlueprint[];

export type BuiltInBlueprintKey = (typeof BUILT_IN_BLUEPRINTS)[number]["key"];

const blueprintByKey = new Map<string, ArtifactBlueprint>(
  BUILT_IN_BLUEPRINTS.map((blueprint) => [blueprint.key, blueprint]),
);

export function listBlueprints() {
  return BUILT_IN_BLUEPRINTS;
}

export function getBlueprint(key: string) {
  return blueprintByKey.get(key);
}

export function requireBlueprint(key: string) {
  const blueprint = getBlueprint(key);
  if (!blueprint) {
    throw new Error(`Unknown artifact blueprint: ${key}`);
  }
  return blueprint;
}

export function validateBlueprintContent(key: string, content: unknown) {
  const blueprint = requireBlueprint(key);
  if (!(blueprint.schema instanceof z.ZodType)) {
    return { success: true as const, data: content };
  }
  return blueprint.schema.safeParse(content);
}
