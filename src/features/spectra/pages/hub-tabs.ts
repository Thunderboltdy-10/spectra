export type WorkspaceHubTab = { id: string; label: string; workspaceId?: string };

/**
 * The hub tabs left once a workspace is gone: every tab of it closes, the
 * active tab stays when it survives, and with nothing left a Home tab opens.
 */
export function hubTabsWithoutWorkspace(
  tabs: WorkspaceHubTab[],
  activeId: string | null,
  workspaceId: string,
  home: () => WorkspaceHubTab,
): { tabs: WorkspaceHubTab[]; activeId: string } {
  const remaining = tabs.filter((tab) => tab.workspaceId !== workspaceId);
  const next = remaining.length ? remaining : [home()];
  const active = next.find((tab) => tab.id === activeId) ?? next.find((tab) => !tab.workspaceId) ?? next[0]!;
  return { tabs: next, activeId: active.id };
}
