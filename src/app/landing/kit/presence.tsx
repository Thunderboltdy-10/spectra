"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { InteractionLayer } from "@/features/spectra/components/presence/interaction-layer";
import type {
  ControlPrimitive,
  InteractionAct,
  InteractionState,
} from "@/features/spectra/collaboration/interaction-model";
import { SURFACE_ATTRIBUTE } from "@/features/spectra/collaboration/interaction-geometry";
import { CAST, type CastId } from "../world/story";

/*
 * The people on the page. Henry, Ms Gonzalez and their AIs are ordinary
 * Spectra collaborators: each is an interaction state handed to the real
 * presence layer, which finds the control by its target, moves the cursor the
 * way it moves for anyone, and labels it the way the product does ("Henry's
 * AI"). A section says who does what; the layer does the rest.
 */

export type Move = {
  path: string;
  primitive: ControlPrimitive;
  act?: InteractionAct;
  label?: string;
  note?: string;
  part?: string;
};

/** Keeps a state fresh: the layer lets a silent collaborator go after 20 seconds. */
const REFRESH_MS = 8_000;

export function usePresence(surface: string) {
  const [states, setStates] = useState<Map<CastId, InteractionState>>(
    () => new Map(),
  );
  const statesRef = useRef(states);
  statesRef.current = states;

  const move = useCallback(
    (who: CastId, to: Move) => {
      setStates((current) => {
        const next = new Map(current);
        next.set(who, {
          v: 2,
          actor: CAST[who],
          act: to.act ?? { kind: "hover" },
          lifecycle: "active",
          target: {
            artifactId: surface,
            path: to.path,
            primitive: to.primitive,
            label: to.label,
            part: to.part,
          },
          note: to.note,
          at: Date.now(),
        });
        return next;
      });
    },
    [surface],
  );

  const leave = useCallback((who?: CastId) => {
    setStates((current) => {
      if (!who) return current.size ? new Map() : current;
      if (!current.has(who)) return current;
      const next = new Map(current);
      next.delete(who);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!states.size) return;
    const timer = window.setInterval(() => {
      setStates((current) => {
        const next = new Map<CastId, InteractionState>();
        for (const [who, state] of current)
          next.set(who, { ...state, at: Date.now() });
        return next;
      });
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [states.size]);

  const list = useMemo(() => [...states.values()], [states]);
  return { states: list, move, leave };
}

/** A surface people work on: the presence layer resolves targets inside it. */
export function Surface({
  id,
  states,
  className,
  children,
}: {
  id: string;
  states: readonly InteractionState[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      {...{ [SURFACE_ATTRIBUTE]: id }}
      className={className}
      style={{ position: "relative" }}
    >
      {children}
      <InteractionLayer states={states} anchor="static" />
    </div>
  );
}
