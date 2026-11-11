// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../organization/tree-client";

const toast = vi.hoisted(() => {
  const fn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  });
  return fn;
});
vi.mock("sonner", () => ({ toast }));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: () => undefined,
  useMutation: () => tree.mutation,
  useConvex: () => ({
    query: vi.fn(async () => null),
    mutation: tree.mutation,
    watchQuery: () => ({ localQueryResult: () => undefined, onUpdate: () => () => {} }),
  }),
}));
vi.mock("../bridge/use-product-online", () => ({ useProductOnline: () => true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-now", () => ({ useNow: () => Date.now() }));
vi.mock("../data/idle-surface", () => ({ subscribeIdleSurfaceRefresh: () => () => {} }));

const tree = vi.hoisted(() => ({
  useRealActions: false,
  mutation: vi.fn(),
  children: vi.fn(),
  folder: [] as TreeNode[],
  search: [] as TreeNode[],
  searchStatus: "Exhausted" as "Exhausted" | "CanLoadMore" | "LoadingFirstPage",
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
    useTreeActions: () => tree.useRealActions ? actual.useTreeActions() : tree.actions,
    useTreeChildren: (parentId: string | null, options: object) => {
      tree.children(parentId, options);
      return page(tree.folder);
    },
    useTreeContainers: () => page([]),
    useTreeSearch: () => ({ ...page(tree.search), status: tree.searchStatus }),
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
  // The Library opens on the shelf; these cover the list, which the reader can choose instead.
  window.localStorage.setItem("spectra.library.view", "list");
  toast.error.mockReset();
  toast.success.mockReset();
  toast.dismiss.mockReset();
  tree.useRealActions = false;
  tree.mutation.mockReset().mockImplementation(() => Promise.resolve({}));
  tree.folder = [node("n1", "Essay draft")];
  tree.search = [];
  tree.searchStatus = "Exhausted";
  tree.trash = [node("t1", "Old notes", { trashedAt: 1 })];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("LibraryOrganizer", () => {
  it("skips the hidden folder listing on the shelf and resumes it for the list", () => {
    window.localStorage.setItem("spectra.library.view", "shelf");
    render(<LibraryOrganizer initialNodeId="folder-1" onOpenWork={vi.fn()} onOpenThread={vi.fn()} />);
    expect(tree.children).toHaveBeenLastCalledWith("folder-1", expect.objectContaining({ enabled: false }));
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(tree.children).toHaveBeenLastCalledWith("folder-1", expect.objectContaining({ enabled: true }));
    expect(screen.getByText("Essay draft")).toBeTruthy();
  });

  it("keeps the root shelf's listing subscribed", () => {
    window.localStorage.setItem("spectra.library.view", "shelf");
    renderOrganizer();
    expect(tree.children).toHaveBeenLastCalledWith(null, expect.objectContaining({ enabled: true }));
  });

  it("keeps focus in a newly created folder's name after the New menu closes", async () => {
    window.localStorage.setItem("spectra.library.view", "shelf");
    tree.folder = [];
    tree.actions.createFolder.mockImplementation(async () => {
      tree.folder = [node("new-folder", "New folder", { kind: "folder", isContainer: true, sourceId: undefined, source: undefined })];
      return { nodeId: "new-folder" };
    });
    renderOrganizer();
    fireEvent.keyDown(screen.getByRole("button", { name: "New" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "New folder" }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(document.activeElement).toBe(name));
    fireEvent.change(name, { target: { value: "Named on creation" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(tree.actions.rename).toHaveBeenCalledWith("new-folder", "Named on creation"));
    expect(window.localStorage.getItem("spectra.library.view")).toBe("shelf");
  });

  it("lets a folder on the shelf be renamed and returns to the shelf afterward", async () => {
    window.localStorage.setItem("spectra.library.view", "shelf");
    tree.folder = [node("folder-1", "Audit folder", { kind: "folder", isContainer: true, sourceId: undefined, source: undefined })];
    renderOrganizer();
    fireEvent.contextMenu(await screen.findByText("Audit folder"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "Renamed folder" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(tree.actions.rename).toHaveBeenCalledWith("folder-1", "Renamed folder"));
    expect(screen.queryByRole("grid", { name: "Library items" })).toBeNull();
    expect(window.localStorage.getItem("spectra.library.view")).toBe("shelf");
  });

  it("keeps every place in the list's quick access pane", async () => {
    renderOrganizer();
    const places = screen.getByRole("navigation", { name: "Quick access" });
    for (const name of ["Recent", "Favorites", "Shared", "Trash"]) {
      expect(within(places).getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(within(places).getByRole("button", { name: "Trash" }));
    expect(await screen.findByText("Old notes")).toBeTruthy();
  });

  it("labels broad search results and names the work Enter will open", async () => {
    tree.search = [node("s1", "Water Cycle Field Guide"), node("s2", "Draft notes")];
    const onOpenWork = vi.fn();
    render(<LibraryOrganizer onOpenWork={onOpenWork} onOpenThread={vi.fn()} />);
    const input = screen.getByRole("searchbox", { name: "Search Library" });
    fireEvent.change(input, { target: { value: "Photosynthesis lecture draft" } });
    expect(screen.getAllByText("Partial match")).toHaveLength(2);
    expect(screen.getByText("No exact title match. Showing ranked partial matches.")).toBeTruthy();
    expect(screen.getByText('Enter in search opens “Water Cycle Field Guide”.')).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenWork).toHaveBeenCalledWith("work-s1");
  });

  it("distinguishes exact titles without changing the provider's result order", () => {
    tree.search = [node("s1", "Photosynthesis notes"), node("s2", "PHOTOSYNTHESIS   lecture draft")];
    renderOrganizer();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Library" }), {
      target: { value: "  Photosynthesis lecture draft  " },
    });
    const rows = screen.getAllByRole("row");
    expect(rows.map((row) => row.getAttribute("data-node-row"))).toEqual(["s1", "s2"]);
    expect(rows[0]!.textContent).toContain("Partial match");
    expect(rows[1]!.textContent).toContain("Exact title match");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.queryByText("Partial match")).toBeNull();
    expect(screen.queryByText("Exact title match")).toBeNull();
    expect(screen.queryByText(/Enter in search opens/)).toBeNull();
  });

  it("names the selected result's Enter target separately from the search input", () => {
    tree.search = [node("s1", "Water Cycle Field Guide"), node("s2", "Draft notes")];
    const onOpenWork = vi.fn();
    render(<LibraryOrganizer onOpenWork={onOpenWork} onOpenThread={vi.fn()} />);
    const input = screen.getByRole("searchbox", { name: "Search Library" });
    fireEvent.change(input, { target: { value: "Photosynthesis lecture draft" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const grid = screen.getByRole("grid", { name: "Library items" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(screen.getByText('Enter in results opens “Draft notes”.')).toBeTruthy();
    expect(screen.getByText('Enter in search opens “Water Cycle Field Guide”.')).toBeTruthy();
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onOpenWork).toHaveBeenCalledWith("work-s2");
  });

  it("keeps Enter in the unfiltered search input opening the first visible work", () => {
    const onOpenWork = vi.fn();
    render(<LibraryOrganizer onOpenWork={onOpenWork} onOpenThread={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search Library" }), { key: "Enter" });
    expect(onOpenWork).toHaveBeenCalledWith("work-n1");
    expect(screen.queryByText(/Enter in search opens/)).toBeNull();
  });

  it("qualifies partial results while further search pages remain", () => {
    tree.search = [node("s1", "Water Cycle Field Guide")];
    tree.searchStatus = "CanLoadMore";
    renderOrganizer();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Library" }), {
      target: { value: "Photosynthesis lecture draft" },
    });
    expect(screen.getByText("No exact title match in the loaded results. Showing ranked partial matches.")).toBeTruthy();
  });

  it("does not announce or open stale results while a new search loads", () => {
    tree.search = [node("s1", "Water Cycle Field Guide")];
    tree.searchStatus = "LoadingFirstPage";
    const onOpenWork = vi.fn();
    render(<LibraryOrganizer onOpenWork={onOpenWork} onOpenThread={vi.fn()} />);
    const input = screen.getByRole("searchbox", { name: "Search Library" });
    fireEvent.change(input, { target: { value: "Photosynthesis lecture draft" } });
    expect(screen.getByText("Searching titles…")).toBeTruthy();
    expect(screen.queryByText(/Enter in search opens/)).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenWork).not.toHaveBeenCalled();
  });

  it("asks before deleting forever when Delete is pressed in the Trash", async () => {
    renderOrganizer();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Quick access" })).getByRole("button", { name: "Trash" }));
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

  it("keeps one real Retry notice through repeated offline failures and clears it after success", async () => {
    const sonner = await vi.importActual<typeof import("sonner")>("sonner");
    toast.success.mockImplementation(sonner.toast.success);
    toast.error.mockImplementation(sonner.toast.error);
    toast.dismiss.mockImplementation(sonner.toast.dismiss);
    tree.useRealActions = true;
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<><LibraryOrganizer onOpenWork={vi.fn()} onOpenThread={vi.fn()} /><sonner.Toaster position="top-right" /></>);
    try {
      selectFirstRowAndPress("Delete");
      const undo = await screen.findByRole("button", { name: "Undo" });
      tree.mutation.mockClear();
      online.mockReturnValue(false);
      fireEvent.click(undo);
      await screen.findByRole("button", { name: "Retry" });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(attempt + 2));
        expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
      }
      expect(tree.mutation).not.toHaveBeenCalled();
      const firstId = toast.error.mock.results[0]!.value;
      expect(toast.error.mock.calls.slice(1).every((call) => call[1]?.id === firstId)).toBe(true);
      online.mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(tree.mutation).toHaveBeenCalledExactlyOnceWith({ nodeIds: ["n1"] }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
    } finally {
      sonner.toast.dismiss();
    }
  });

  it("rejects offline Undo before enqueueing and retries the same restore after reconnect", async () => {
    tree.useRealActions = true;
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    renderOrganizer();
    await screen.findByText("Essay draft");
    selectFirstRowAndPress("Delete");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const options = toast.success.mock.calls[0]![1] as { action: { onClick: () => void } };
    tree.mutation.mockClear();
    online.mockReturnValue(false);
    // Convex retains an unsent mutation in memory rather than rejecting it.
    tree.mutation.mockImplementation(() => new Promise(() => {}));
    await act(async () => { options.action.onClick(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(tree.mutation).not.toHaveBeenCalled();
    const [message, failure] = toast.error.mock.calls[0]! as [string, { action: { label: string; onClick: (event: MouseEvent) => void } }];
    expect(message).toMatch(/offline.*reconnect/i);
    expect(failure.action.label).toBe("Retry");
    online.mockReturnValue(true);
    tree.mutation.mockResolvedValue({});
    await act(async () => { failure.action.onClick(new MouseEvent("click", { cancelable: true })); });
    expect(tree.mutation).toHaveBeenCalledExactlyOnceWith({ nodeIds: ["n1"] });
  });
});
