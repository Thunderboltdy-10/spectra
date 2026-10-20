import type { SpectraOpenObject } from "@/stores/spectra-context-store";

/** A page in the top rail: the Library, a workspace, or picked work laid side by side (`workSet`, for this session only). */
export type WorkspaceHubTab = { id: string; label: string; workspaceId?: string; workSet?: SpectraOpenObject[] };

/** A work set's tab says what is in it: "A and B", or "A, B and 3 more". */
export function workSetLabel(titles: string[]) {
  if (titles.length <= 1) return titles[0] ?? "Side by side";
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
}

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

/**
 * One tab per place: the Library once, each workspace once (a work set is its
 * own thing and always stays). A duplicate gives way to the tab that is open,
 * so collapsing never moves the person somewhere else.
 */
export function distinctHubTabs(
  tabs: WorkspaceHubTab[],
  activeId: string | null,
): { tabs: WorkspaceHubTab[]; activeId: string | null } {
  const placeOf = (tab: WorkspaceHubTab) => (tab.workSet ? `set:${tab.id}` : `place:${tab.workspaceId ?? ""}`);
  const kept = new Map<string, WorkspaceHubTab>();
  for (const tab of tabs) {
    const place = placeOf(tab);
    if (!kept.has(place) || tab.id === activeId) kept.set(place, tab);
  }
  const next = tabs.filter((tab) => kept.get(placeOf(tab)) === tab);
  const active = tabs.find((tab) => tab.id === activeId);
  return { tabs: next, activeId: active ? kept.get(placeOf(active))!.id : activeId };
}
