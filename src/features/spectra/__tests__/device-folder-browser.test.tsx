// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../organization/tree-client";

const tree = vi.hoisted(() => ({ children: vi.fn(), placed: [] as unknown[] }));
vi.mock("../organization/tree-client", async (original) => ({
  ...(await original<typeof import("../organization/tree-client")>()),
  useTreeChildren: tree.children,
}));
vi.mock("../devices/place-in-menu", () => ({
  PlaceInMenu: ({ items, skip, children }: { items: unknown[]; skip: Set<string>; children: ReactNode }) => {
    tree.placed = [items, [...skip]];
    return <>{children}</>;
  },
}));
import { DeviceFolderBrowser } from "../devices/device-folder-browser";

const node = (nodeId: string, kind: TreeNode["kind"], name: string, extra: Partial<TreeNode> = {}) =>
  ({ nodeId, parentId: "root", kind, name, orderKey: nodeId, pinned: false, isContainer: kind !== "work", createdAt: 1, updatedAt: 1, activityAt: 1, ...extra }) as TreeNode;

const rows: Record<string, TreeNode[]> = {
  root: [node("w1", "work", "Essay.docx", { sourceId: "art-1" }), node("f1", "folder", "Labs"), node("w2", "work", "Notes.txt"), node("w3", "work", "Data.xlsx")],
  f1: [node("w4", "work", "Lab 1.docx")],
};

beforeEach(() => {
  tree.children.mockImplementation((id: string) => ({ nodes: rows[id] ?? [], status: "Exhausted", loadMore: vi.fn() }));
});
afterEach(cleanup);

describe("files in a folder on a computer", () => {
  it("lists folders first, opens an artifact, and opens a folder into the path", () => {
    render(<DeviceFolderBrowser rootNodeId="root" name="School" onClose={vi.fn()} />);
    const names = screen.getAllByRole("checkbox", { name: /^Select / }).map((box) => box.getAttribute("aria-label")).filter(Boolean);
    expect(names).toEqual(["Select Labs", "Select Essay.docx", "Select Notes.txt", "Select Data.xlsx"]);
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/library?artifactId=art-1");
    fireEvent.click(screen.getByRole("button", { name: "Labs" }));
    expect(screen.getByText("Lab 1.docx")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "School" }));
    expect(screen.getByText("Essay.docx")).toBeTruthy();
  });

  it("picks with shift for a range, sends the picks, and adds nothing until something is picked", () => {
    render(<DeviceFolderBrowser rootNodeId="root" name="School" onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add to…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Essay.docx" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Data.xlsx" }), { shiftKey: true });
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(tree.placed).toEqual([
      [{ nodeId: "w1", name: "Essay.docx" }, { nodeId: "w2", name: "Notes.txt" }, { nodeId: "w3", name: "Data.xlsx" }],
      ["root"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Select files to add them to a workspace or folder.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select everything here" }));
    expect(screen.getByText("4 selected")).toBeTruthy();
  });

  it("says when a folder is still empty", () => {
    render(<DeviceFolderBrowser rootNodeId="empty" name="New" onClose={vi.fn()} />);
    expect(screen.getByText("Nothing here yet. Files appear as they sync.")).toBeTruthy();
  });
});
