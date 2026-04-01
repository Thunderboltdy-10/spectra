export const WORKSPACE_CONTENT_CHANGED_EVENT = "workspace:content-mutated";

export type WorkspaceContentChangedDetail = {
  workstreamId?: string;
  includeHub?: boolean;
  refreshHub?: boolean;
  refreshWorkstreams?: boolean;
  entity?: "artifact" | "chat" | "workspace-item";
  action?: "created" | "updated" | "deleted";
};

export function dispatchWorkspaceContentChanged(
  detail: WorkspaceContentChangedDetail,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceContentChangedDetail>(
      WORKSPACE_CONTENT_CHANGED_EVENT,
      { detail },
    ),
  );
}

export const notifyWorkspaceContentMutated = dispatchWorkspaceContentChanged;

export function subscribeWorkspaceContentMutated(
  listener: (detail: WorkspaceContentChangedDetail) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<WorkspaceContentChangedDetail>;
    listener(customEvent.detail ?? {});
  };

  window.addEventListener(WORKSPACE_CONTENT_CHANGED_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(
      WORKSPACE_CONTENT_CHANGED_EVENT,
      handler as EventListener,
    );
  };
}
