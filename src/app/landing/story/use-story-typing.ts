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
    selector = "textarea, input",
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
      field ??= host.querySelector<Field>(selector);
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
