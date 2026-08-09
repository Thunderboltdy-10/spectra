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
import { onStoryFrame } from "./story-clock";
import { statesAt, type Beat } from "./beats";
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
