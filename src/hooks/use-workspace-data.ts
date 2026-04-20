"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkspaceData,
  WorkspaceItemData,
} from "@/lib/workspace/contracts";
import type { ResultCardData, ResultActionType } from "@/components/workspace/result-card";
import { subscribeWorkspaceContentMutated } from "@/lib/workspace/events";

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
  topicCluster?: string;
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
  topicCluster?: string;
  timelineAt?: number;
  signalStrength?: number;
  threadStatus?: "open" | "resolved" | "blocked";
  targetRecord?: Record<string, unknown> | null;
  relatedWorkspaceItem?: BackendWorkspaceItem | null;
};

type BackendWorkspaceWidget = {
  _id: string;
  workstreamId?: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
  hidden?: boolean;
  state?: Record<string, unknown>;
  updatedAt: number;
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
  artifactCount?: number;
};

type BackendPageData = {
  workstream: BackendWorkstream;
  items: BackendWorkspaceItem[];
  commandResults: BackendCommandResult[];
  widgets?: BackendWorkspaceWidget[];
  preferences?: {
    workspaceViewMode?: "byType" | "byTopic" | "timeline";
  };
  signals?: {
    workspaceHealth?: Record<string, unknown>;
    topicSignals?: Array<{
      topic?: string;
      itemCount?: number;
      plannerCount?: number;
      chatCount?: number;
      resultCount?: number;
      latestTimestamp?: number;
      overdueCount?: number;
      unresolvedCount?: number;
      state?: string;
    }>;
    timelineSignals?: Array<Record<string, unknown>>;
  };
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
    topicCluster: item.topicCluster,
    sourceChatId: item.sourceChatId,
    sourceArtifactId: item.sourceArtifactId,
    sourcePlannerItemId: item.sourcePlannerItemId,
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

type CreateCommandResultPayload = {
  workstreamId: string;
  intent?: "note" | "planner" | "thread" | "result" | "widget";
  status?: "processing" | "completed" | "dismissed";
  title?: string;
  summary?: string;
  targetKind?: "artifact" | "plannerItem" | "chat" | "workspaceItem" | "result";
  targetId?: string;
  variant?: "summary" | "answer" | "artifact" | "planner" | "thread";
};

type UpdateCommandResultPayload = {
  resultId: string;
  title?: string;
  status?: "processing" | "completed" | "dismissed";
  summary?: string;
  detail?: string;
  targetKind?: "artifact" | "plannerItem" | "chat" | "workspaceItem" | "result";
  targetId?: string;
  variant?: "summary" | "answer" | "artifact" | "planner" | "thread";
  metadata?: Record<string, unknown>;
};

export async function createCommandResult(payload: CreateCommandResultPayload): Promise<{ resultId: string } | null> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createResult", ...payload }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function updateCommandResult(payload: UpdateCommandResultPayload): Promise<boolean> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateResult", ...payload }),
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

export type WorkspaceWidgetPayload = {
  widgetId?: string;
  workstreamId?: string;
  kind?: string;
  title?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  collapsed?: boolean;
  hidden?: boolean;
  state?: Record<string, unknown>;
};

export async function createWorkspaceWidget(payload: WorkspaceWidgetPayload): Promise<{ widgetId: string } | null> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createWidget", ...payload }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function updateWorkspaceWidget(payload: WorkspaceWidgetPayload): Promise<boolean> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateWidget", ...payload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeWorkspaceWidget(widgetId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removeWidget", widgetId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function updateWorkspace(payload: {
  workstreamId: string;
  title?: string;
  emoji?: string;
  description?: string;
}): Promise<boolean> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateWorkspace", ...payload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function persistWorkspaceViewMode(
  viewMode: "spatial" | "type" | "topic" | "timeline",
): Promise<boolean> {
  try {
    const res = await fetch("/api/workspace-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "persistViewMode", viewMode }),
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
  const cacheRef = useRef<Map<string, WorkspaceData>>(new Map());

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
          const fullWorkspace: WorkspaceData = {
            id: ws._id,
            name: ws.title,
            emoji: ws.emoji ?? "📁",
            status: mapWorkspaceStatus(ws.status),
            itemCount: items.length,
            lastActivity: ws.lastActivityAt ?? ws.updatedAt,
            items,
          };
          cacheRef.current.set(ws._id, fullWorkspace);
          while (cacheRef.current.size > 6) {
            const firstKey = cacheRef.current.keys().next().value;
            if (!firstKey) break;
            cacheRef.current.delete(firstKey);
          }
          // Also extract command results for the active workspace
          setCommandResultCards(
            pageData.commandResults.map(backendResultToCard),
          );
          return fullWorkspace;
        }
      }

      const cached = cacheRef.current.get(ws._id);
      if (cached) {
        cacheRef.current.delete(ws._id);
        cacheRef.current.set(ws._id, cached);
        return {
          ...cached,
          name: ws.title,
          emoji: ws.emoji ?? cached.emoji,
          status: mapWorkspaceStatus(ws.status),
          lastActivity: ws.lastActivityAt ?? ws.updatedAt,
        };
      }

      // Minimal workspace card (no full page data fetch)
      return {
        id: ws._id,
        name: ws.title,
        emoji: ws.emoji ?? "📁",
        status: mapWorkspaceStatus(ws.status),
        itemCount: ws.artifactCount ?? 0,
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

  useEffect(() => {
    return subscribeWorkspaceContentMutated((detail) => {
      if (!detail.refreshHub && !detail.refreshWorkstreams && !detail.workstreamId) {
        return;
      }
      if (!activeWorkstreamId || !detail.workstreamId || detail.workstreamId === activeWorkstreamId || detail.refreshWorkstreams) {
        setRefreshKey((k) => k + 1);
      }
    });
  }, [activeWorkstreamId]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { workspaces, commandResultCards, isLive, loading, refresh };
}

/* ─── Hook: useWorkspacePageData (single workspace) ──── */

export function useWorkspacePageData(workstreamId: string | null) {
  const [items, setItems] = useState<WorkspaceItemData[]>([]);
  const [commandResultCards, setCommandResultCards] = useState<ResultCardData[]>([]);
  const [widgets, setWidgets] = useState<BackendWorkspaceWidget[]>([]);
  const [preferences, setPreferences] = useState<BackendPageData["preferences"] | null>(null);
  const [signals, setSignals] = useState<BackendPageData["signals"] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workstreamId) {
      setItems([]);
      setCommandResultCards([]);
      setWidgets([]);
      setPreferences(null);
      setSignals(null);
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
      setWidgets(data.widgets ?? []);
      setPreferences(data.preferences ?? null);
      setSignals(data.signals ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [workstreamId]);

  return { items, commandResultCards, widgets, preferences, signals, loading };
}
