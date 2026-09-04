"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  activeArtifactContext,
  useSpectraContextStore,
  type SpectraContextObject,
  type SpectraContinuation,
} from "@/stores/spectra-context-store";
import {
  getSpectraArtifact,
  getSpectraThread,
  getSpectraThreads,
  getSpectraWorkspace,
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
  const availabilityChecks = useRef(new Map<string, number>());
  const continuation = useSpectraContextStore((state) => state.continuation);
  const selectionDraft = useSpectraContextStore(
    (state) => state.selectionDraft,
  );
  const explicit = useSpectraContextStore((state) => state.explicit);
  const visible = useSpectraContextStore((state) => state.visible);
  const excludedVisibleKeys = useSpectraContextStore(
    (state) => state.excludedVisibleKeys,
  );
  const setContinuation = useSpectraContextStore(
    (state) => state.setContinuation,
  );
  const setSelectionDraft = useSpectraContextStore(
    (state) => state.setSelectionDraft,
  );
  const toggleSelection = useSpectraContextStore(
    (state) => state.toggleSelection,
  );
  const commitSelection = useSpectraContextStore(
    (state) => state.commitSelection,
  );
  const clearSelection = useSpectraContextStore(
    (state) => state.clearSelection,
  );
  const clearExplicit = useSpectraContextStore((state) => state.clearExplicit);
  const addExplicit = useSpectraContextStore((state) => state.addExplicit);
  const removeExplicit = useSpectraContextStore(
    (state) => state.removeExplicit,
  );
  const setVisible = useSpectraContextStore((state) => state.setVisible);
  const reconcile = useSpectraContextStore((state) => state.reconcile);
  const setActiveWorkspace = useSpectraContextStore(
    (state) => state.setActiveWorkspace,
  );
  const setObjectAvailability = useSpectraContextStore(
    (state) => state.setObjectAvailability,
  );

  const artifactById = useMemo(
    () => new Map(artifacts.map((artifact) => [artifact._id, artifact])),
    [artifacts],
  );
  const selectedContextIds = useMemo(
    () =>
      new Set(
        selectionDraft
          .filter((row) => row.type === "artifact" && !row.stale)
          .map((row) => row.id),
      ),
    [selectionDraft],
  );
  const selectedObjectKeys = useMemo(
    () =>
      new Set(
        selectionDraft
          .filter((row) => !row.stale)
          .map((row) => `${row.type}:${row.id}`),
      ),
    [selectionDraft],
  );
  const explicitContextIds = useMemo(
    () =>
      new Set(
        explicit
          .filter((row) => row.type === "artifact" && !row.stale)
          .map((row) => row.id),
      ),
    [explicit],
  );
  const explicitContextObjectKeys = useMemo(
    () =>
      new Set(
        explicit
          .filter((row) => !row.stale)
          .map((row) => `${row.type}:${row.id}`),
      ),
    [explicit],
  );
  const contextArtifactIds = useMemo(
    () => activeArtifactContext({ explicit, visible, excludedVisibleKeys }),
    [excludedVisibleKeys, explicit, visible],
  );

  const setSelectedContextIds = useCallback(
    (action: SetStateAction<Set<string>>) => {
      const next =
        typeof action === "function"
          ? action(new Set(selectedContextIds))
          : action;
      setSelectionDraft(
        [...next].flatMap((id) => {
          const artifact = artifactById.get(id);
          return artifact
            ? [
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
              ]
            : [];
        }),
      );
    },
    [artifactById, selectedContextIds, setSelectionDraft],
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

  const toggleExplicitObject = useCallback(
    (object: SpectraContextObject) => {
      if (
        explicit.some((row) => row.type === object.type && row.id === object.id)
      )
        removeExplicit(object.type, object.id);
      else addExplicit({ ...object, source: "explicit" });
    },
    [addExplicit, explicit, removeExplicit],
  );

  const toggleExplicitArtifact = useCallback(
    (artifact: SpectraArtifact) => {
      if (explicitContextIds.has(artifact._id))
        removeExplicit("artifact", artifact._id);
      else
        addExplicit({
          type: "artifact",
          id: artifact._id,
          label: artifact.title,
          workspaceId: artifact.placements?.[0]?.workspaceId,
          source: "explicit",
          capability:
            artifact.blueprintKey === "thread_reference" ? "context" : "tile",
        });
    },
    [addExplicit, explicitContextIds, removeExplicit],
  );

  useEffect(() => {
    let disposed = false;
    void getSpectraThreads()
      .then((value) => {
        if (!disposed) {
          setThreads(value.threads);
          setThreadsLoaded(true);
        }
      })
      .catch(() => undefined);
    const refresh = () =>
      void getSpectraThreads()
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

  useEffect(() => {
    if (!threadsLoaded) return;
    const artifactIds = new Set(artifacts.map((artifact) => artifact._id));
    const workspaceIds = new Set(workspaces.map((workspace) => workspace._id));
    const threadIds = new Set(threads.map((thread) => thread._id));
    const now = Date.now();
    const missing = explicit.filter((item) => {
      // A confirmed-missing explicit item remains visible as stale context so
      // the user can understand and remove it. Do not keep hammering the
      // canonical endpoint after that determination has been made.
      if (item.stale) return false;
      const absent =
        item.type === "artifact"
          ? !artifactIds.has(item.id)
          : item.type === "workspace"
            ? !workspaceIds.has(item.id)
            : !threadIds.has(item.id);
      return (
        absent &&
        now - (availabilityChecks.current.get(`${item.type}:${item.id}`) ?? 0) >
          30_000
      );
    });
    if (missing.length === 0) return;
    let disposed = false;
    void Promise.all(
      missing.map(async (item) => {
        availabilityChecks.current.set(`${item.type}:${item.id}`, Date.now());
        try {
          if (item.type === "artifact") {
            const { artifact } = await getSpectraArtifact(item.id);
            if (!disposed)
              setObjectAvailability("artifact", item.id, {
                label: artifact.title,
                workspaceId: artifact.placements?.[0]?.workspaceId,
              });
          } else if (item.type === "workspace") {
            const detail = await getSpectraWorkspace(item.id, true);
            if (!detail.workspace) throw new Error("Workspace unavailable");
            if (!disposed)
              setObjectAvailability("workspace", item.id, {
                label: detail.workspace.workspace.title,
              });
          } else {
            const detail = await getSpectraThread(item.id);
            if (!disposed)
              setObjectAvailability("thread", item.id, {
                label: detail.thread.title,
                workspaceId: detail.thread.workspaceId,
              });
          }
        } catch {
          if (!disposed) setObjectAvailability(item.type, item.id);
        }
      }),
    );
    return () => {
      disposed = true;
    };
  }, [
    artifacts,
    explicit,
    setObjectAvailability,
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
    explicitContextIds,
    explicitContextObjectKeys,
    explicitContextObjects: explicit
      .filter((object) => !object.stale)
      .map(
        ({
          type,
          id,
          label,
          workspaceId,
          semanticTargetId,
          semanticAnchor,
          contextSummary,
        }) => ({
          type,
          id,
          label,
          workspaceId,
          semanticTargetId,
          semanticAnchor,
          contextSummary,
        }),
      ),
    contextArtifactIds,
    setSelectedContextIds,
    toggleSelectedObject,
    commitSelection,
    clearDraftSelection: clearSelection,
    clearExplicitContext: clearExplicit,
    toggleExplicitArtifact,
    toggleExplicitObject,
    setVisibleArtifactIds,
    setVisibleObjects,
    setActiveWorkspaceContext: setActiveWorkspace,
  };
}
