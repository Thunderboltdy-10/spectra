import type { SpectraStreamEvent } from "./stream-events";

/*
 * A page has several run engines (the island, the open thread, the shell), and
 * one of them holds the run's live stream. The others read it here instead of
 * asking the server for what this page already received. The buffer lets one
 * that mounts mid-run catch up, and it goes when the stream closes.
 */

type LocalRunStream = { origin: object; events: SpectraStreamEvent[] };
type Listener = (runId: string, closed: boolean) => void;

const streams = new Map<string, LocalRunStream>();
const listeners = new Set<Listener>();

export function localRunStream(runId: string) {
  return streams.get(runId) ?? null;
}

export function publishLocalRunEvent(origin: object, runId: string, event: SpectraStreamEvent) {
  const stream = streams.get(runId) ?? { origin, events: [] };
  streams.set(runId, stream);
  stream.events.push(event);
  listeners.forEach((listener) => listener(runId, false));
}

export function closeLocalRunStream(runId: string) {
  if (!streams.has(runId)) return;
  listeners.forEach((listener) => listener(runId, true));
  streams.delete(runId);
}

export function subscribeLocalRunStreams(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
