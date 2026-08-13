export type PersistedWorkspaceHubTab = {
  id: string;
  label: string;
  workspaceId?: string;
};

export function parseWorkspaceHubTabs(
  value: unknown,
  validWorkspaceIds?: ReadonlySet<string>,
) {
  if (!value || typeof value !== "object")
    return {
      tabs: [] as PersistedWorkspaceHubTab[],
      activeId: null as string | null,
    };
  const source = value as { tabs?: unknown; activeId?: unknown };
  const requestedActiveId =
    typeof source.activeId === "string" ? source.activeId : null;
  const parsedTabs = (Array.isArray(source.tabs) ? source.tabs : [])
    .slice(0, 16)
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.label !== "string")
        return [];
      const workspaceId =
        typeof row.workspaceId === "string" && row.workspaceId.trim()
          ? row.workspaceId.trim()
          : undefined;
      if (
        workspaceId &&
        validWorkspaceIds &&
        !validWorkspaceIds.has(workspaceId)
      )
        return [];
      return [
        {
          id: row.id.slice(0, 160),
          label: row.label.slice(0, 88) || "Home",
          workspaceId,
        },
      ];
    });
  const tabs: PersistedWorkspaceHubTab[] = [];
  const destinationIndexes = new Map<string, number>();
  for (const tab of parsedTabs) {
    const destination = tab.workspaceId
      ? `workspace:${tab.workspaceId}`
      : "home";
    const existingIndex = destinationIndexes.get(destination);
    if (existingIndex === undefined) {
      destinationIndexes.set(destination, tabs.length);
      tabs.push(tab);
      continue;
    }
    // Preserve the selected duplicate so restoring the session never changes
    // which tab the user was looking at while still repairing old tab state.
    if (tab.id === requestedActiveId) tabs[existingIndex] = tab;
  }
  return {
    tabs,
    activeId: tabs.some((tab) => tab.id === requestedActiveId)
      ? requestedActiveId
      : (tabs[0]?.id ?? null),
  };
}
