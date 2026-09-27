"use client";

import { useAction, useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import type { Id } from "../../../../convex/_generated/dataModel";

type PlacementResult = {
  status: "proven" | "unavailable" | "stale" | "needs_checkpoint";
  headHash?: string;
};
type RefreshState = {
  state: "idle" | "checking" | PlacementResult["status"] | "failed";
  key?: string;
};
type Entry = {
  snapshot: RefreshState;
  listeners: Set<() => void>;
  pending?: Promise<void>;
};
const IDLE: RefreshState = { state: "idle" };
const refreshAction = makeFunctionReference<
  "action",
  { embedId: Id<"artifactEmbeds"> },
  PlacementResult
>("artifactEmbedPlacementActions:refresh");

/** Share work only while the same client's readers are mounted. These entries
 * contain placement status, never source data or an authority decision. */
class PlacementRefreshes {
  private entries = new Map<string, Entry>();

  private entry(embedId: string) {
    let entry = this.entries.get(embedId);
    if (!entry) {
      entry = { snapshot: IDLE, listeners: new Set() };
      this.entries.set(embedId, entry);
    }
    return entry;
  }

  subscribe(embedId: string, listener: () => void) {
    const entry = this.entry(embedId);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size && !entry.pending) this.entries.delete(embedId);
    };
  }

  snapshot(embedId: string) {
    return this.entries.get(embedId)?.snapshot ?? IDLE;
  }

  refresh(
    embedId: string,
    key: string,
    run: () => Promise<PlacementResult>,
    explicit = false,
  ) {
    const entry = this.entry(embedId);
    if (entry.pending || (!explicit && entry.snapshot.key === key)) return;
    const publish = (snapshot: RefreshState) => {
      entry.snapshot = snapshot;
      entry.listeners.forEach((listener) => listener());
    };
    // Assign ownership before invoking the action or notifying another reader.
    entry.pending = Promise.resolve()
      .then(run)
      .then(
        (result) => publish({ key, state: result.status }),
        () => publish({ key, state: "failed" }),
      )
      .finally(() => {
        entry.pending = undefined;
        if (!entry.listeners.size) this.entries.delete(embedId);
      });
    publish({ key, state: "checking" });
  }
}

const clients = new WeakMap<object, PlacementRefreshes>();
function refreshesFor(client: object) {
  let refreshes = clients.get(client);
  if (!refreshes) {
    refreshes = new PlacementRefreshes();
    clients.set(client, refreshes);
  }
  return refreshes;
}

export function RetainedPinRecovery({
  embedId,
  refreshKey,
}: {
  embedId: string;
  refreshKey: string;
}) {
  const client = useConvex();
  const refresh = useAction(refreshAction);
  const refreshes = useMemo(() => refreshesFor(client), [client]);
  const subscribe = useCallback(
    (listener: () => void) => refreshes.subscribe(embedId, listener),
    [embedId, refreshes],
  );
  const getSnapshot = useCallback(
    () => refreshes.snapshot(embedId),
    [embedId, refreshes],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, () => IDLE);
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    setVisible(false);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.01 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [embedId]);

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const run = useCallback(
    (explicit = false) => {
      refreshes.refresh(
        embedId,
        refreshKey,
        () => refresh({ embedId: embedId as Id<"artifactEmbeds"> }),
        explicit,
      );
    },
    [embedId, refreshKey, refresh, refreshes],
  );

  useEffect(() => {
    if (
      !visible ||
      !pageVisible ||
      state.state === "checking" ||
      state.key === refreshKey
    )
      return;
    // Acknowledged edits change the proof head. Wait for a settled head, and
    // never start another reconstruction while one is already in flight.
    const timer = setTimeout(() => run(), 750);
    return () => clearTimeout(timer);
  }, [visible, pageVisible, refreshKey, state, run]);

  const currentState =
    state.key === refreshKey
      ? state.state
      : state.state === "checking"
        ? "checking"
        : "idle";
  const detail = {
    idle: "Checking this saved placement when it is visible.",
    checking: "Checking this saved placement…",
    proven: "Placement verified. Loading the pinned version…",
    stale:
      "The surrounding work changed during verification. Retry after editing settles.",
    unavailable:
      "This placement could not be verified. The retained version is still kept.",
    needs_checkpoint:
      "This work needs a saved checkpoint before its placement can be verified. The retained version is still kept.",
    failed:
      "The placement check could not finish. The retained version is still kept; you can retry.",
  }[currentState];

  return (
    <div ref={root} className="mt-2 flex flex-wrap items-center gap-2">
      <p role="status" className="text-micro text-[var(--text-secondary)]">
        {detail}
      </p>
      {currentState !== "idle" && currentState !== "checking" ? (
        <Button size="sm" onClick={() => run(true)}>
          Retry placement check
        </Button>
      ) : null}
    </div>
  );
}
