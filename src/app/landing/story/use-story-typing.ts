"use client";

/**
 * Typing into a real control.
 *
 * The story does not draw text into a lookalike input. It types into the
 * product's actual composer, through the same path a keyboard would take: set
 * the value with React's own descriptor and dispatch the input event, so the
 * component's state updates, its autosize runs, its send button enables. What
 * the visitor sees is the real control behaving.
 *
 * While an actor holds the field it is genuinely read-only — the temporary,
 * scoped lease the product uses for any contended control — and the lease is
 * released the moment the beat ends.
 */

import { useEffect, type RefObject } from "react";
import { onStoryFrame } from "./story-clock";
import { authoringAt, type Beat } from "./beats";
import {
  PART_ATTRIBUTE,
  TARGET_ATTRIBUTE,
} from "@/features/spectra/collaboration/interaction-geometry";
import type { SceneId } from "./timeline";

type Field = HTMLTextAreaElement | HTMLInputElement;

/**
 * Input types whose `value` is not free text.
 *
 * A real composer is not only a textarea: the product's command bar also mounts
 * a hidden file input for attachments, and it precedes the textarea in the DOM.
 * Setting `value` on that one throws, so the search skips every input whose
 * value is owned by the browser rather than by the person typing.
 */
const NOT_TEXT = ["file", "checkbox", "radio", "range", "color", "image"];

const TEXT_FIELD = `textarea, input${NOT_TEXT.map((type) => `:not([type=${type}])`).join("")}`;

/** True when this field's value can be set from a keystroke. */
function isTextField(field: Field): boolean {
  return (
    field instanceof HTMLTextAreaElement ||
    !NOT_TEXT.includes(field.type.toLowerCase())
  );
}

/** Set a controlled field's value the way a keystroke does. */
function commit(field: Field, next: string) {
  if (field.value === next) return;
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(field, next);
  else field.value = next;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Drive the first field inside `hostRef` from a typing beat.
 *
 * The field is also tagged as the semantic target, so the caret the presence
 * layer draws is measured against the real text metrics of the real input
 * rather than against a stand-in.
 */
export function useStoryTyping(
  hostRef: RefObject<HTMLElement | null>,
  {
    beats,
    scene,
    path,
    selector = TEXT_FIELD,
  }: {
    beats: readonly Beat[];
    scene: SceneId;
    path: string;
    selector?: string;
  },
) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let field: Field | null = null;
    let leased = false;

    return onStoryFrame((frame) => {
      if (!field) {
        /* Resolve once, then keep it. The guard is belt and braces: the
           selector already excludes non-text inputs, and a component that
           mounts one anyway must not be able to stop the story clock. */
        const found = host.querySelector<Field>(selector);
        if (found && isTextField(found)) field = found;
      }
      if (!field) return;
      if (field.getAttribute(TARGET_ATTRIBUTE) !== path) {
        field.setAttribute(TARGET_ATTRIBUTE, path);
        field.setAttribute(PART_ATTRIBUTE, "value");
      }
      const t = frame.scene === scene ? frame.t : frame.index > 0 ? 1 : 0;
      const authored = authoringAt(beats, path, t);
      if (!authored.text) {
        if (leased) {
          leased = false;
          field.readOnly = false;
        }
        return;
      }
      commit(field, authored.text.slice(0, authored.count));
      /* The lease: while an actor is writing here the visitor cannot. It ends
         with the beat, and the field is an ordinary composer again. */
      if (authored.writing !== leased) {
        leased = authored.writing;
        field.readOnly = authored.writing;
      }
    });
  }, [beats, hostRef, path, scene, selector]);
}
