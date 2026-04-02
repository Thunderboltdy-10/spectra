import { describe, expect, it } from "vitest";
import { syncWorkspaceItemForArtifact } from "../../../convex/workspaceItemSync";

type WorkspaceItemRecord = {
  _id: string;
  ownerUserId: string;
  orgId: string;
  workstreamId?: string;
  itemType?: string;
  sourceKind?: string;
  sourceId?: string;
  sourceArtifactId?: string;
  type: string;
  renderMode?: string;
  title: string;
  contentSummary?: string;
  category?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  status: "active" | "archived";
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};

function createCtx(items: WorkspaceItemRecord[] = []) {
  let insertCount = 0;

  return {
    db: {
      query(table: string) {
        if (table !== "workspaceItems") {
          throw new Error(`Unexpected table: ${table}`);
        }
        return {
          withIndex() {
            return {
              async collect() {
                return items;
              },
            };
          },
        };
      },
      async patch(id: string, updates: Partial<WorkspaceItemRecord>) {
        const index = items.findIndex((item) => item._id === id);
        if (index === -1) throw new Error(`Unknown item: ${id}`);
        items[index] = { ...items[index], ...updates };
      },
      async insert(_: string, value: Omit<WorkspaceItemRecord, "_id">) {
        insertCount += 1;
        const next = { _id: `item_${insertCount}`, ...value };
        items.push(next);
        return next._id;
      },
    },
    items,
  };
}

describe("syncWorkspaceItemForArtifact", () => {
  it("creates a pinned widget for active workstream artifacts", async () => {
    const ctx = createCtx();

    await syncWorkspaceItemForArtifact(ctx as never, {
      artifactId: "artifact_1" as never,
      ownerUserId: "user_1" as never,
      orgId: "org_1" as never,
      workstreamId: "ws_1" as never,
      status: "active",
      title: "Essay Draft",
      artifactType: "document",
      contentPlaintext: "First paragraph.\n\nSecond paragraph.",
    });

    expect(ctx.items).toHaveLength(1);
    expect(ctx.items[0]).toEqual(expect.objectContaining({
      itemType: "artifact",
      sourceKind: "artifact",
      sourceId: "artifact_1",
      sourceArtifactId: "artifact_1",
      workstreamId: "ws_1",
      type: "document",
      renderMode: "document",
      category: "documents",
      title: "Essay Draft",
      contentSummary: "First paragraph. Second paragraph.",
      x: 80,
      y: 220,
      width: 280,
      height: 160,
      status: "active",
      pinned: true,
    }));
  });

  it("updates an existing widget without disturbing its layout", async () => {
    const ctx = createCtx([
      {
        _id: "item_1",
        ownerUserId: "user_1",
        orgId: "org_1",
        workstreamId: "ws_1",
        sourceArtifactId: "artifact_1",
        type: "document",
        renderMode: "document",
        title: "Old title",
        contentSummary: "Old summary",
        x: 420,
        y: 315,
        width: 280,
        height: 160,
        status: "active",
        pinned: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    await syncWorkspaceItemForArtifact(ctx as never, {
      artifactId: "artifact_1" as never,
      ownerUserId: "user_1" as never,
      orgId: "org_1" as never,
      workstreamId: "ws_2" as never,
      status: "active",
      title: "Revised title",
      artifactType: "image",
      contentPlaintext: "Updated summary text",
    });

    expect(ctx.items).toHaveLength(1);
    expect(ctx.items[0]).toEqual(expect.objectContaining({
      _id: "item_1",
      workstreamId: "ws_2",
      itemType: "artifact",
      sourceKind: "artifact",
      sourceId: "artifact_1",
      type: "media",
      renderMode: "image",
      category: "media",
      title: "Revised title",
      contentSummary: "Updated summary text",
      x: 420,
      y: 315,
      width: 280,
      height: 160,
      status: "active",
    }));
  });

  it("archives the widget when the artifact is no longer workspace-active", async () => {
    const ctx = createCtx([
      {
        _id: "item_1",
        ownerUserId: "user_1",
        orgId: "org_1",
        workstreamId: "ws_1",
        sourceArtifactId: "artifact_1",
        type: "document",
        renderMode: "document",
        title: "Essay Draft",
        contentSummary: "Current summary",
        x: 80,
        y: 220,
        width: 280,
        height: 160,
        status: "active",
        pinned: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    await syncWorkspaceItemForArtifact(ctx as never, {
      artifactId: "artifact_1" as never,
      ownerUserId: "user_1" as never,
      orgId: "org_1" as never,
      workstreamId: undefined,
      status: "active",
      title: "Essay Draft",
      artifactType: "document",
      contentPlaintext: "Current summary",
    });

    expect(ctx.items[0]).toEqual(expect.objectContaining({
      _id: "item_1",
      status: "archived",
      x: 80,
      y: 220,
    }));
  });
});
