/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const owner = { subject: "checkpoint-owner", email: "checkpoint-owner@example.test", emailVerified: true };

it("keeps one checkpoint when the same one is made again with nothing changed (a retried publish)", async () => {
  const t = convexTest(schema, modules);
  const artifactId = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Checkpoints", slug: `checkpoints-${crypto.randomUUID()}`, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: owner.subject, email: owner.email, emailVerified: true, name: "Owner", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    return ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "code", title: "Game", content: { files: [] }, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
  });
  const user = t.withIdentity(owner);
  const checkpoint = (name: string) => user.mutation(api.changeGroups.createNamedCheckpoint, { artifactId, name });
  const history = () => t.run((ctx) => ctx.db.query("spectraArtifactVersions").withIndex("by_artifact_created", (q) => q.eq("artifactId", artifactId)).collect());

  const first = await checkpoint("Published Game");
  expect(await checkpoint("Published Game")).toEqual(first);
  expect(await history()).toHaveLength(1);

  // A different name, or a change since, is a checkpoint of its own.
  const named = await checkpoint("Before the boss level");
  expect(named.versionId).not.toBe(first.versionId);
  await t.run((ctx) => ctx.db.patch(artifactId, { content: { files: [{ id: "main", text: "play()" }] } }));
  const changed = await checkpoint("Before the boss level");
  expect(changed.versionId).not.toBe(named.versionId);
  expect(await history()).toHaveLength(3);
});
