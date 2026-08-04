import type { CollaborationTransportSnapshot } from "../../collaboration/types";
import type { WorkDefinition } from "../registry";
import type { WorkDurabilityState } from "./session-controller";

export function collaborationController(
  snapshot: CollaborationTransportSnapshot,
) {
  return {
    state: snapshot.state,
    editable:
      snapshot.level === "modify" && snapshot.state !== "permission_lost",
    locallyPending: snapshot.unsynchronizedChanges,
    presence: snapshot.presence,
    issue: snapshot.error,
  };
}

export function saveProjectionController(input: {
  localPending: number;
  connected: boolean;
  synchronized: boolean;
  projectionPending: boolean;
  projectionDelayed?: boolean;
}): WorkDurabilityState {
  return {
    local: input.localPending > 0 ? "pending" : "clean",
    live: !input.connected
      ? "offline"
      : input.synchronized
        ? "synchronized"
        : "connecting",
    durable: input.projectionDelayed
      ? "delayed"
      : input.projectionPending
        ? "projecting"
        : "current",
  };
}

export type WorkHistoryEntry = {
  id: string;
  category: "change" | "ai" | "import" | "access" | "source" | "version";
  summary: string;
  createdAt: number;
};

export function historyController(entries: readonly WorkHistoryEntry[]) {
  return [...entries].sort((left, right) => right.createdAt - left.createdAt);
}

export function publishingController(input: {
  access: "read_only" | "edit";
  public: boolean;
  pending: boolean;
}) {
  return {
    ...input,
    canPublish: input.access === "edit" && !input.pending,
  };
}

export type InspectorState = {
  open: boolean;
  tab: "overview" | "comments" | "history";
  width: number;
  selectedCommentId?: string;
};

export function inspectorController(
  state: InspectorState,
  action:
    | { type: "open"; tab?: InspectorState["tab"] }
    | { type: "close" }
    | { type: "select_comment"; commentId: string }
    | { type: "resize"; width: number },
): InspectorState {
  if (action.type === "close") return { ...state, open: false };
  if (action.type === "open")
    return { ...state, open: true, tab: action.tab ?? state.tab };
  if (action.type === "select_comment")
    return {
      ...state,
      open: true,
      tab: "comments",
      selectedCommentId: action.commentId,
    };
  return { ...state, width: Math.max(280, Math.min(720, action.width)) };
}

export type AiActivityState = {
  activeRunIds: readonly string[];
  waitingRunIds: readonly string[];
  currentTargets: Readonly<Record<string, string>>;
};

export function aiActivityController(state: AiActivityState) {
  return {
    ...state,
    hasActivity: state.activeRunIds.length > 0,
    waitingForActor: state.waitingRunIds.length > 0,
  };
}

export function responsiveSurfaceController(
  definition: WorkDefinition,
  inlineSize: number,
) {
  if (inlineSize < definition.responsive.minInlineSize)
    return { kind: "tab_fallback" as const };
  if (
    inlineSize < definition.responsive.preferredInlineSize &&
    definition.responsive.supportsCompact
  )
    return { kind: "compact" as const };
  return { kind: "full" as const };
}
