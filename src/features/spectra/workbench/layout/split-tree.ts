export type WorkbenchTab = {
  id: string;
  title: string;
  minInlineSize: number;
  preferredInlineSize: number;
};

export type WorkbenchNode =
  | { type: "pane"; paneId: string; tabs: WorkbenchTab[]; activeTabId: string }
  | {
      type: "split";
      splitId: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      first: WorkbenchNode;
      second: WorkbenchNode;
    };

const pane = (tab: WorkbenchTab): WorkbenchNode => ({
  type: "pane",
  paneId: `pane:${tab.id}`,
  tabs: [tab],
  activeTabId: tab.id,
});

const split = (
  splitId: string,
  direction: "horizontal" | "vertical",
  first: WorkbenchNode,
  second: WorkbenchNode,
  ratio = 0.5,
): WorkbenchNode => ({ type: "split", splitId, direction, ratio, first, second });

export function createAutomaticWorkbenchLayout(tabs: readonly WorkbenchTab[]): WorkbenchNode | null {
  const rows = tabs.slice(0, 4);
  if (!rows.length) return null;
  if (rows.length === 1) return pane(rows[0]!);
  if (rows.length === 2) return split("split:root", "horizontal", pane(rows[0]!), pane(rows[1]!));
  if (rows.length === 3)
    return split(
      "split:root",
      "horizontal",
      pane(rows[0]!),
      split("split:right", "vertical", pane(rows[1]!), pane(rows[2]!)),
      0.52,
    );
  return split(
    "split:root",
    "horizontal",
    split("split:left", "vertical", pane(rows[0]!), pane(rows[2]!)),
    split("split:right", "vertical", pane(rows[1]!), pane(rows[3]!)),
  );
}

export function collectWorkbenchTabs(node: WorkbenchNode): WorkbenchTab[] {
  return node.type === "pane"
    ? node.tabs
    : [...collectWorkbenchTabs(node.first), ...collectWorkbenchTabs(node.second)];
}

export function collectWorkbenchPaneIds(node: WorkbenchNode): string[] {
  return node.type === "pane"
    ? [node.paneId]
    : [...collectWorkbenchPaneIds(node.first), ...collectWorkbenchPaneIds(node.second)];
}

export function firstWorkbenchPaneId(node: WorkbenchNode): string {
  return node.type === "pane" ? node.paneId : firstWorkbenchPaneId(node.first);
}

export function minimumInlineSize(node: WorkbenchNode): number {
  if (node.type === "pane") return Math.max(...node.tabs.map((tab) => tab.minInlineSize), 0);
  const first = minimumInlineSize(node.first);
  const second = minimumInlineSize(node.second);
  return node.direction === "horizontal" ? first + second + 8 : Math.max(first, second);
}

export function enforceWorkbenchMinimums(node: WorkbenchNode, inlineSize: number): WorkbenchNode {
  if (node.type === "pane") return node;
  if (node.direction === "horizontal" && minimumInlineSize(node) > inlineSize) {
    const tabs = collectWorkbenchTabs(node);
    return {
      type: "pane",
      paneId: `pane:stack:${tabs.map((tab) => tab.id).join(":")}`,
      tabs,
      activeTabId: tabs[0]!.id,
    };
  }
  const firstSize = node.direction === "horizontal" ? inlineSize * node.ratio : inlineSize;
  const secondSize = node.direction === "horizontal" ? inlineSize * (1 - node.ratio) : inlineSize;
  return {
    ...node,
    first: enforceWorkbenchMinimums(node.first, firstSize),
    second: enforceWorkbenchMinimums(node.second, secondSize),
  };
}

export function setSplitRatio(node: WorkbenchNode, splitId: string, ratio: number): WorkbenchNode {
  if (node.type === "pane") return node;
  return {
    ...node,
    ratio: node.splitId === splitId ? Math.min(0.75, Math.max(0.25, ratio)) : node.ratio,
    first: setSplitRatio(node.first, splitId, ratio),
    second: setSplitRatio(node.second, splitId, ratio),
  };
}

export function activateWorkbenchTab(node: WorkbenchNode, paneId: string, tabId: string): WorkbenchNode {
  if (node.type === "pane")
    return node.paneId === paneId && node.tabs.some((tab) => tab.id === tabId)
      ? { ...node, activeTabId: tabId }
      : node;
  return {
    ...node,
    first: activateWorkbenchTab(node.first, paneId, tabId),
    second: activateWorkbenchTab(node.second, paneId, tabId),
  };
}

function replacePane(
  node: WorkbenchNode,
  paneId: string,
  replacement: WorkbenchNode,
): WorkbenchNode {
  if (node.type === "pane") return node.paneId === paneId ? replacement : node;
  return {
    ...node,
    first: replacePane(node.first, paneId, replacement),
    second: replacePane(node.second, paneId, replacement),
  };
}

export function addWorkbenchTab(
  node: WorkbenchNode | null,
  tab: WorkbenchTab,
  options: { paneId?: string; split?: "horizontal" | "vertical" } = {},
): WorkbenchNode {
  if (!node) return pane(tab);
  if (collectWorkbenchTabs(node).some((entry) => entry.id === tab.id)) return node;
  if (options.paneId) {
    const target = findPane(node, options.paneId);
    if (target) {
      if (!options.split) {
        return replacePane(node, target.paneId, {
          ...target,
          tabs: [...target.tabs, tab],
          activeTabId: tab.id,
        });
      }
      return replacePane(
        node,
        target.paneId,
        split(
          `split:${target.paneId}:${tab.id}`,
          options.split,
          target,
          pane(tab),
        ),
      );
    }
  }
  return createAutomaticWorkbenchLayout([...collectWorkbenchTabs(node), tab]) ?? node;
}

export function removeWorkbenchTab(
  node: WorkbenchNode,
  tabId: string,
): WorkbenchNode | null {
  if (node.type === "pane") {
    const tabs = node.tabs.filter((tab) => tab.id !== tabId);
    if (!tabs.length) return null;
    return {
      ...node,
      tabs,
      activeTabId:
        node.activeTabId === tabId ? tabs[0]!.id : node.activeTabId,
    };
  }
  const first = removeWorkbenchTab(node.first, tabId);
  const second = removeWorkbenchTab(node.second, tabId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function splitWorkbenchPane(
  node: WorkbenchNode,
  paneId: string,
  tabId: string,
  direction: "horizontal" | "vertical",
): WorkbenchNode {
  const target = findPane(node, paneId);
  const tab = target?.tabs.find((entry) => entry.id === tabId);
  if (!target || !tab || target.tabs.length < 2) return node;
  const remaining = removeWorkbenchTab(target, tabId);
  if (!remaining) return node;
  return replacePane(
    node,
    paneId,
    split(`split:${paneId}:${tabId}`, direction, remaining, pane(tab)),
  );
}

export function moveWorkbenchTab(
  node: WorkbenchNode,
  tabId: string,
  targetPaneId: string,
): WorkbenchNode {
  const tab = collectWorkbenchTabs(node).find((entry) => entry.id === tabId);
  const source = findPaneForTab(node, tabId);
  const target = findPane(node, targetPaneId);
  if (!tab || !source || !target || source.paneId === target.paneId) return node;
  const removed = removeWorkbenchTab(node, tabId);
  return removed ? addWorkbenchTab(removed, tab, { paneId: targetPaneId }) : node;
}

/** Trades the places of the panes holding two tabs; the sizes stay where they are. */
export function swapWorkbenchPanes(node: WorkbenchNode, firstTabId: string, secondTabId: string): WorkbenchNode {
  const first = findPaneForTab(node, firstTabId);
  const second = findPaneForTab(node, secondTabId);
  if (!first || !second || first === second) return node;
  const swap = (current: WorkbenchNode): WorkbenchNode =>
    current.type === "pane"
      ? current === first
        ? second
        : current === second
          ? first
          : current
      : { ...current, first: swap(current.first), second: swap(current.second) };
  return swap(node);
}

export function rebalanceWorkbenchTree(node: WorkbenchNode): WorkbenchNode {
  if (node.type === "pane") return node;
  const first = rebalanceWorkbenchTree(node.first);
  const second = rebalanceWorkbenchTree(node.second);
  const firstWeight = Math.max(1, collectWorkbenchTabs(first).length);
  const secondWeight = Math.max(1, collectWorkbenchTabs(second).length);
  const ratio = Math.min(0.75, Math.max(0.25, firstWeight / (firstWeight + secondWeight)));
  return { ...node, ratio, first, second };
}

export function focusWorkbenchPane(
  node: WorkbenchNode,
  paneId: string,
): WorkbenchNode | null {
  const target = findPane(node, paneId);
  return target ? { ...target } : null;
}

function findPane(node: WorkbenchNode, paneId: string): Extract<WorkbenchNode, { type: "pane" }> | null {
  if (node.type === "pane") return node.paneId === paneId ? node : null;
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

function findPaneForTab(node: WorkbenchNode, tabId: string): Extract<WorkbenchNode, { type: "pane" }> | null {
  if (node.type === "pane") return node.tabs.some((tab) => tab.id === tabId) ? node : null;
  return findPaneForTab(node.first, tabId) ?? findPaneForTab(node.second, tabId);
}

export function validateWorkbenchTree(node: WorkbenchNode): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  function visit(current: WorkbenchNode) {
    if (current.type === "split") {
      if (current.ratio < 0.25 || current.ratio > 0.75) issues.push(`invalid ratio:${current.splitId}`);
      visit(current.first);
      visit(current.second);
      return;
    }
    if (!current.tabs.length) issues.push(`empty pane:${current.paneId}`);
    if (!current.tabs.some((tab) => tab.id === current.activeTabId)) issues.push(`inactive pane:${current.paneId}`);
    for (const tab of current.tabs) {
      if (ids.has(tab.id)) issues.push(`duplicate tab:${tab.id}`);
      ids.add(tab.id);
    }
  }
  visit(node);
  return issues;
}
