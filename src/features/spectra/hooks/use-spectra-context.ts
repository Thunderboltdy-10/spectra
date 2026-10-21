"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type SetStateAction,
} from "react";
import { toast } from "@/components/ui/toast";
import {
  useSpectraContextStore,
  type SpectraContextObject,
  type SpectraContinuation,
} from "@/stores/spectra-context-store";
import type { SpectraRunPointer } from "../ai/use-spectra-run";
import {
  getSpectraThread,
  getSpectraThreads,
  postSpectra,
  type SpectraArtifact,
  type SpectraThread,
  type SpectraWorkspace,
} from "../data/api";
import { spectraBus } from "../events";

export function useSpectraContext(
  artifacts: SpectraArtifact[],
  workspaces: SpectraWorkspace[] = [],
) {
  const [threads, setThreads] = useState<SpectraThread[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const continuation = useSpectraContextStore((state) => state.continuation);
  const selectionDraft = useSpectraContextStore(
    (state) => state.selectionDraft,
  );
  const visible = useSpectraContextStore((state) => state.visible);
  const setContinuation = useSpectraContextStore(
    (state) => state.setContinuation,
  );
  const setSelectionDraft = useSpectraContextStore(
    (state) => state.setSelectionDraft,
  );
  const toggleSelection = useSpectraContextStore(
    (state) => state.toggleSelection,
  );
  const clearSelection = useSpectraContextStore(
    (state) => state.clearSelection,
  );
  const setVisible = useSpectraContextStore((state) => state.setVisible);
  const reconcile = useSpectraContextStore((state) => state.reconcile);
  const setActiveWorkspace = useSpectraContextStore(
    (state) => state.setActiveWorkspace,
  );

  const artifactById = useMemo(
    () => new Map(artifacts.map((artifact) => [artifact._id, artifact])),
    [artifacts],
  );
  const selectedContextIds = useMemo(
    () =>
      new Set(
        selectionDraft
          .filter((row) => row.type === "artifact")
          .map((row) => row.id),
      ),
    [selectionDraft],
  );
  const selectedObjectKeys = useMemo(
    () =>
      new Set(selectionDraft.map((row) => `${row.type}:${row.id}`)),
    [selectionDraft],
  );

  /*
   * What is open on screen, as pointers for the run's environment block: id,
   * type and title only. The continued conversation is the run's own thread,
   * so it is not listed again.
   */
  const open = useMemo<SpectraRunPointer[]>(() => {
    const seen = new Set<string>();
    return visible.flatMap((item) => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key) || (item.type === "thread" && item.id === continuation?.id)) return [];
      seen.add(key);
      const type = item.type === "artifact" ? (artifactById.get(item.id)?.blueprintKey ?? "artifact") : item.type;
      return [{ id: item.id, type, title: item.label }];
    });
  }, [artifactById, continuation?.id, visible]);

  /*
   * Picks work by id. Work the loaded overview does not hold (a shelf shows the
   * whole tree) is kept by its row already in the selection, or named by
   * `named`, so it can be picked like any other.
   */
  const setSelectedContextIds = useCallback(
    (action: SetStateAction<Set<string>>, named?: ReadonlyMap<string, string>) => {
      // The selection as it is now, not as it was at the last render: picks in quick succession all count.
      const draft = useSpectraContextStore.getState().selectionDraft;
      const next =
        typeof action === "function"
          ? action(new Set(draft.filter((row) => row.type === "artifact").map((row) => row.id)))
          : action;
      setSelectionDraft(
        [...next].flatMap<SpectraContextObject>((id) => {
          const artifact = artifactById.get(id);
          if (!artifact) {
            const kept = draft.find((row) => row.type === "artifact" && row.id === id);
            const label = kept?.label ?? named?.get(id);
            return label ? [{ type: "artifact" as const, id, label, source: "selected" as const, capability: "tile" as const }] : [];
          }
          return [
            {
              type: "artifact" as const,
              id,
              label: artifact.title,
              workspaceId: artifact.placements?.[0]?.workspaceId,
              source: "selected" as const,
              capability:
                artifact.blueprintKey === "thread_reference"
                  ? ("context" as const)
                  : ("tile" as const),
            },
          ];
        }),
      );
    },
    [artifactById, setSelectionDraft],
  );

  const setComposerThread = useCallback(
    (action: SetStateAction<SpectraContinuation | null>) => {
      const next = typeof action === "function" ? action(continuation) : action;
      setContinuation(next);
      if (!next?.runId && !next?.id) return;
      void postSpectra({
        action: "selectRunTab",
        ...(next.runId ? { runId: next.runId } : { threadId: next.id }),
      }).catch(() => undefined);
    },
    [continuation, setContinuation],
  );

  const setVisibleArtifactIds = useCallback(
    (ids: string[]) => {
      setVisible(
        ids.flatMap((id) => {
          const artifact = artifactById.get(id);
          return artifact
            ? [
                {
                  type: "artifact" as const,
                  id,
                  label: artifact.title,
                  workspaceId: artifact.placements?.[0]?.workspaceId,
                  source: "visible" as const,
                  capability:
                    artifact.blueprintKey === "thread_reference"
                      ? ("context" as const)
                      : ("tile" as const),
                },
              ]
            : [];
        }),
      );
    },
    [artifactById, setVisible],
  );

  const setVisibleObjects = useCallback(
    (objects: SpectraContextObject[]) => {
      setVisible(objects.map((object) => ({ ...object, source: "visible" })));
    },
    [setVisible],
  );

  const toggleSelectedObject = useCallback(
    (object: SpectraContextObject, cap = 24) =>
      toggleSelection({ ...object, source: "selected" }, cap),
    [toggleSelection],
  );

  useEffect(() => {
    let disposed = false;
    void getSpectraThreads({ brief: true })
      .then((value) => {
        if (!disposed) {
          setThreads(value.threads);
          setThreadsLoaded(true);
        }
      })
      .catch(() => undefined);
    const refresh = () =>
      void getSpectraThreads({ brief: true })
        .then((value) => {
          if (!disposed) {
            setThreads(value.threads);
            setThreadsLoaded(true);
          }
        })
        .catch(() => undefined);
    const removeChanged = spectraBus.on("threads.changed", refresh);
    return () => {
      disposed = true;
      removeChanged();
    };
  }, []);

  useEffect(() => {
    reconcile([
      ...artifacts.map((artifact) => ({
        type: "artifact" as const,
        id: artifact._id,
        label: artifact.title,
        workspaceId: artifact.placements?.[0]?.workspaceId,
      })),
      ...workspaces.map((workspace) => ({
        type: "workspace" as const,
        id: workspace._id,
        label: workspace.title,
      })),
      ...threads.map((thread) => ({
        type: "thread" as const,
        id: thread._id,
        label: thread.title,
        workspaceId: thread.workspaceId,
      })),
    ], { completeTypes: ["workspace"] });
    if (
      continuation &&
      threadsLoaded &&
      !threads.some((thread) => thread._id === continuation.id)
    ) {
      // The durable run tab can learn about a just-created thread before the
      // independently refreshed thread index does. Confirm against the
      // canonical endpoint before treating that short propagation window as
      // deletion, otherwise a valid completed run is immediately deselected.
      const expectedId = continuation.id;
      void getSpectraThread(expectedId)
        .then((value) => {
          setThreads((current) =>
            current.some((row) => row._id === value.thread._id)
              ? current
              : [value.thread, ...current],
          );
        })
        .catch(() => {
          if (useSpectraContextStore.getState().continuation?.id !== expectedId)
            return;
          setContinuation(null);
          toast.message(
            "That conversation is no longer available. Your next message will start a new thread.",
          );
        });
    } else if (continuation) {
      const currentThread = threads.find(
        (thread) => thread._id === continuation.id,
      );
      if (
        currentThread &&
        (currentThread.title !== continuation.title ||
          currentThread.workspaceId !== continuation.workspaceId)
      )
        setContinuation({
          ...continuation,
          title: currentThread.title,
          workspaceId: currentThread.workspaceId,
        });
    }
  }, [
    artifacts,
    continuation,
    reconcile,
    setContinuation,
    threads,
    threadsLoaded,
    workspaces,
  ]);

  return {
    composerThread: continuation,
    setComposerThread,
    selectedContextIds,
    selectedObjectKeys,
    selectionCount: selectionDraft.length,
    open,
    setSelectedContextIds,
    toggleSelectedObject,
    clearDraftSelection: clearSelection,
    setVisibleArtifactIds,
    setVisibleObjects,
    setActiveWorkspaceContext: setActiveWorkspace,
  };
}
