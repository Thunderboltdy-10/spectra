"use client";

/**
 * Beats to presence, at the right cadence.
 *
 * The presence layer is a real React component and it runs its own measurement
 * loop, so handing it a fresh array sixty times a second would restart that
 * loop every frame. Instead this watches the *semantic* shape of the story —
 * who is acting, on what, in what lifecycle, at which character offset — and
 * publishes only when that changes. A typed headline updates once per
 * character, a drag a handful of times, a hold not at all.
 *
 * Everything else about the actors (where they are, how they travel, whether
 * they are leaving) is resolved from live DOM by the presence layer itself.
 */

import { useEffect, useState } from "react";
import type { InteractionState } from "@/features/spectra/collaboration/interaction-model";
import {
  TERMINAL_LIFECYCLES,
  canonicalPath,
  presenceColor,
} from "@/features/spectra/collaboration/interaction-model";
import { TARGET_ATTRIBUTE } from "@/features/spectra/collaboration/interaction-geometry";
import { resolveColor } from "@/features/spectra/field/grain-renderer";
import { onStoryFrame } from "./story-clock";
import { statesAt, type Beat } from "./beats";
import { clearStoryActor, storyActor } from "../field/story-actor";
import type { SceneId } from "./timeline";

const EMPTY: InteractionState[] = [];

/**
 * Bucketed clock. The presence layer treats a state as stale after a few
 * seconds, so it needs a value that keeps up with real time — but one that
 * changes on a coarse grid, or every frame would look like a new state.
 */
const CLOCK_BUCKET_MS = 1_000;

function signatureOf(states: readonly InteractionState[]): string {
  let out = "";
  for (const state of states) {
    out += `${state.actor.clientId}|${state.act.kind}|${state.lifecycle}|${
      state.target?.path ?? ""
    }|${state.target?.part ?? ""}|${
      "point" in state.act ? (state.act.point?.offset ?? "") : ""
    }|${
      "span" in state.act
        ? `${state.act.span?.anchor.offset ?? ""}-${state.act.span?.head.offset ?? ""}`
        : ""
    }|${state.note ?? ""};`;
  }
  return out;
}

/**
 * Presence for the whole story, gathered in one place.
 *
 * The landing has one presence layer, not one per scene: three actors move
 * across the canvas and the layer is what gives them continuity. Each scene
 * registers its beats and this resolves whichever scene the camera is in.
 *
 * Actors only exist while the camera is in their scene. A scene the camera has
 * already passed keeps its authored text — that work was done — but publishes
 * nobody: those people moved on.
 */
export function useStoryPresence(
  beatsByScene: Partial<Record<SceneId, readonly Beat[]>>,
): readonly InteractionState[] {
  const [states, setStates] = useState<readonly InteractionState[]>(EMPTY);

  useEffect(() => {
    let signature = "";
    return onStoryFrame((frame) => {
      const beats = beatsByScene[frame.scene];
      if (!beats?.length) {
        if (signature !== "") {
          signature = "";
          setStates(EMPTY);
        }
        return;
      }
      const bucket =
        Math.floor(Date.now() / CLOCK_BUCKET_MS) * CLOCK_BUCKET_MS;
      const next = statesAt(beats, frame.t, bucket);
      const nextSignature = signatureOf(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      setStates(next);
    });
  }, [beatsByScene]);

  return states;
}

/* ------------------------------------------------------------------ *
 * The field's actor wake
 * ------------------------------------------------------------------ */

/** How far the pool reaches around a target, relative to the target's size. */
const WAKE_REACH = 1.15;
const WAKE_MIN_R = 220;
const WAKE_MAX_R = 620;

/** Frames between attempts to find a target that is not currently mounted. */
const LOOKUP_FRAMES = 12;

/**
 * Colour lookups are three canvas reads and a `getComputedStyle`; the actor set
 * on this page is three people. Resolving once per identity is the difference
 * between free and measurable.
 */
const inkByActor = new Map<string, readonly [number, number, number]>();

function colorFor(state: InteractionState): readonly [number, number, number] {
  const key = state.actor.clientId;
  let ink = inkByActor.get(key);
  if (!ink) {
    ink = resolveColor(presenceColor(state.actor));
    inkByActor.set(key, ink);
  }
  return ink;
}

/**
 * Publish the acting actor's position to the field.
 *
 * The field gathers where work is happening, so it needs one thing the presence
 * layer does not export: where, in viewport pixels, the current act is landing.
 * This resolves that from the same annotated DOM the presence layer reads, in
 * the clock's measure phase, so the field paints it in the same frame rather
 * than one behind.
 *
 * Only the *foremost* act counts. Three cursors would average out to the middle
 * of the page, which is exactly the uniform wash the field is trying not to be.
 */
export function useStoryActorField(states: readonly InteractionState[]) {
  useEffect(() => {
    const acting = states.filter(
      (state) => state.target && !TERMINAL_LIFECYCLES.has(state.lifecycle),
    );
    if (!acting.length) {
      clearStoryActor();
      return;
    }

    /* An AI writing a headline is the more interesting subject than a human
       resting a cursor, so it wins the field when both are live. */
    const lead =
      acting.find((state) => state.actor.kind === "ai") ?? acting[0]!;
    const path = canonicalPath(lead.target!.path);
    const ink = colorFor(lead);

    let node: HTMLElement | null = null;
    let sinceLookup = LOOKUP_FRAMES;

    return onStoryFrame(() => {
      /* Re-querying is cheap but not free, and the node under a path only
         changes when a scene mounts. A few times a second is plenty. */
      if (!node?.isConnected && ++sinceLookup >= LOOKUP_FRAMES) {
        sinceLookup = 0;
        node = document.querySelector<HTMLElement>(
          `[${TARGET_ATTRIBUTE}="${CSS.escape(path)}"]`,
        );
      }
      if (!node) {
        storyActor.strength = 0;
        return;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) {
        storyActor.strength = 0;
        return;
      }
      storyActor.x = rect.left + rect.width / 2;
      storyActor.y = rect.top + rect.height / 2;
      storyActor.radius = Math.min(
        WAKE_MAX_R,
        Math.max(WAKE_MIN_R, Math.max(rect.width, rect.height) * WAKE_REACH),
      );
      storyActor.color = ink;
      /* Off-screen work does not disturb the field. The wake fades over the
         viewport edge instead of clipping, which is what stops the pool from
         snapping as the camera passes a scene. */
      const above = -rect.bottom;
      const below = rect.top - window.innerHeight;
      const off = Math.max(above, below, 0);
      storyActor.strength = 0.34 * Math.max(0, 1 - off / 320);
    }, "measure");
  }, [states]);
}
