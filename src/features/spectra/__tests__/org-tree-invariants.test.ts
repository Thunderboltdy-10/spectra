import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeDb,
  fakeCtx,
  seedAccount,
  seedArtifact,
  seedWorkspace,
} from "@/test/org-tree-db";
import {
  GENERAL_STARTER_KEY,
  createFolderNode,
  createLinkNode,
  dissolveWorkspaceNode,
  ensureGeneralNode,
  ensureWorkspaceNode,
  findNodesForSource,
  findPrimaryNode,
  listChildNodes,
  moveNode,
  placeSourceNode,
  purgeAccountSourceNodes,
  syncSourceNodes,
  restoreTrashedNode,
  trashNode,
  workspaceContextNodes,
} from "../../../../convex/orgTreeShared";
import { compareOrderKeys } from "../organization/order-key";

/**
 * The four invariants every organizational read in the product trusts:
 * one primary placement per source (I1), a move is metadata only (I4), no
 * cycles (I5), and `workspaceContextId` always equals the nearest workspace
 * ancestor — with a nested workspace keeping its own (D32).
 *
 * These run the real writers from `convex/orgTreeShared.ts` against an
 * in-memory database, so a regression in the tree fails here rather than in
 * somebody's Library.
 */

type Ctx = ReturnType<typeof fakeCtx>["ctx"];

let db: FakeDb;
let ctx: Ctx;
let accountId: string;

beforeEach(async () => {
  const made = fakeCtx();
  db = made.db;
  ctx = made.ctx;
  accountId = await seedAccount(db);
});

/** Cast helper: the fake stores plain strings where Convex stores branded ids. */
const id = (value: string) => value as never;

async function nodesFor(kind: string, sourceId: string) {
  return await findNodesForSource(ctx, kind as never, sourceId);
}

async function contextOf(nodeId: string) {
  return (await db.get(nodeId))?.workspaceContextId as string | undefined;
}

async function placeWork(
  artifactId: string,
  options: { workspaceId?: string; parentId?: string | null; relocate?: boolean } = {},
) {
  return await placeSourceNode(ctx, {
    accountId: id(accountId),
    kind: "work",
    sourceId: artifactId,
    name: "Essay",
    relocate: options.relocate,
    target:
      options.parentId !== undefined
        ? { parentId: id(options.parentId as string) }
        : options.workspaceId
          ? { workspaceId: id(options.workspaceId) }
          : {},
  });
}

describe("I1 — one primary placement per source", () => {
  it("re-placing the same work reuses its single node", async () => {
    const workspace = await seedWorkspace(db, accountId, "Biology");
    const artifactId = await seedArtifact(db, accountId, "Essay");

    const first = await placeWork(artifactId, { workspaceId: workspace._id });
    const second = await placeWork(artifactId, { workspaceId: workspace._id });

    expect(second._id).toBe(first._id);
    expect(await nodesFor("work", artifactId)).toHaveLength(1);
  });

  it("moving to another workspace moves the node instead of adding one", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const history = await seedWorkspace(db, accountId, "History");
    const artifactId = await seedArtifact(db, accountId, "Essay");

    const placed = await placeWork(artifactId, { workspaceId: biology._id });
    const moved = await placeWork(artifactId, { workspaceId: history._id });

    expect(moved._id).toBe(placed._id);
    expect(await nodesFor("work", artifactId)).toHaveLength(1);
    expect(await contextOf(moved._id)).toBe(history._id);
    expect(
      await workspaceContextNodes(ctx, id(biology._id), "work"),
    ).toHaveLength(0);
  });

  it("a relocation with no workspace named lands in General, never nowhere", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const artifactId = await seedArtifact(db, accountId, "Essay");
    await placeWork(artifactId, { workspaceId: biology._id });

    const moved = await placeWork(artifactId, { relocate: true });
    const general = db
      .all("spectraWorkspaces")
      .find((row) => row.starterKey === GENERAL_STARTER_KEY);

    expect(general).toBeTruthy();
    expect(await contextOf(moved._id)).toBe(general!._id);
    expect(moved.parentId).not.toBeNull();
  });

  it("re-asserting the same workspace does not flatten a work out of its folder", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const workspaceNode = await ensureWorkspaceNode(ctx, biology as never);
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: workspaceNode._id,
    });
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const placed = await placeWork(artifactId, { workspaceId: biology._id });
    await moveNode(ctx, placed, { parentId: folder._id });

    const reasserted = await placeWork(artifactId, {
      workspaceId: biology._id,
    });

    expect(reasserted.parentId).toBe(folder._id);
    expect(await contextOf(reasserted._id)).toBe(biology._id);
  });

  it("a rename reaches the node and every reference to it", async () => {
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const node = await placeWork(artifactId);
    const link = await createLinkNode(ctx, {
      accountId: id(accountId),
      targetNodeId: node._id,
      parentId: null,
    });

    await syncSourceNodes(ctx, "work", artifactId, "  Photosynthesis  ");

    expect((await db.get(node._id))?.name).toBe("Photosynthesis");
    expect((await db.get(link._id))?.name).toBe("Photosynthesis");
  });
});

describe("I5 — no cycles, and only containers hold children", () => {
  it("refuses to move a folder inside itself", async () => {
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: null,
    });
    await expect(
      moveNode(ctx, folder, { parentId: folder._id }),
    ).rejects.toThrow(/inside itself/);
  });

  it("refuses to move a folder into its own descendant", async () => {
    const outer = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Outer",
      parentId: null,
    });
    const inner = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Inner",
      parentId: outer._id,
    });
    const deepest = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Deepest",
      parentId: inner._id,
    });

    await expect(
      moveNode(ctx, outer, { parentId: deepest._id }),
    ).rejects.toThrow(/inside itself/);
    expect((await db.get(outer._id))?.parentId).toBeNull();
  });

  it("refuses to put anything inside a work or a reference", async () => {
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const work = await placeWork(artifactId);
    const link = await createLinkNode(ctx, {
      accountId: id(accountId),
      targetNodeId: work._id,
      parentId: null,
    });
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: null,
    });

    await expect(moveNode(ctx, folder, { parentId: work._id })).rejects.toThrow(
      /Only folders and workspaces/,
    );
    await expect(moveNode(ctx, folder, { parentId: link._id })).rejects.toThrow(
      /reference cannot contain/,
    );
  });

  it("refuses to file anything into a trashed destination", async () => {
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: null,
    });
    await trashNode(ctx, folder);
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const work = await placeWork(artifactId);

    await expect(
      moveNode(ctx, work, { parentId: folder._id }),
    ).rejects.toThrow(/in the trash/);
  });
});

describe("workspaceContextId follows the nearest workspace ancestor", () => {
  it("stamps a whole subtree when a folder changes workspace", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const history = await seedWorkspace(db, accountId, "History");
    const biologyNode = await ensureWorkspaceNode(ctx, biology as never);
    const historyNode = await ensureWorkspaceNode(ctx, history as never);
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: biologyNode._id,
    });
    const nested = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Notes",
      parentId: folder._id,
    });
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const work = await placeWork(artifactId, { parentId: nested._id });
    expect(await contextOf(work._id)).toBe(biology._id);

    await moveNode(ctx, folder, { parentId: historyNode._id });

    for (const nodeId of [folder._id, nested._id, work._id])
      expect(await contextOf(nodeId)).toBe(history._id);
  });

  it("a nested workspace keeps its own context, and so does its content (D32)", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const project = await seedWorkspace(db, accountId, "Field Project");
    const biologyNode = await ensureWorkspaceNode(ctx, biology as never);
    const projectNode = await ensureWorkspaceNode(ctx, project as never);
    const artifactId = await seedArtifact(db, accountId, "Field notes");
    const work = await placeWork(artifactId, { workspaceId: project._id });

    await moveNode(ctx, projectNode, { parentId: biologyNode._id });

    expect(await contextOf(projectNode._id)).toBe(project._id);
    expect(await contextOf(work._id)).toBe(project._id);
    expect(
      await workspaceContextNodes(ctx, id(biology._id), "work"),
    ).toHaveLength(0);
  });

  it("keeps a nested workspace's context when the folder above it moves", async () => {
    /* The workspace is a descendant of the moved subtree rather than its root,
       which is the case a whole-subtree stamp gets wrong: descent stops at the
       nested workspace, but the node itself is still in the collected list. */
    const holder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Projects",
      parentId: null,
    });
    const project = await seedWorkspace(db, accountId, "Field Project");
    const projectNode = await ensureWorkspaceNode(ctx, project as never);
    await moveNode(ctx, projectNode, { parentId: holder._id });
    const artifactId = await seedArtifact(db, accountId, "Field notes");
    const work = await placeWork(artifactId, { workspaceId: project._id });
    const biology = await seedWorkspace(db, accountId, "Biology");
    const biologyNode = await ensureWorkspaceNode(ctx, biology as never);

    await moveNode(ctx, holder, { parentId: biologyNode._id });

    expect(await contextOf(holder._id)).toBe(biology._id);
    expect(await contextOf(projectNode._id)).toBe(project._id);
    expect(await contextOf(work._id)).toBe(project._id);
  });

  it("clears the context when a node moves to the Library root", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const work = await placeWork(artifactId, { workspaceId: biology._id });

    await moveNode(ctx, work, { parentId: null });

    expect(await contextOf(work._id)).toBeUndefined();
  });

  it("a move touches only placement metadata (I4)", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const work = await placeWork(artifactId, { workspaceId: biology._id });
    const before = await db.get(work._id);
    db.patches = [];

    await moveNode(ctx, work, { parentId: null });

    const touched = new Set(db.patches.flatMap((entry) => entry.keys));
    expect([...touched].sort()).toEqual([
      "orderKey",
      "parentId",
      "updatedAt",
      "workspaceContextId",
    ]);
    const after = await db.get(work._id);
    expect(after?.name).toBe(before?.name);
    expect(after?.sourceId).toBe(before?.sourceId);
    expect(after?.kind).toBe(before?.kind);
  });
});

describe("order keys keep a reader's arrangement", () => {
  it("appends each new sibling after the last, trashed ones included", async () => {
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: null,
    });
    const keys: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const artifactId = await seedArtifact(db, accountId, `Essay ${index}`);
      const node = await placeWork(artifactId, { parentId: folder._id });
      keys.push(node.orderKey);
    }

    expect(keys).toEqual([...keys].sort(compareOrderKeys));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a restore lands after the siblings that stayed", async () => {
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: null,
    });
    const firstId = await seedArtifact(db, accountId, "First");
    const first = await placeWork(firstId, { parentId: folder._id });
    await trashNode(ctx, first);
    const secondId = await seedArtifact(db, accountId, "Second");
    const second = await placeWork(secondId, { parentId: folder._id });

    expect(compareOrderKeys(first.orderKey, second.orderKey)).toBeLessThan(0);
    await restoreTrashedNode(ctx, (await db.get(first._id))! as never);
    const live = await listChildNodes(ctx, id(accountId), id(folder._id));
    expect(live.map((row) => row._id)).toEqual([first._id, second._id]);
  });
});

describe("trash keeps a subtree whole, and General survives everything", () => {
  it("trashes and restores a folder's whole subtree in one move", async () => {
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: null,
    });
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const work = await placeWork(artifactId, { parentId: folder._id });

    const trashed = await trashNode(ctx, folder);
    expect(trashed.trashed).toBe(2);
    expect((await db.get(work._id))?.trashedRootId).toBe(folder._id);
    expect(await listChildNodes(ctx, id(accountId), id(folder._id))).toHaveLength(
      0,
    );

    const restored = await restoreTrashedNode(
      ctx,
      (await db.get(folder._id))! as never,
    );
    expect(restored.restored).toBe(2);
    expect((await db.get(work._id))?.deletedAt).toBeUndefined();
    expect((await db.get(work._id))?.trashedRootId).toBeUndefined();
  });

  it("restores to the root when the original parent is gone", async () => {
    const outer = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Outer",
      parentId: null,
    });
    const inner = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Inner",
      parentId: outer._id,
    });
    await trashNode(ctx, inner);
    await trashNode(ctx, outer);

    await restoreTrashedNode(ctx, (await db.get(inner._id))! as never);

    expect((await db.get(inner._id))?.parentId).toBeNull();
    expect((await db.get(inner._id))?.deletedAt).toBeUndefined();
  });

  it("lifts General out of a folder being trashed rather than burying it", async () => {
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Everything",
      parentId: null,
    });
    const general = await ensureGeneralNode(ctx, id(accountId));
    await moveNode(ctx, general.node, { parentId: folder._id });

    await trashNode(ctx, folder);

    const generalNode = await db.get(general.node._id);
    expect(generalNode?.deletedAt).toBeUndefined();
    expect(generalNode?.parentId).toBeNull();
    expect(generalNode?.workspaceContextId).toBe(general.workspace._id);
  });

  it("never deletes General", async () => {
    const general = await ensureGeneralNode(ctx, id(accountId));
    await expect(
      trashNode(ctx, general.node as never),
    ).rejects.toThrow(/General cannot be deleted/);
    await expect(
      dissolveWorkspaceNode(ctx, general.workspace as never),
    ).rejects.toThrow(/General cannot be deleted/);
  });
});

describe("dissolving a workspace keeps its contents", () => {
  it("moves live children to General and keeps folder shape", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const workspaceNode = await ensureWorkspaceNode(ctx, biology as never);
    const folder = await createFolderNode(ctx, {
      accountId: id(accountId),
      name: "Unit 3",
      parentId: workspaceNode._id,
    });
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const work = await placeWork(artifactId, { parentId: folder._id });

    const result = await dissolveWorkspaceNode(ctx, biology as never);

    const general = db
      .all("spectraWorkspaces")
      .find((row) => row.starterKey === GENERAL_STARTER_KEY)!;
    const generalNode = await findPrimaryNode(
      ctx,
      id(accountId),
      "workspace",
      general._id as string,
    );
    expect(result.purged).toBe(1);
    expect((await db.get(folder._id))?.parentId).toBe(generalNode!._id);
    expect((await db.get(work._id))?.parentId).toBe(folder._id);
    expect(await contextOf(work._id)).toBe(general._id);
    expect(await nodesFor("workspace", biology._id)).toHaveLength(0);
  });

  it("re-parents a trashed child so a later restore still lands somewhere", async () => {
    const biology = await seedWorkspace(db, accountId, "Biology");
    const workspaceNode = await ensureWorkspaceNode(ctx, biology as never);
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const work = await placeWork(artifactId, { parentId: workspaceNode._id });
    await trashNode(ctx, work);

    await dissolveWorkspaceNode(ctx, biology as never);

    const general = db
      .all("spectraWorkspaces")
      .find((row) => row.starterKey === GENERAL_STARTER_KEY)!;
    const generalNode = await findPrimaryNode(
      ctx,
      id(accountId),
      "workspace",
      general._id as string,
    );
    const trashedWork = await db.get(work._id);
    expect(trashedWork?.deletedAt).toBeDefined();
    expect(trashedWork?.parentId).toBe(generalNode!._id);

    await restoreTrashedNode(ctx, trashedWork! as never);
    expect((await db.get(work._id))?.parentId).toBe(generalNode!._id);
    expect(await contextOf(work._id)).toBe(general._id);
  });
});

describe("revoked access removes only the recipient's filing", () => {
  it("purges one account's placement and its references, not the owner's", async () => {
    const otherAccountId = await seedAccount(db);
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const ownerNode = await placeWork(artifactId);
    const recipientNode = await placeSourceNode(ctx, {
      accountId: id(otherAccountId),
      kind: "work",
      sourceId: artifactId,
      name: "Essay",
    });
    const reference = await createLinkNode(ctx, {
      accountId: id(otherAccountId),
      targetNodeId: recipientNode._id,
      parentId: null,
    });

    const purged = await purgeAccountSourceNodes(
      ctx,
      id(otherAccountId),
      "work",
      artifactId,
    );

    expect(purged).toBe(1);
    expect(await db.get(recipientNode._id)).toBeNull();
    expect(await db.get(reference._id)).toBeNull();
    expect(await db.get(ownerNode._id)).not.toBeNull();
  });

  it("keeps a placement the owner made on the recipient's behalf", async () => {
    const otherAccountId = await seedAccount(db);
    const artifactId = await seedArtifact(db, accountId, "Essay");
    const projected = await placeSourceNode(ctx, {
      accountId: id(otherAccountId),
      kind: "work",
      sourceId: artifactId,
      name: "Essay",
      accessProjection: true,
    });

    const purged = await purgeAccountSourceNodes(
      ctx,
      id(otherAccountId),
      "work",
      artifactId,
      { keepProjecting: true },
    );

    expect(purged).toBe(0);
    expect(await db.get(projected._id)).not.toBeNull();
  });
});
