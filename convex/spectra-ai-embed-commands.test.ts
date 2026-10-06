/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const identity = { subject: "ai-embed-owner", email: "ai-embed@example.test", emailVerified: true };
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Embeds", slug: `ai-embeds-${crypto.randomUUID()}`, verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: identity.subject, email: identity.email, emailVerified: true, name: "Embed Owner", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const sourceId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Lab data", content: { blocks: [] }, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const hostId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Report", content: { blocks: [] }, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    const versionId = await ctx.db.insert("spectraArtifactVersions", { artifactId: sourceId, ownerAccountId: accountId, schoolId, source: "manual", after: { content: { blocks: [] } }, createdAt: now });
    const embedId = await ctx.db.insert("artifactEmbeds", { containerType: "artifact", containerId: hostId, containerRegionId: "reference:one", sourceArtifactId: sourceId, schoolId, mode: "compact", interaction: "read", versionPolicy: "live", contextPolicy: "summary", createdByAccountId: accountId, createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, sourceSurface: "artifact", artifactId: hostId, status: "running", userPrompt: "Tidy the embeds.", executionId: "exec-embed-1", createdAt: now, updatedAt: now });
    return { hostId, versionId, embedId, runId };
  });
  const user = t.withIdentity(identity);
  const run = async (args: Record<string, unknown>) => {
    const input = { artifactId: ids.hostId, embedId: ids.embedId, ...args };
    const operationId = await t.run((ctx) =>
      ctx.db.insert("spectraOperations", {
        runId: ids.runId, executionId: "exec-embed-1", actorType: "ai", type: "app.command", status: "executing",
        requiresConfirmation: false, input: { command: "manage_embed", args: input }, affected: [], createdAt: Date.now(),
      }),
    );
    return user.mutation(execute, { runId: ids.runId, executionId: "exec-embed-1", operationId, expectedCommand: "manage_embed", expectedArgs: input });
  };
  const embed = () => t.run((ctx) => ctx.db.get(ids.embedId));
  return { t, ids, run, embed };
}

describe("Spectra AI embed commands", () => {
  it("resizes, pins, follows the live work and removes through the embeds panel's mutations", async () => {
    const { ids, run, embed } = await seed();
    await run({ action: "resize", mode: "expanded" });
    expect((await embed())?.mode).toBe("expanded");
    await run({ action: "pin", versionId: ids.versionId });
    expect(await embed()).toMatchObject({ versionPolicy: "pinned", pinnedVersionId: ids.versionId });
    await run({ action: "follow_live" });
    const live = await embed();
    expect(live?.versionPolicy).toBe("live");
    expect(live?.pinnedVersionId).toBeUndefined();
    await run({ action: "remove" });
    expect(await embed()).toMatchObject({ placementState: "removed" });
    expect((await embed())?.removedAt).toEqual(expect.any(Number));
  });

  it("refuses a pin to a version of some other work", async () => {
    const { ids, run, embed, t } = await seed();
    const hostVersion = await t.run(async (ctx) => {
      const host = (await ctx.db.get(ids.hostId))!;
      return ctx.db.insert("spectraArtifactVersions", { artifactId: ids.hostId, ownerAccountId: host.ownerAccountId, schoolId: host.schoolId, source: "manual", after: { content: { blocks: [] } }, createdAt: Date.now() });
    });
    await expect(run({ action: "pin", versionId: hostVersion })).rejects.toThrow("EMBED_PINNED_VERSION_INVALID");
    expect((await embed())?.versionPolicy).toBe("live");
  });
});
