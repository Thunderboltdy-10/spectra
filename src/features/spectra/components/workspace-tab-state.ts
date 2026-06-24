export type PersistedWorkspaceHubTab = {
  id: string;
  label: string;
  workspaceId?: string;
};

export function parseWorkspaceHubTabs(
  value: unknown,
  validWorkspaceIds?: ReadonlySet<string>,
) {
  if (!value || typeof value !== "object") return { tabs: [] as PersistedWorkspaceHubTab[], activeId: null as string | null };
  const source = value as { tabs?: unknown; activeId?: unknown };
  const tabs = (Array.isArray(source.tabs) ? source.tabs : []).slice(0, 16).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.label !== "string") return [];
    const workspaceId = typeof row.workspaceId === "string" && row.workspaceId.trim() ? row.workspaceId.trim() : undefined;
    if (workspaceId && validWorkspaceIds && !validWorkspaceIds.has(workspaceId)) return [];
    return [{ id: row.id.slice(0, 160), label: row.label.slice(0, 88) || "Home", workspaceId }];
  });
  const requestedActiveId = typeof source.activeId === "string" ? source.activeId : null;
  return {
    tabs,
    activeId: tabs.some((tab) => tab.id === requestedActiveId) ? requestedActiveId : tabs[0]?.id ?? null,
  };
}
