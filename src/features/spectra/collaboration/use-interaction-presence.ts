"use client";

/**
 * Local gesture publishing.
 *
 * Binds one editor surface and translates real DOM events into semantic
 * interaction frames. This is what makes human collaboration live rather than a
 * cursor followed later by a surprise Yjs commit: focus, caret movement,
 * selection, in-progress typed values, menu use, toggles, drags and resizes are
 * all published as they happen, with the provisional value attached so a peer
 * can see what is happening *and* what is still provisional.
 *
 * Nothing published here is a coordinate. Every frame names a control and, where
 * relevant, a character offset.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { buildTarget } from "./control-descriptors";
import {
  canonicalPath,
  idleState,
  normalizeInteractionState,
  primitiveHoldsText,
  targetKey,
  type ActorIdentity,
  type InteractionAct,
  type InteractionLifecycle,
  type InteractionState,
  type MenuObservation,
  type SemanticTarget,
  type TextPoint,
} from "./interaction-model";
import {
  hitTest,
  PART_ATTRIBUTE,
  TARGET_ATTRIBUTE,
} from "./interaction-geometry";
import type { ArtifactTypeKey } from "../artifacts/types";

/** Awareness updates are capped so a fast pointer cannot saturate the room. */
const PUBLISH_INTERVAL_MS = 45;
/** Hover decays to idle so a cursor cannot sit on a control after the user left. */
const HOVER_IDLE_MS = 6_000;

export type PublishInput = {
  act: InteractionAct;
  target?: SemanticTarget | null;
  lifecycle?: InteractionLifecycle;
  note?: string;
  menu?: MenuObservation | null;
  dropTarget?: SemanticTarget | null;
  /** Provisional value for the target path, published as speculation. */
  provisionalValue?: unknown;
};

export type InteractionPublisher = {
  publish: (input: PublishInput) => void;
  publishIdle: () => void;
  /** Build a target for a content path using this artifact's descriptor table. */
  targetFor: (
    path: string,
    extras?: { part?: string; regionId?: string; label?: string },
  ) => SemanticTarget;
};

/** Envelope fields that live beside `content`, not inside it. */
const ENVELOPE_FIELDS = new Set(["/title", "/summary", "/tags"]);

/**
 * Speculative patches address the artifact envelope (`{title, summary, tags,
 * content}`), because that is what a receiving client applies them to. Targets
 * are content-relative, so everything but the envelope fields gets re-rooted.
 * Both publishers — human gestures here and the AI pipeline on the server —
 * must agree on this, or provisional values land at the wrong pointer.
 */
function envelopePointer(path: string): string {
  return ENVELOPE_FIELDS.has(path) ? path : `/content${path}`;
}

export function useInteractionPresence(options: {
  artifactId: string | null | undefined;
  typeKey: ArtifactTypeKey | null | undefined;
  actor: ActorIdentity | null;
  /** The editor's scroll container, annotated with `data-spectra-surface`. */
  surfaceRef: React.RefObject<HTMLElement | null>;
  /** Sends the frame onto awareness. */
  onPublish: (state: InteractionState | null) => void;
  /** Regions this client currently holds, surfaced for lock affordances. */
  heldRegionIds?: readonly string[];
  enabled?: boolean;
}): InteractionPublisher {
  const {
    artifactId,
    typeKey,
    actor,
    surfaceRef,
    onPublish,
    heldRegionIds,
    enabled = true,
  } = options;

  const lastSentAt = useRef(0);
  const pending = useRef<InteractionState | null>(null);
  const timer = useRef<number | null>(null);
  const sequence = useRef(0);
  const lastKey = useRef<string>("");
  const idleTimer = useRef<number | null>(null);

  const heldKey = useMemo(
    () => (heldRegionIds ?? []).join(","),
    [heldRegionIds],
  );

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const state = pending.current;
    pending.current = null;
    if (!state) return;
    lastSentAt.current = Date.now();
    onPublish(state);
  }, [onPublish]);

  const send = useCallback(
    (state: InteractionState) => {
      pending.current = state;
      const elapsed = Date.now() - lastSentAt.current;
      if (elapsed >= PUBLISH_INTERVAL_MS) {
        flush();
        return;
      }
      if (timer.current === null) {
        timer.current = window.setTimeout(flush, PUBLISH_INTERVAL_MS - elapsed);
      }
    },
    [flush],
  );

  const targetFor = useCallback(
    (
      path: string,
      extras?: { part?: string; regionId?: string; label?: string },
    ): SemanticTarget =>
      buildTarget({
        typeKey: typeKey ?? "document",
        artifactId: artifactId ?? "",
        path,
        ...extras,
      }),
    [artifactId, typeKey],
  );

  const publish = useCallback(
    (input: PublishInput) => {
      if (!enabled || !actor || !artifactId) return;
      const target = input.target ?? null;
      const next = normalizeInteractionState({
        v: 2,
        actor,
        act: input.act,
        lifecycle: input.lifecycle ?? "active",
        target,
        ...(input.note ? { note: input.note } : {}),
        ...(input.menu !== undefined ? { menu: input.menu } : {}),
        ...(input.dropTarget !== undefined
          ? { dropTarget: input.dropTarget }
          : {}),
        ...(input.provisionalValue !== undefined && target
          ? {
              speculation: {
                sequence: (sequence.current += 1),
                patches: [
                  {
                    path: envelopePointer(target.path),
                    value: input.provisionalValue,
                  },
                ],
              },
            }
          : {}),
        ...(heldKey ? { heldRegionIds: heldKey.split(",") } : {}),
        at: Date.now(),
      });

      // Deduplicate identical frames so an unmoving pointer stops broadcasting.
      const key = [
        next.act.kind,
        JSON.stringify("point" in next.act ? next.act.point : null),
        JSON.stringify("span" in next.act ? next.act.span : null),
        JSON.stringify("at" in next.act ? next.act.at : null),
        targetKey(next.target),
        next.lifecycle,
        next.menu?.highlighted ?? "",
        next.speculation ? String(next.speculation.sequence) : "",
      ].join("~");
      if (key === lastKey.current && !next.speculation) return;
      lastKey.current = key;
      send(next);
    },
    [actor, artifactId, enabled, heldKey, send],
  );

  const publishIdle = useCallback(() => {
    if (!actor) return;
    lastKey.current = "idle";
    send(idleState(actor));
  }, [actor, send]);

  const armIdleDecay = useCallback(() => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(publishIdle, HOVER_IDLE_MS);
  }, [publishIdle]);

  /* ---------------------------------------------------------------- *
   * DOM bindings
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !enabled || !actor || !artifactId || !typeKey) return;

    let frame = 0;
    /** Target currently being dragged or resized, so movement stays attributed. */
    let gesture: { kind: "drag" | "resize"; target: SemanticTarget } | null =
      null;

    const controlFor = (node: EventTarget | null): SemanticTarget | null => {
      if (!(node instanceof Element)) return null;
      const control = node.closest<HTMLElement>(`[${TARGET_ATTRIBUTE}]`);
      if (!control || !surface.contains(control)) return null;
      const path = control.getAttribute(TARGET_ATTRIBUTE);
      if (!path) return null;
      const partNode = node.closest<HTMLElement>(`[${PART_ATTRIBUTE}]`);
      const part =
        partNode && control.contains(partNode)
          ? (partNode.getAttribute(PART_ATTRIBUTE) ?? undefined)
          : undefined;
      return buildTarget({
        typeKey,
        artifactId,
        path: canonicalPath(path),
        ...(part ? { part } : {}),
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        armIdleDecay();

        if (gesture) {
          const over = hitTest(surface, event.clientX, event.clientY);
          const dropTarget =
            over && over.path !== gesture.target.path
              ? buildTarget({ typeKey, artifactId, path: over.path })
              : null;
          publish(
            gesture.kind === "resize"
              ? { act: { kind: "resizeMove" }, target: gesture.target }
              : {
                  act: { kind: "dragMove", at: over?.fraction },
                  target: gesture.target,
                  dropTarget,
                },
          );
          return;
        }

        // Do not overwrite an active caret with a hover frame: a user whose
        // pointer drifts while typing is still typing.
        if (
          document.activeElement &&
          surface.contains(document.activeElement)
        ) {
          const focused = controlFor(document.activeElement);
          if (focused && primitiveHoldsText(focused.primitive)) return;
        }

        const over = hitTest(surface, event.clientX, event.clientY);
        if (!over) {
          publish({ act: { kind: "idle" }, lifecycle: "idle" });
          return;
        }
        publish({
          act: { kind: "hover", at: over.fraction },
          target: buildTarget({
            typeKey,
            artifactId,
            path: over.path,
            ...(over.part ? { part: over.part } : {}),
          }),
        });
      });
    };

    const onPointerLeave = () => {
      if (gesture) return;
      publishIdle();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = controlFor(event.target);
      if (!target) return;
      publishTextState(target, event.target);
    };

    const onFocusOut = (event: FocusEvent) => {
      if (!controlFor(event.target)) return;
      // Leaving a field settles it rather than leaving a caret parked there.
      publish({ act: { kind: "idle" }, lifecycle: "idle" });
    };

    /** Publish caret or selection for a text-bearing control. */
    const publishTextState = (
      target: SemanticTarget,
      node: EventTarget | null,
    ) => {
      if (!primitiveHoldsText(target.primitive)) {
        publish({ act: { kind: "focus" }, target });
        return;
      }
      const points = readTextPoints(node);
      if (!points) {
        publish({ act: { kind: "focus" }, target });
        return;
      }
      if (points.collapsed) {
        publish({ act: { kind: "caret", point: points.anchor }, target });
        return;
      }
      publish({
        act: {
          kind: "select",
          span: { anchor: points.anchor, head: points.head },
        },
        target,
      });
    };

    const onSelectionChange = () => {
      const active = document.activeElement;
      if (!active || !surface.contains(active)) return;
      const target = controlFor(active);
      if (!target) return;
      publishTextState(target, active);
    };

    const onInput = (event: Event) => {
      const node = event.target;
      const target = controlFor(node);
      if (!target) return;
      const value = readValue(node);
      const points = readTextPoints(node);
      publish({
        act: points ? { kind: "type", point: points.head } : { kind: "focus" },
        target,
        // The provisional value travels with the frame: a peer sees the text as
        // it is typed and knows it is not durable yet.
        ...(value !== undefined ? { provisionalValue: value } : {}),
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = controlFor(event.target);
      if (!target) return;

      if (target.part?.startsWith("handle:")) {
        gesture = { kind: "resize", target };
        publish({ act: { kind: "resizeStart" }, target });
        return;
      }
      if (
        target.primitive === "canvasObject" ||
        target.primitive === "timelineEvent"
      ) {
        gesture = { kind: "drag", target };
        publish({ act: { kind: "dragStart" }, target });
        return;
      }
      if (
        target.primitive === "dropdown" ||
        target.primitive === "viewSwitch"
      ) {
        // A native select cannot report its open state, so the honest frame is
        // "this control is being operated", with the menu mirrored on change.
        publish({
          act: { kind: "menuOpen" },
          target,
          menu: menuFor(event.target, target),
        });
        return;
      }
      if (target.primitive === "button") {
        publish({ act: { kind: "press" }, target });
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!gesture) return;
      const finished = gesture;
      gesture = null;
      const over = hitTest(surface, event.clientX, event.clientY);
      publish(
        finished.kind === "resize"
          ? { act: { kind: "resizeRelease" }, target: finished.target }
          : {
              act: { kind: "dragRelease" },
              target: finished.target,
              dropTarget:
                over && over.path !== finished.target.path
                  ? buildTarget({ typeKey, artifactId, path: over.path })
                  : null,
            },
      );
    };

    const onChange = (event: Event) => {
      const node = event.target;
      const target = controlFor(node);
      if (!target) return;
      if (node instanceof HTMLSelectElement) {
        publish({
          act: { kind: "menuSelect", option: node.value },
          target,
          menu: menuFor(node, target),
          provisionalValue: node.value,
        });
        // Close the observed menu immediately afterwards.
        window.setTimeout(
          () => publish({ act: { kind: "menuClose" }, target }),
          140,
        );
        return;
      }
      if (
        node instanceof HTMLInputElement &&
        (node.type === "checkbox" || node.type === "radio")
      ) {
        publish({
          act: { kind: "toggle", value: node.checked },
          target,
          provisionalValue: node.checked,
        });
        return;
      }
      const value = readValue(node);
      if (value !== undefined) {
        publish({ act: { kind: "focus" }, target, provisionalValue: value });
      }
    };

    const onDragStart = (event: DragEvent) => {
      const target = controlFor(event.target);
      if (!target) return;
      gesture = { kind: "drag", target };
      publish({ act: { kind: "dragStart" }, target });
    };

    const onDragOver = (event: DragEvent) => {
      if (!gesture) return;
      const over = hitTest(surface, event.clientX, event.clientY);
      publish({
        act: { kind: "dragMove", at: over?.fraction },
        target: gesture.target,
        dropTarget:
          over && over.path !== gesture.target.path
            ? buildTarget({ typeKey, artifactId, path: over.path })
            : null,
      });
    };

    const onDragEnd = () => {
      if (!gesture) return;
      const finished = gesture;
      gesture = null;
      publish({ act: { kind: "dragRelease" }, target: finished.target });
    };

    surface.addEventListener("pointermove", onPointerMove, { passive: true });
    surface.addEventListener("pointerleave", onPointerLeave);
    surface.addEventListener("pointerdown", onPointerDown, { passive: true });
    surface.addEventListener("focusin", onFocusIn);
    surface.addEventListener("focusout", onFocusOut);
    surface.addEventListener("input", onInput);
    surface.addEventListener("change", onChange);
    surface.addEventListener("dragstart", onDragStart);
    surface.addEventListener("dragover", onDragOver);
    surface.addEventListener("dragend", onDragEnd);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerleave", onPointerLeave);
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("focusin", onFocusIn);
      surface.removeEventListener("focusout", onFocusOut);
      surface.removeEventListener("input", onInput);
      surface.removeEventListener("change", onChange);
      surface.removeEventListener("dragstart", onDragStart);
      surface.removeEventListener("dragover", onDragOver);
      surface.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("pointerup", onPointerUp);
      // Leaving the editor must clear presence, never leave a ghost behind.
      onPublish(null);
    };
  }, [
    actor,
    artifactId,
    armIdleDecay,
    enabled,
    onPublish,
    publish,
    publishIdle,
    surfaceRef,
    typeKey,
  ]);

  return { publish, publishIdle, targetFor };
}

/* ------------------------------------------------------------------ *
 * DOM readers
 * ------------------------------------------------------------------ */

function readValue(node: EventTarget | null): unknown {
  if (node instanceof HTMLInputElement) {
    if (node.type === "checkbox" || node.type === "radio") return node.checked;
    if (node.type === "number") {
      const parsed = Number(node.value);
      return Number.isFinite(parsed) ? parsed : node.value;
    }
    return node.value;
  }
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)
    return node.value;
  if (node instanceof HTMLElement && node.isContentEditable)
    return node.textContent ?? "";
  return undefined;
}

function menuFor(
  node: EventTarget | null,
  target: SemanticTarget,
): MenuObservation | null {
  if (!(node instanceof HTMLSelectElement)) return null;
  const options = Array.from(node.options)
    .slice(0, 24)
    .map((option) => ({
      value: option.value,
      label: option.label || option.value,
    }));
  if (!options.length) return null;
  return {
    label: target.label ?? node.getAttribute("aria-label") ?? "Options",
    options,
    highlighted: node.value,
  };
}

/**
 * Read the caret or selection from whatever kind of text host this is. Form
 * fields expose offsets directly; contenteditable requires walking text nodes so
 * the offset matches what a peer's Range can resolve.
 */
function readTextPoints(
  node: EventTarget | null,
): { anchor: TextPoint; head: TextPoint; collapsed: boolean } | null {
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    const start = node.selectionStart ?? 0;
    const end = node.selectionEnd ?? start;
    const value = node.value ?? "";
    const point = (offset: number): TextPoint => {
      if (!value.includes("\n")) return { offset };
      const before = value.slice(0, offset).split("\n");
      return {
        offset: before[before.length - 1]!.length,
        line: before.length - 1,
      };
    };
    return {
      anchor: point(start),
      head: point(end),
      collapsed: start === end,
    };
  }

  if (!(node instanceof HTMLElement) || !node.isContentEditable) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!node.contains(range.startContainer)) return null;

  const offsetOf = (container: Node, offset: number): number => {
    let consumed = 0;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      if (current === container) return consumed + offset;
      consumed += (current as Text).data.length;
      current = walker.nextNode();
    }
    return consumed;
  };

  const anchor = offsetOf(range.startContainer, range.startOffset);
  const head = offsetOf(range.endContainer, range.endOffset);
  return {
    anchor: { offset: anchor },
    head: { offset: head },
    collapsed: range.collapsed,
  };
}
