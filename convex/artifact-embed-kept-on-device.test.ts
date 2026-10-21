import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_embed_kept_on_device",
  email: "embed-kept-on-device@example.test",
  emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

/** A page embedding two works: one kept only on a computer, one held by Spectra. */
async function seed(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Kept on device school",
      slug: `kept-on-device-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Kept on device owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "school_admin",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const work = (title: string) =>
      ctx.db.insert("spectraArtifacts", {
        ownerAccountId: accountId,
        schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title,
        content: { blocks: [] },
        textIndex: title.toLowerCase(),
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    const page = await work("Page");
    const kept = await work("Lab notes.docx");
    const shared = await work("Essay");
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId,
      name: "Study laptop",
      platform: "windows",
      credentialHash: "hash",
      protocolVersion: "1",
      appVersion: "0.1.0",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    const replica = { accountId, nativeFormat: "docx", revision: "r1", updatedAt: now };
    await ctx.db.insert("workReplicas", {
      ...replica,
      workId: kept,
      kind: "cloud",
      state: "unavailable",
      unavailableReason: "metadata-only",
    });
    await ctx.db.insert("workReplicas", { ...replica, workId: kept, kind: "local", deviceId, state: "current" });
    for (const [index, sourceArtifactId] of [kept, shared].entries())
      await ctx.db.insert("artifactEmbeds", {
        containerType: "artifact",
        containerId: String(page),
        containerRegionId: `document:reference:${index}`,
        sourceArtifactId,
        schoolId,
        mode: "compact",
        interaction: "read",
        versionPolicy: "live",
        contextPolicy: "summary",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });
    return { page, kept, shared };
  });
}

describe("an embed of a work kept on one computer", () => {
  it("names the computer instead of showing contents Spectra does not hold", async () => {
    const t = setupTest();
    const { page, kept, shared } = await seed(t);
    const { embeds } = await t
      .withIdentity(identity)
      .query(api.artifactEmbeds.listForContainer, { containerType: "artifact", containerId: String(page) });
    const bySource = new Map(embeds.map((embed) => [embed.sourceArtifactId, embed]));
    expect(bySource.get(kept)).toMatchObject({ state: "ready", keptOn: { deviceName: "Study laptop" } });
    expect(bySource.get(shared)).toMatchObject({ state: "ready" });
    expect((bySource.get(shared) as { keptOn?: unknown }).keptOn).toBeUndefined();
  });
});
