// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../organization/tree-client";

const toast = vi.hoisted(() => {
  const fn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  });
  return fn;
});
vi.mock("sonner", () => ({ toast }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: () => undefined,
}));
vi.mock("../bridge/use-product-online", () => ({ useProductOnline: () => true }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => Date.now() }));
vi.mock("../data/idle-surface", () => ({ subscribeIdleSurfaceRefresh: () => () => {} }));

const tree = vi.hoisted(() => ({
  folder: [] as TreeNode[],
  trash: [] as TreeNode[],
  actions: {
    createFolder: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    trash: vi.fn(async () => ({})),
    restore: vi.fn(async () => ({})),
    purge: vi.fn(async () => ({})),
    setPinned: vi.fn(),
    createReference: vi.fn(),
    ensureRoots: vi.fn(async () => ({})),
    createWorkHere: vi.fn(),
  },
}));

vi.mock("../organization/tree-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../organization/tree-client")>();
  const page = (nodes: TreeNode[]) => ({
    nodes,
    results: nodes,
    status: "Exhausted" as const,
    loadMore: () => {},
    isLoading: false,
    active: false,
  });
  return {
    ...actual,
    useTreeActions: () => tree.actions,
    useTreeChildren: () => page(tree.folder),
    useTreeContainers: () => page([]),
    useTreeSearch: () => page([]),
    useTreeQuickView: () => page([]),
    useTreeTrash: (enabled: boolean) => (enabled ? tree.trash : null),
    useTreePath: () => null,
  };
});

import { LibraryOrganizer } from "../organization/library-organizer";

function node(nodeId: string, name: string, extra: Partial<TreeNode> = {}): TreeNode {
  return {
    nodeId,
    parentId: null,
    kind: "work",
    name,
    sourceId: `work-${nodeId}`,
    orderKey: nodeId,
    pinned: false,
    isContainer: false,
    createdAt: 0,
    updatedAt: 0,
    activityAt: 0,
    source: { updatedAt: 0, available: true, owned: true, shared: false },
    ...extra,
  };
}

function renderOrganizer() {
  return render(
    <LibraryOrganizer onOpenWork={vi.fn()} onOpenThread={vi.fn()} />,
  );
}

function selectFirstRowAndPress(key: string) {
  const grid = screen.getByRole("grid", { name: "Library items" });
  grid.focus();
  fireEvent.keyDown(grid, { key: "ArrowDown" });
  fireEvent.keyDown(grid, { key });
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  tree.folder = [node("n1", "Essay draft")];
  tree.trash = [node("t1", "Old notes", { trashedAt: 1 })];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LibraryOrganizer", () => {
  it("asks before deleting forever when Delete is pressed in the Trash", async () => {
    renderOrganizer();
    fireEvent.click(screen.getByRole("button", { name: /Trash/ }));
    await screen.findByText("Old notes");
    selectFirstRowAndPress("Delete");
    expect(tree.actions.trash).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toContain("Delete “Old notes” forever?");
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(tree.actions.purge).toHaveBeenCalledWith(["t1"]));
  });

  it("moves to the Trash when Delete is pressed in a folder", async () => {
    renderOrganizer();
    await screen.findByText("Essay draft");
    selectFirstRowAndPress("Delete");
    await waitFor(() => expect(tree.actions.trash).toHaveBeenCalledWith(["n1"]));
  });

  it("says so when Undo could not bring an item back", async () => {
    tree.actions.restore.mockRejectedValueOnce(new Error("offline"));
    renderOrganizer();
    await screen.findByText("Essay draft");
    selectFirstRowAndPress("Delete");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const options = toast.success.mock.calls[0]![1] as {
      action: { onClick: () => void };
    };
    await act(async () => {
      options.action.onClick();
    });
    await waitFor(() => expect(tree.actions.restore).toHaveBeenCalledWith(["n1"]));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
