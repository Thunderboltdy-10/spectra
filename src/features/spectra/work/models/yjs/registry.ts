import type { ArtifactTypeKey } from "../../../artifacts/types";
import type { WorkYjsAdapter } from "./contracts";
import { documentYjsAdapter } from "./document-adapter";
import { codeYjsAdapter } from "./code-adapter";
import {
  agentYjsAdapter,
  flashcardDeckYjsAdapter,
  plannerYjsAdapter,
  presentationYjsAdapter,
  quizYjsAdapter,
  sheetsYjsAdapter,
  timetableYjsAdapter,
  whiteboardYjsAdapter,
} from "./structured-adapters";

const adapters = Object.freeze({
  document: documentYjsAdapter,
  flashcard_deck: flashcardDeckYjsAdapter,
  quiz: quizYjsAdapter,
  planner_task: plannerYjsAdapter,
  agent: agentYjsAdapter,
  timetable: timetableYjsAdapter,
  presentation: presentationYjsAdapter,
  sheets: sheetsYjsAdapter,
  code: codeYjsAdapter,
  whiteboard: whiteboardYjsAdapter,
} satisfies Record<ArtifactTypeKey, { readonly workType: ArtifactTypeKey }>);

export function workYjsAdapter<TModel = unknown>(
  workType: ArtifactTypeKey,
): WorkYjsAdapter<TModel> {
  return adapters[workType] as unknown as WorkYjsAdapter<TModel>;
}

export function listWorkYjsAdapters() {
  return Object.values(adapters) as unknown as readonly WorkYjsAdapter<unknown>[];
}

export function isNativeWorkYjsType(value: string): value is ArtifactTypeKey {
  return value in adapters;
}

export const WORK_YJS_ADAPTERS = adapters;
