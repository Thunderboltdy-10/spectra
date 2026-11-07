"use client";

import { useEffect, useState } from "react";

const SETTLE_MS = 5_000;

const interrupted = (state: string) =>
  state === "reconnecting" || state === "unsynchronized";

/**
 * A socket that drops and returns within a few seconds is normal life on any
 * network and nothing to tell anyone about. An interruption only counts once it
 * has lasted; recovery shows immediately.
 */
export function useSettledTransportState<State extends string>(state: State): State {
  const [settled, setSettled] = useState(state);
  useEffect(() => {
    if (!interrupted(state)) {
      setSettled(state);
      return;
    }
    const timer = setTimeout(() => setSettled(state), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [state]);
  return interrupted(state) ? settled : state;
}
