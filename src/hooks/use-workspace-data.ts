"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  WorkspaceData,
  WorkspaceItemData,
} from "@/lib/workspace/contracts";
import type { ResultCardData, ResultActionType } from "@/components/workspace/result-card";

/* ─── Backend Shape (from getWorkspacePageData) ──────── */

type BackendWorkspaceItem = {
  _id: string;
  workstreamId: string;
  title: string;
  contentSummary?: string;
  workspaceType?: string;
  itemType?: string;
  renderMode?: string;
  type?: string;
  status: string;
  x?: number;
  y?: number;
  updatedAt?: number;
  createdAt?: number;
  pinned?: boolean;
  category?: string;
  sourceArtifactId?: string;
  sourceChatId?: string;
  sourcePlannerItemId?: string;
};

type BackendCommandResult = {
  _id: string;
  workstreamId: string;
  intent: string;
  status: string;
  title: string;
  summary: string;
  detail?: string;
  variant?: string;
  targetKind?: string;
  targetId?: string;
  createdAt: number;
  updatedAt: number;
  dismissedAt?: number;
  targetRecord?: Record<string, unknown> | null;
  relatedWorkspaceItem?: BackendWorkspaceItem | null;
};

type BackendWorkstream = {
  _id: string;
  title: string;
  emoji?: string;
  color?: string;
  status: string;
  description?: string;
  lastActivityAt?: number;
  updatedAt: number;
};

type BackendPageData = {
  workstream: BackendWorkstream;
  items: BackendWorkspaceItem[];
  commandResults: BackendCommandResult[];
  revision?: number;
  revisionKey?: string;
};

/* ─── Transform helpers ──────────────────────────────── */

function mapItemStatus(s: string): WorkspaceItemData["status"] {
  if (s === "active") return "active";
  if (s === "completed") return "completed";
  if (s === "archived") return "archived";
  return "idle";
}

function mapWorkspaceStatus(s: string): WorkspaceData["status"] {
  if (s === "active") return "active";
  if (s === "completed") return "completed";
  if (s === "archived") return "archived";
  return "quiet";
}

function timeAgoMeta(timestamp?: number): string | undefined {
  if (!timestamp) return undefined;
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function backendItemToFrontend(
  item: BackendWorkspaceItem,
  workspaceId: string,
): WorkspaceItemData {
  const itemType = (item.workspaceType ?? item.itemType ?? item.renderMode ?? item.type ?? "export") as WorkspaceItemData["itemType"];
  return {
    id: item._id,
    workspaceId,
    title: item.title,
    preview: item.contentSummary,
    itemType,
    status: mapItemStatus(item.status),
    canvasX: item.x,
    canvasY: item.y,
    updatedAt: item.updatedAt ?? item.createdAt,
    meta: timeAgoMeta(item.updatedAt),
  };
}

function intentToActionType(intent: string): ResultActionType {
  switch (intent) {
    case "note": return "created";
    case "planner": return "planned";
    case "thread": return "answered";
    case "result": return "answered";
    case "widget": return "created";
    default: return "answered";
  }
}

function backendResultToCard(r: BackendCommandResult): ResultCardData {
  return {
    id: r._id,
    state:
      r.status === "dismissed"
        ? "dismissed"
        : r.status === "processing"
          ? "loading"
          : "done",
    promptSnippet: r.title,
    summary: r.summary,
    actionType: intentToActionType(r.intent),
    targetId: r.targetId,
    createdAt: r.createdAt,
  };
}

/* ─── Fetch helpers ──────────────────────────────────── */

async function fetchWorkspacePageData(
  workstreamId: string,
): Promise<BackendPageData | null> {
  try {
    const res = await fetch(
      `/api/workspace-data?workstreamId=${encodeURIComponent(workstreamId)}&includeDismissedResults=false&commandResultLimit=20`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json as BackendPageData;
  } catch {
    return null;
  }
}

async function fetchAllWorkstreams(): Promise<BackendWorkstream[]> {
  try {
    const res = await fetch("/api/workstreams?action=list&status=active");
    if (!res.ok) return [];
    const json = await res.json();
    return (json.workstreams ?? []) as BackendWorkstream[];
  } catch {
    return [];
  }
}

export async function dismissCommandResult(resultId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismissResult", resultId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function reopenCommandResult(resultId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopenResult", resultId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ─── Hook: useWorkspaceData ─────────────────────────── */

export type UseWorkspaceDataResult = {
  /** Transformed workspaces for the store */
  workspaces: WorkspaceData[];
  /** Command result cards for the active workspace */
  commandResultCards: ResultCardData[];
  /** Whether we're using real backend data */
  isLive: boolean;
  /** Whether initial load is in progress */
  loading: boolean;
  /** Reload data */
  refresh: () => void;
};

export function useWorkspaceData(
  activeWorkstreamId?: string | null,
): UseWorkspaceDataResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([]);
  const [commandResultCards, setCommandResultCards] = useState<ResultCardData[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);

    // Step 1: Fetch all workstreams to build workspace list
    const allWorkstreams = await fetchAllWorkstreams();

    if (allWorkstreams.length === 0) {
      // No workstreams → not authenticated or empty account
      setIsLive(false);
      setLoading(false);
      return;
    }

    setIsLive(true);

    // Step 2: For each workstream, fetch page data
    // For perf, fetch active workspace fully; others get minimal data
    const wsDataPromises = allWorkstreams.map(async (ws): Promise<WorkspaceData> => {
      const isActive = activeWorkstreamId === ws._id;
      if (isActive) {
        const pageData = await fetchWorkspacePageData(ws._id);
        if (pageData) {
          const items = pageData.items.map((item) =>
            backendItemToFrontend(item, ws._id),
          );
          // Also extract command results for the active workspace
          setCommandResultCards(
            pageData.commandResults.map(backendResultToCard),
          );
          return {
            id: ws._id,
            name: ws.title,
            emoji: ws.emoji ?? "📁",
            status: mapWorkspaceStatus(ws.status),
            itemCount: items.length,
            lastActivity: ws.lastActivityAt ?? ws.updatedAt,
            items,
          };
        }
      }

      // Minimal workspace card (no full page data fetch)
      return {
        id: ws._id,
        name: ws.title,
        emoji: ws.emoji ?? "📁",
        status: mapWorkspaceStatus(ws.status),
        itemCount: 0,
        lastActivity: ws.lastActivityAt ?? ws.updatedAt,
        items: [],
      };
    });

    const resolved = await Promise.all(wsDataPromises);
    setWorkspaces(resolved);
    setLoading(false);
  }, [activeWorkstreamId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { workspaces, commandResultCards, isLive, loading, refresh };
}

/* ─── Hook: useWorkspacePageData (single workspace) ──── */

export function useWorkspacePageData(workstreamId: string | null) {
  const [items, setItems] = useState<WorkspaceItemData[]>([]);
  const [commandResultCards, setCommandResultCards] = useState<ResultCardData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workstreamId) {
      setItems([]);
      setCommandResultCards([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchWorkspacePageData(workstreamId).then((data) => {
      if (cancelled || !data) {
        setLoading(false);
        return;
      }
      setItems(data.items.map((item) => backendItemToFrontend(item, workstreamId)));
      setCommandResultCards(data.commandResults.map(backendResultToCard));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [workstreamId]);

  return { items, commandResultCards, loading };
}
