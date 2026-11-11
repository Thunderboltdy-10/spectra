"use client";

import { useSyncExternalStore } from "react";
import type { HarnessInputView } from "./stream-events";
import type { HarnessAnswerValue } from "./harness-exchange";

/*
 * What this person has just answered, from wherever they answered it. A
 * question can be on show in the island and in a thread at once, each from its
 * own engine and its own subscription, so the answer given in one has to reach
 * the other before the server's next word does.
 */

export type AnsweredNote = { key: string; runId?: string; messageId?: string; question: string; label: string };

const MAX_NOTES = 30;
const EMPTY: readonly AnsweredNote[] = [];
let notes: readonly AnsweredNote[] = EMPTY;
const listeners = new Set<() => void>();

function publish(next: readonly AnsweredNote[]) {
  notes = next;
  for (const listener of listeners) listener();
}

export function noteAnswered(note: AnsweredNote) {
  publish([...notes.filter((entry) => entry.key !== note.key), note].slice(-MAX_NOTES));
}

/** The answer did not reach the run, so the question is open again. */
export function forgetAnswered(key: string) {
  if (notes.some((entry) => entry.key === key)) publish(notes.filter((entry) => entry.key !== key));
}

export function liveAnswerKey(runId: string, toolCallId: string) {
  return `live:${runId}:${toolCallId}`;
}

export function useAnsweredNotes() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => notes,
    () => EMPTY,
  );
}

/** The answer in the words shown afterwards. */
export function answerLabel(input: Pick<HarnessInputView, "options">, value: HarnessAnswerValue) {
  if (value.kind === "approval") return value.allowed ? "Allowed" : "Not allowed";
  if (value.choiceKey) return input.options?.find((option) => option.key === value.choiceKey)?.label ?? value.choiceKey;
  return value.text?.trim() || "Skipped";
}
