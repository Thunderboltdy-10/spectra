import {
  addWorkbenchTab,
  collectWorkbenchTabs,
  type WorkbenchNode,
} from "../layout/split-tree";

export type InspectorState = {
  open: boolean;
  tab: "overview" | "comments" | "history";
  width: number;
  selectedCommentId?: string;
};

export type SharedWorkbenchSession = {
  version: 2;
  openPanes: WorkbenchNode | null;
  activePaneId: string | null;
  auxiliaryThread?: { threadId: string; title: string };
  inspector: InspectorState;
  selectedBrowserSurface: "library" | { workspaceId: string };
  focusedPaneId?: string;
};

export const SHARED_WORKBENCH_SESSION_KEY = "spectra:shared-workbench:v2";

export const DEFAULT_SHARED_WORKBENCH_SESSION: SharedWorkbenchSession = {
  version: 2,
  openPanes: null,
  activePaneId: null,
  inspector: { open: false, tab: "overview", width: 320 },
  selectedBrowserSurface: "library",
};

export function normalizeSharedWorkbenchSession(value: unknown): SharedWorkbenchSession {
  if (!value || typeof value !== "object") return DEFAULT_SHARED_WORKBENCH_SESSION;
  const row = value as Partial<SharedWorkbenchSession>;
  const inspector = row.inspector && typeof row.inspector === "object" ? row.inspector : DEFAULT_SHARED_WORKBENCH_SESSION.inspector;
  return {
    version: 2,
    openPanes: row.openPanes ?? null,
    activePaneId: typeof row.activePaneId === "string" ? row.activePaneId : null,
    auxiliaryThread:
      row.auxiliaryThread && typeof row.auxiliaryThread.threadId === "string"
        ? { threadId: row.auxiliaryThread.threadId, title: String(row.auxiliaryThread.title || "Conversation") }
        : undefined,
    inspector: {
      open: inspector.open === true,
      tab: ["overview", "comments", "history"].includes(inspector.tab) ? inspector.tab : "overview",
      width: Math.min(480, Math.max(280, Number(inspector.width) || 320)),
      selectedCommentId: inspector.selectedCommentId,
    },
    selectedBrowserSurface:
      row.selectedBrowserSurface === "library" ||
      (row.selectedBrowserSurface && typeof row.selectedBrowserSurface === "object" && typeof row.selectedBrowserSurface.workspaceId === "string")
        ? row.selectedBrowserSurface
        : "library",
    focusedPaneId: typeof row.focusedPaneId === "string" ? row.focusedPaneId : undefined,
  };
}

export function updateWorkbenchSurface(
  session: SharedWorkbenchSession,
  surface: SharedWorkbenchSession["selectedBrowserSurface"],
): SharedWorkbenchSession {
  return { ...session, selectedBrowserSurface: surface };
}

export function readSharedWorkbenchSession(storage: Pick<Storage, "getItem">): SharedWorkbenchSession {
  try {
    return normalizeSharedWorkbenchSession(JSON.parse(storage.getItem(SHARED_WORKBENCH_SESSION_KEY) ?? "null"));
  } catch {
    return DEFAULT_SHARED_WORKBENCH_SESSION;
  }
}

export function writeSharedWorkbenchSession(storage: Pick<Storage, "setItem">, session: SharedWorkbenchSession) {
  storage.setItem(SHARED_WORKBENCH_SESSION_KEY, JSON.stringify(normalizeSharedWorkbenchSession(session)));
}

export type RouteSideSession = {
  version: 1;
  routeKey: string;
  workId?: string;
  threadId?: string;
  updatedAt: number;
};

export function routeSideSessionKey(routeKey: string) {
  return `spectra:route-side-session:v1:${encodeURIComponent(routeKey)}`;
}

export function normalizeRouteSideSession(
  value: unknown,
  routeKey: string,
): RouteSideSession {
  const row = value && typeof value === "object" ? value as Partial<RouteSideSession> : {};
  return {
    version: 1,
    routeKey,
    workId: typeof row.workId === "string" && row.workId ? row.workId : undefined,
    threadId: typeof row.threadId === "string" && row.threadId ? row.threadId : undefined,
    updatedAt: Number.isFinite(row.updatedAt) ? Number(row.updatedAt) : Date.now(),
  };
}

export function readRouteSideSession(
  storage: Pick<Storage, "getItem">,
  routeKey: string,
): RouteSideSession {
  try {
    return normalizeRouteSideSession(
      JSON.parse(storage.getItem(routeSideSessionKey(routeKey)) ?? "null"),
      routeKey,
    );
  } catch {
    return normalizeRouteSideSession(null, routeKey);
  }
}

export function writeRouteSideSession(
  storage: Pick<Storage, "setItem">,
  session: RouteSideSession,
) {
  const normalized = normalizeRouteSideSession(session, session.routeKey);
  storage.setItem(routeSideSessionKey(session.routeKey), JSON.stringify(normalized));
}

export function transferSideSessionToLibrary(
  session: SharedWorkbenchSession,
  side: RouteSideSession,
): SharedWorkbenchSession {
  const currentTabs = session.openPanes ? collectWorkbenchTabs(session.openPanes) : [];
  const alreadyOpen = side.workId
    ? currentTabs.some((tab) => tab.id === side.workId)
    : true;
  const openPanes = side.workId && !alreadyOpen
    ? addWorkbenchTab(session.openPanes, {
        id: side.workId,
        title: "Transferred work",
        minInlineSize: 320,
        preferredInlineSize: 720,
      })
    : session.openPanes;
  return {
    ...session,
    openPanes,
    activePaneId: side.workId ? findPaneIdForTab(openPanes, side.workId) : session.activePaneId,
    selectedBrowserSurface: "library",
    auxiliaryThread: side.threadId ? { threadId: side.threadId, title: "Conversation" } : session.auxiliaryThread,
  };
}

function findPaneIdForTab(node: WorkbenchNode | null, tabId: string): string | null {
  if (!node) return null;
  if (node.type === "pane") return node.tabs.some((tab) => tab.id === tabId) ? node.paneId : null;
  return findPaneIdForTab(node.first, tabId) ?? findPaneIdForTab(node.second, tabId);
}
