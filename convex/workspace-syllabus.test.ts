/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Two versions of one bundled syllabus, swapped between steps. */
const bundle = vi.hoisted(() => {
  const physics = (version: string, extra = "") => ({
    id: "physics",
    title: "Physics",
    programme: "IB Diploma Programme",
    levels: ["SL", "HL"],
    match: ["physics"],
    version,
    sections: [],
    markdown: `# A. Space, time and motion\n\n## A.1 Kinematics\n\n- Motion${extra}\n\n## A.4 Rigid bodies (HL)\n\n- Torque`,
  });
  return { current: [physics("v1")], physics, version: { value: "bundle-1" } };
});
vi.mock("../shared/syllabus/bundle.generated", () => ({
  get SYLLABUS_BUNDLE() {
    return bundle.current;
  },
}));
vi.mock("../shared/syllabus/catalog.generated", () => ({
  get SYLLABUS_BUNDLE_VERSION() {
    return bundle.version.value;
  },
  SYLLABUS_CATALOG: [],
}));

const modules = import.meta.glob("./**/*.ts");

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seed(t: ReturnType<typeof setupTest>, title: string) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Syllabus School", slug: `syllabus-${crypto.randomUUID()}`, verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: `clerk_${crypto.randomUUID()}`, email: "syllabus@example.test", emailVerified: true, name: "Syllabus",
      status: "active", createdAt: now, updatedAt: now,
    });
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: accountId, schoolId, title, starterKey: "managebac-class", status: "active", defaultView: "cards",
      createdAt: now, updatedAt: now, lastActivityAt: now,
    });
    return { accountId, workspaceId };
  });
}

async function state(t: ReturnType<typeof setupTest>, workspaceId: Id<"spectraWorkspaces">) {
  return t.run(async (ctx) => {
    const workspace = (await ctx.db.get(workspaceId))!;
    const artifact = workspace.syllabus?.artifactId ? await ctx.db.get(workspace.syllabus.artifactId) : null;
    const nodes = artifact
      ? await ctx.db.query("orgNodes").withIndex("by_kind_source", (q) => q.eq("kind", "work").eq("sourceId", String(artifact._id))).collect()
      : [];
    const all = await ctx.db.query("spectraArtifacts").collect();
    return { workspace, artifact, nodes, count: all.length };
  });
}

describe("workspace syllabus", () => {
  it("gives a matching class its syllabus as a pinned, read-only first artifact", async () => {
    const t = setupTest();
    const { workspaceId } = await seed(t, "Physics SL");
    await t.mutation(internal.workspaceSyllabus.ensure, { workspaceId, className: "Physics SL" });
    const { workspace, artifact, nodes } = await state(t, workspaceId);
    expect(workspace.syllabus).toMatchObject({ id: "physics", level: "SL", version: "v1" });
    expect(workspace.syllabusBundle).toBe("bundle-1");
    expect(artifact).toMatchObject({ title: "Physics SL syllabus", blueprintKey: "document", syllabus: { id: "physics", level: "SL", version: "v1" } });
    // SL leaves the HL-only section out.
    expect(JSON.stringify(artifact!.content)).toContain("Kinematics");
    expect(JSON.stringify(artifact!.content)).not.toContain("Torque");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ pinned: true, workspaceContextId: workspaceId });
  });

  it("does nothing more for an unchanged syllabus, and swaps in a fresh copy when it changes", async () => {
    const t = setupTest();
    const { workspaceId } = await seed(t, "Physics HL");
    await t.mutation(internal.workspaceSyllabus.ensure, { workspaceId, className: "Physics HL" });
    const first = await state(t, workspaceId);
    await t.mutation(internal.workspaceSyllabus.ensure, { workspaceId, className: "Physics HL" });
    expect((await state(t, workspaceId)).count).toBe(first.count);

    bundle.current = [bundle.physics("v2", " and projectiles")];
    bundle.version.value = "bundle-2";
    await t.mutation(internal.workspaceSyllabus.ensure, { workspaceId, className: "Physics HL" });
    const second = await state(t, workspaceId);
    expect(second.artifact!._id).not.toBe(first.artifact!._id);
    expect(JSON.stringify(second.artifact!.content)).toContain("projectiles");
    expect(JSON.stringify(second.artifact!.content)).toContain("Torque");
    const old = await t.run(async (ctx) =>
      ctx.db.query("orgNodes").withIndex("by_kind_source", (q) => q.eq("kind", "work").eq("sourceId", String(first.artifact!._id))).collect(),
    );
    expect(old.every((node) => node.deletedAt !== undefined)).toBe(true);
    bundle.current = [bundle.physics("v1")];
    bundle.version.value = "bundle-1";
  });

  it("leaves a class with no matching syllabus alone, and does not bring back one its owner trashed", async () => {
    const t = setupTest();
    const history = await seed(t, "History HL");
    await t.mutation(internal.workspaceSyllabus.ensure, { workspaceId: history.workspaceId, className: "History HL" });
    const none = await state(t, history.workspaceId);
    expect(none.workspace.syllabus).toBeUndefined();
    expect(none.workspace.syllabusBundle).toBe("bundle-1");
    expect(none.count).toBe(0);

    const physics = await seed(t, "Physics HL");
    await t.mutation(internal.workspaceSyllabus.ensure, { workspaceId: physics.workspaceId, className: "Physics HL" });
    const placed = await state(t, physics.workspaceId);
    await t.run(async (ctx) => {
      for (const node of placed.nodes) await ctx.db.patch(node._id, { deletedAt: Date.now() });
    });
    bundle.current = [bundle.physics("v3")];
    await t.mutation(internal.workspaceSyllabus.ensure, { workspaceId: physics.workspaceId, className: "Physics HL" });
    expect((await state(t, physics.workspaceId)).count).toBe(placed.count);
    bundle.current = [bundle.physics("v1")];
  });
});
