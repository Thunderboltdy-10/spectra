import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addWorkbenchTab,
  collectWorkbenchPaneIds,
  collectWorkbenchTabs,
  createAutomaticWorkbenchLayout,
  enforceWorkbenchMinimums,
  focusWorkbenchPane,
  minimumInlineSize,
  moveWorkbenchTab,
  rebalanceWorkbenchTree,
  removeWorkbenchTab,
  setSplitRatio,
  splitWorkbenchPane,
  swapWorkbenchPanes,
  validateWorkbenchTree,
  type WorkbenchTab,
} from "../workbench/layout/split-tree";
import {
  DEFAULT_SHARED_WORKBENCH_SESSION,
  normalizeRouteSideSession,
  readRouteSideSession,
  readSharedWorkbenchSession,
  routeSideSessionKey,
  transferSideSessionToLibrary,
  updateWorkbenchSurface,
  writeRouteSideSession,
  writeSharedWorkbenchSession,
} from "../workbench/session/shared-workbench-session";
import { canonicalSpectraPath, libraryWorkPath, workspacePath } from "../workbench/routes";
import { filterInspectorHistory, revealCommentTarget } from "../workbench/inspector/inspector-model";
import { listWorkDefinitions } from "../work/registry";

const tabs: WorkbenchTab[] = ["doc", "sheet", "deck", "board"].map((id, index) => ({
  id,
  title: id,
  minInlineSize: 300 + index * 20,
  preferredInlineSize: 640,
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("Workbench V2", () => {
  it("creates valid automatic layouts for one through four work items", () => {
    for (let count = 1; count <= 4; count += 1) {
      const tree = createAutomaticWorkbenchLayout(tabs.slice(0, count));
      expect(tree).not.toBeNull();
      expect(validateWorkbenchTree(tree!)).toEqual([]);
      expect(collectWorkbenchTabs(tree!).map((tab) => tab.id).sort()).toEqual(tabs.slice(0, count).map((tab) => tab.id).sort());
    }
  });

  it("bounds resizing and stacks tabs instead of crushing renderers", () => {
    const tree = createAutomaticWorkbenchLayout(tabs)!;
    expect(setSplitRatio(tree, "split:root", 0.99)).toMatchObject({ ratio: 0.75 });
    expect(minimumInlineSize(tree)).toBeGreaterThan(600);
    const fitted = enforceWorkbenchMinimums(tree, 520);
    expect(fitted.type).toBe("pane");
    expect(collectWorkbenchTabs(fitted)).toHaveLength(4);
    expect(validateWorkbenchTree(fitted)).toEqual([]);
  });

  it("adds, removes, splits, moves, focuses, and rebalances without orphan tabs", () => {
    let tree = createAutomaticWorkbenchLayout(tabs.slice(0, 2))!;
    tree = addWorkbenchTab(tree, tabs[2]!, { paneId: collectWorkbenchPaneIds(tree)[0] });
    expect(collectWorkbenchTabs(tree)).toHaveLength(3);
    const firstPane = collectWorkbenchPaneIds(tree)[0]!;
    tree = splitWorkbenchPane(tree, firstPane, "deck", "vertical");
    const paneIds = collectWorkbenchPaneIds(tree);
    expect(paneIds.length).toBeGreaterThanOrEqual(3);
    tree = moveWorkbenchTab(tree, "doc", paneIds.at(-1)!);
    tree = rebalanceWorkbenchTree(tree);
    expect(validateWorkbenchTree(tree)).toEqual([]);
    expect(focusWorkbenchPane(tree, paneIds.at(-1)!)).not.toBeNull();
    const removed = removeWorkbenchTab(tree, "sheet")!;
    expect(collectWorkbenchTabs(removed).map((tab) => tab.id).sort()).toEqual(["doc", "deck"].sort());
    expect(validateWorkbenchTree(removed)).toEqual([]);
  });

  it("persists the same Library and Workspace session", () => {
    const storage = memoryStorage();
    const openPanes = createAutomaticWorkbenchLayout(tabs.slice(0, 2));
    const session = { ...DEFAULT_SHARED_WORKBENCH_SESSION, openPanes, activePaneId: "pane:doc", inspector: { open: true, tab: "comments" as const, width: 390, selectedCommentId: "c1" } };
    writeSharedWorkbenchSession(storage, session);
    const restored = readSharedWorkbenchSession(storage);
    expect(restored.openPanes).toEqual(openPanes);
    expect(restored.inspector).toEqual(session.inspector);
    expect(updateWorkbenchSurface(restored, { workspaceId: "ws-1" }).openPanes).toEqual(openPanes);
  });

  it("restores route-local work/thread state and transfers identity into Library", () => {
    const storage = memoryStorage();
    const local = normalizeRouteSideSession({ workId: "work-7", threadId: "thread-2", updatedAt: 7 }, "/calendar");
    writeRouteSideSession(storage, local);
    expect(storage.getItem(routeSideSessionKey("/calendar"))).not.toBeNull();
    expect(readRouteSideSession(storage, "/calendar")).toEqual(local);
    expect(readRouteSideSession(storage, "/school").workId).toBeUndefined();
    const transferred = transferSideSessionToLibrary(DEFAULT_SHARED_WORKBENCH_SESSION, local);
    expect(transferred.selectedBrowserSurface).toBe("library");
    expect(transferred.auxiliaryThread?.threadId).toBe("thread-2");
    expect(collectWorkbenchTabs(transferred.openPanes!).map((tab) => tab.id)).toContain("work-7");
  });

  it("canonicalizes legacy paths and preserves encoded identities", () => {
    expect(canonicalSpectraPath("/artifacts")).toBe("/library");
    expect(canonicalSpectraPath("/artifacts/a b")).toBe("/library/a b");
    expect(canonicalSpectraPath("/timetable/day")).toBe("/calendar");
    expect(canonicalSpectraPath("/memory")).toBe("/settings?section=privacy");
    expect(libraryWorkPath("a b")).toBe("/library/a%20b");
    expect(workspacePath("x/y")).toBe("/workspace/x%2Fy");
  });

  it("declares usable panel, tile, compact and toolbar contracts for every work type", () => {
    for (const definition of listWorkDefinitions()) {
      expect(definition.responsive.minInlineSize).toBeGreaterThanOrEqual(280);
      expect(definition.responsive.preferredInlineSize).toBeGreaterThanOrEqual(definition.responsive.minInlineSize);
      expect(definition.responsive.supportsPanel).toBe(true);
      expect(definition.responsive.supportsTile).toBe(true);
      expect(definition.responsive.supportsCompact).toBe(true);
      expect(definition.responsive.toolbarPriorities.length).toBeGreaterThan(0);
      expect(
        definition.responsive.canvasExtent === "infinite" ||
          definition.responsive.canvasExtent === "bounded",
      ).toBe(true);
      if (definition.key === "presentation") {
        expect(definition.responsive.canvasExtent).toBe("bounded");
      } else {
        expect(definition.responsive.canvasExtent).toBe("infinite");
      }
    }
  });
});

describe("Inspector and navigation contracts", () => {
  it("filters unified history and distinguishes orphan comment navigation", () => {
    const history = [
      { id: "1", category: "change" as const, summary: "Changed", createdAt: 1 },
      { id: "2", category: "ai" as const, summary: "AI updated", createdAt: 2 },
      { id: "3", category: "access" as const, summary: "Shared", createdAt: 3 },
      { id: "4", category: "source" as const, summary: "Source refreshed", createdAt: 4 },
    ];
    expect(filterInspectorHistory(history, "changes").map((row) => row.id)).toEqual(["1", "4"]);
    expect(filterInspectorHistory(history, "ai").map((row) => row.id)).toEqual(["2"]);
    expect(revealCommentTarget({ id: "c1", body: "x", status: "open", anchorLabel: "Heading" }).kind).toBe("reveal");
    expect(revealCommentTarget({ id: "c2", body: "x", status: "orphaned", anchorLabel: "Old" }).kind).toBe("reanchor_required");
  });

  it("uses one rail for expanded and collapsed states, and finds conversations in the threads view", () => {
    const rail = readFileSync("src/components/layout/rail.tsx", "utf8");
    expect(rail.match(/<aside/g)).toHaveLength(1);
    expect(rail).toContain("data-collapsed={collapsed}");
    expect(rail).toContain("destinationsFor(identity).map");
    expect(rail).toContain('spectraBus.on("shell.focusSidebarSearch", () => spectraBus.emit("threads.open", {}))');
    expect(rail).not.toContain("Search recent chats");
    const view = readFileSync("src/features/spectra/threads/threads-view.tsx", "utf8");
    expect(view).toContain('placeholder="Search threads by topic or words"');
    expect(view).toContain("useThreadSearch(query");
  });

  it("separates chat failures from empty results", () => {
    const chatBrowser = readFileSync(
      "src/features/spectra/components/chat-browser-panel.tsx",
      "utf8",
    );
    expect(chatBrowser).toContain('title="Threads couldn’t load"');
    expect(chatBrowser).toContain("setLoadError(true)");
    expect(chatBrowser).toContain('role={isMobile ? "dialog" : undefined}');
    expect(chatBrowser).toContain("restoreFocusRef.current?.focus()");
  });
});

describe("trading tiles", () => {
  it("swaps two panes and keeps every split's size where it was", () => {
    const layout = setSplitRatio(createAutomaticWorkbenchLayout(tabs.slice(0, 3))!, "split:root", 0.6);
    const swapped = swapWorkbenchPanes(layout, "doc", "deck");
    expect(collectWorkbenchTabs(swapped).map((tab) => tab.id)).toEqual(["deck", "sheet", "doc"]);
    expect(swapped.type === "split" && swapped.ratio).toBe(0.6);
    expect(validateWorkbenchTree(swapped)).toEqual([]);
    expect(swapWorkbenchPanes(layout, "doc", "doc")).toBe(layout);
  });
});
