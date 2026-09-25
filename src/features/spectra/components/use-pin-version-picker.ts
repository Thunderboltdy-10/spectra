"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSpectraArtifactVersions,
  type SpectraArtifactVersionSummary,
} from "../data/api";

type PickerState = {
  sourceId: string;
  versions: SpectraArtifactVersionSummary[];
  selectedId: string;
  cursor: string | null;
  isDone: boolean;
  loading: boolean;
  error: string | null;
};

function emptyState(sourceId = ""): PickerState {
  return {
    sourceId,
    versions: [],
    selectedId: "",
    cursor: null,
    isDone: false,
    loading: false,
    error: null,
  };
}

/** Metadata only. A response can affect only the source/request that owns it. */
export function usePinVersionPicker(sourceId: string, enabled: boolean) {
  const [state, setState] = useState<PickerState>(() => emptyState());
  const requestRef = useRef<AbortController | null>(null);

  const requestPage = useCallback(
    async (cursor?: string) => {
      if (!enabled || !sourceId || requestRef.current) return;
      const request = new AbortController();
      requestRef.current = request;
      setState((current) => ({
        ...(current.sourceId === sourceId ? current : emptyState(sourceId)),
        loading: true,
        error: null,
      }));
      try {
        const page = await getSpectraArtifactVersions(
          sourceId,
          20,
          cursor,
          request.signal,
        );
        if (request.signal.aborted || requestRef.current !== request) return;
        if (
          page.versions.some((version) => version.artifactId !== sourceId) ||
          (!page.isDone &&
            (!page.continueCursor || page.continueCursor === cursor))
        )
          throw new Error("The saved versions could not be loaded. Try again.");
        setState((current) => {
          if (current.sourceId !== sourceId) return current;
          const versions = cursor ? [...current.versions] : [];
          const ids = new Set(versions.map((version) => version._id));
          for (const version of page.versions) {
            if (!ids.has(version._id)) {
              versions.push(version);
              ids.add(version._id);
            }
          }
          return {
            ...current,
            versions,
            selectedId:
              (cursor && current.selectedId) || versions[0]?._id || "",
            cursor: page.continueCursor,
            isDone: page.isDone,
            error: null,
          };
        });
      } catch (error) {
        if (request.signal.aborted || requestRef.current !== request) return;
        setState((current) =>
          current.sourceId === sourceId
            ? {
                ...current,
                error:
                  error instanceof Error
                    ? error.message
                    : "The saved versions could not be loaded. Try again.",
              }
            : current,
        );
      } finally {
        if (requestRef.current === request) {
          requestRef.current = null;
          setState((current) =>
            current.sourceId === sourceId
              ? { ...current, loading: false }
              : current,
          );
        }
      }
    },
    [enabled, sourceId],
  );

  useEffect(() => {
    setState(emptyState(sourceId));
    if (enabled && sourceId) void requestPage();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [enabled, sourceId, requestPage]);

  // Hide the old pin during the source-switch render, before effect cleanup.
  const current =
    enabled && state.sourceId === sourceId ? state : emptyState(sourceId);
  const select = (selectedId: string) => {
    if (!enabled) return;
    setState((value) =>
      value.sourceId === sourceId &&
      value.versions.some((version) => version._id === selectedId)
        ? { ...value, selectedId }
        : value,
    );
  };
  const loadMore = () => {
    if (!current.loading && (!current.isDone || current.error))
      void requestPage(current.cursor ?? undefined);
  };
  return { ...current, select, loadMore };
}
