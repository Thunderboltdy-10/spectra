/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { evaluateAccessForActor, evaluateAccessForActorWithLoadedResource, evaluateArtifactAccessForActor, requireActorArtifactCapability } from "./authorityShared";
import { getActorForAccountId } from "./identityShared";
import { ensureWorkspaceSyllabus } from "./workspaceSyllabus";

const modules = import.meta.glob("./**/*.ts");

describe("syllabus authority and bounded refresh", () => {
  it("denies authored writes to the owner through full and summary authority, with no body read on unchanged refresh", async () => {
    const t = convexTest(schema, modules);
    for (const component of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"])
      aggregateTest.register(t, component);
    const { accountId, workspaceId } = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", { name: "IB", slug: "ib-syllabus-authority", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
      const accountId = await ctx.db.insert("accounts", { clerkId: "syllabus-authority", email: "syllabus@example.test", emailVerified: true, name: "Reader", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
      const workspaceId = await ctx.db.insert("spectraWorkspaces", { ownerAccountId: accountId, schoolId, title: "Physics SL", starterKey: "managebac-class", status: "active", defaultView: "cards", createdAt: now, updatedAt: now, lastActivityAt: now });
      return { accountId, workspaceId };
    });
    await t.mutation(internal.workspaceSyllabus.ensure, { workspaceId, className: "Physics SL" });
    await t.run(async (ctx) => {
      const workspace = (await ctx.db.get(workspaceId))!;
      const artifact = (await ctx.db.get(workspace.syllabus!.artifactId!))!;
      const actor = (await getActorForAccountId(ctx, accountId))!;
      const workspaceAccess = await evaluateAccessForActor(ctx, actor, "workspace", workspaceId);
      expect(workspaceAccess.capabilities).toContain("modify");
      const decisions = await Promise.all([
        evaluateAccessForActor(ctx, actor, "artifact", artifact._id),
        evaluateAccessForActorWithLoadedResource(ctx, actor, "artifact", artifact._id, { resource: artifact, ownerAccountId: accountId, schoolId: artifact.schoolId, lifecycle: artifact.status }),
        evaluateArtifactAccessForActor(ctx, actor, artifact._id),
      ]);
      for (const [index, decision] of decisions.entries()) {
        expect(decision.allowed).toBe(true);
        expect(decision.level, `authority path ${index}: ${JSON.stringify(decision)}`).toBe("read");
        expect(decision.capabilities).toContain("read");
        expect(decision.capabilities).not.toContain("modify");
      }
      await expect(requireActorArtifactCapability(ctx, actor, artifact._id, "modify")).rejects.toThrow("WORK_NOT_FOUND");
      const reads: string[] = [];
      const boundedCtx = { ...ctx, db: { ...ctx.db, get: async (...args: Parameters<typeof ctx.db.get>) => {
        reads.push(String(args[0]));
        return ctx.db.get(...args);
      } } } as typeof ctx;
      expect(await ensureWorkspaceSyllabus(boundedCtx, workspaceId, { className: "Physics SL" })).toEqual({ changed: false });
      expect(reads).toEqual([workspaceId]);
    });
  });
});
