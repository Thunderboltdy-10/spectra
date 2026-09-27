"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api } from "../../../../convex/_generated/api";
import { useAuthedArgs } from "./use-authed-args";
import { spectraBus } from "../events";
import { getSpectraWorkspaceMetadata, spectraAgentCatalog, spectraWorkspaceCatalog, type SpectraWorkspace } from "./api";
import type { CatalogSnapshot, createCatalogPageCache } from "./catalog-page-cache";

const EMPTY: CatalogSnapshot<never> = { items: [], status: "idle", isDone: false, error: null };
type Cache<T extends { _id: string }> = ReturnType<typeof createCatalogPageCache<T>>;

export function useCatalogPages<T extends { _id: string }>(cache: Cache<T>, enabled = true, complete = false) {
  const { userId, sessionId } = useAuth();
  const identity = useQuery(api.catalogGraph.identity, useAuthedArgs(enabled ? {} : "skip"));
  const key = enabled && userId && sessionId && identity
    ? JSON.stringify([userId, sessionId, identity.accountId, identity.schoolId, identity.membershipId]) + "/"
    : null;
  const subscribe = useCallback((listener: () => void) => key ? cache.subscribe(key, listener) : () => {}, [cache, key]);
  const snapshot = useSyncExternalStore(subscribe, useCallback(() => key ? cache.getSnapshot(key) : EMPTY, [cache, key]), () => EMPTY);
  useEffect(() => {
    // The compact reactive identity is shared by Convex consumers. A changed
    // account, session or membership cannot reuse another school's warm rows.
    if (key) cache.retainScope(key);
    else if (enabled && (identity === null || !userId)) cache.retainScope("no-active-membership/");
  }, [cache, enabled, identity, key, userId]);
  useEffect(() => {
    if (key && (snapshot.status === "idle" || (complete && snapshot.status === "ready" && !snapshot.isDone)))
      void cache.load(key, { more: snapshot.status === "ready", all: complete });
  }, [cache, complete, key, snapshot.isDone, snapshot.status]);
  const refresh = useCallback((force = false) => key ? cache.load(key, { force, all: complete }) : Promise.resolve(), [cache, complete, key]);
  const more = useCallback(() => key ? cache.load(key, { more: true, all: complete }) : Promise.resolve(), [cache, complete, key]);
  return { ...snapshot, key, refresh, more, unavailable: enabled && identity === null };
}

export function useWorkspaceCatalog(selectedId?: string | null, enabled = true) {
  const catalog = useCatalogPages(spectraWorkspaceCatalog, enabled);
  const { refresh: refreshCatalog } = catalog;
  const [selected, setSelected] = useState<{ key: string; workspace: SpectraWorkspace } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback((force = false) => {
    if (force) setRevision(value => value + 1);
    return refreshCatalog(force);
  }, [refreshCatalog]);
  useEffect(() => {
    if (!catalog.key || !selectedId) return;
    const key = catalog.key;
    const controller = new AbortController();
    setSelected(null);
    void getSpectraWorkspaceMetadata(selectedId, controller.signal).then(({ workspace }) => {
      if (!controller.signal.aborted) setSelected(workspace ? { key, workspace } : null);
    }).catch(() => { if (!controller.signal.aborted) setSelected(null); });
    return () => controller.abort();
  }, [catalog.key, selectedId, revision]);
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const remove = spectraBus.on("workspaces.changed", () => { spectraWorkspaceCatalog.invalidate(); void refresh(true); });
    return () => { window.removeEventListener("focus", onFocus); remove(); };
  }, [enabled, refresh]);
  const items = useMemo(() => {
    const detail = selected?.key === catalog.key && selected.workspace._id === selectedId ? selected.workspace : null;
    return detail && !catalog.items.some(item => item._id === detail._id) ? [detail, ...catalog.items] : catalog.items;
  }, [catalog.items, catalog.key, selected, selectedId]);
  return { ...catalog, items, refresh };
}

export const useAgentCatalog = () => useCatalogPages(spectraAgentCatalog, true, true);
