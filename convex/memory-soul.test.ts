/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { SOUL_TOKEN_CAP } from "./memory";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_memory_soul",
  email: "memory-soul@example.test",
  emailVerified: true,
};

async function seedActor(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Memory Soul School",
      slug: `memory-soul-${crypto.randomUUID()}`,
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
      name: "Memory Soul",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId };
  });
}

async function queueCapsuleRebuild(
  t: ReturnType<typeof convexTest>,
  actor: Awaited<ReturnType<typeof seedActor>>,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("memoryJobs", {
      accountId: actor.accountId,
      schoolId: actor.schoolId,
      kind: "regenerate_capsule",
      idempotencyKey: `soul-test-rebuild:${crypto.randomUUID()}`,
      payload: {},
      status: "queued",
      attemptCount: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("memory soul", () => {
  it("enforces the write cap, keeps one row, and journals user revisions", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const authenticated = t.withIdentity(identity);
    const atCap = "a".repeat(SOUL_TOKEN_CAP * 4);

    const first = await authenticated.mutation(api.memory.updateSoul, {
      text: atCap,
    });
    expect(first).toMatchObject({
      text: atCap,
      tokenCount: SOUL_TOKEN_CAP,
      maxTokens: SOUL_TOKEN_CAP,
      userEdited: true,
    });
    await expect(
      authenticated.mutation(api.memory.updateSoul, {
        text: `${atCap}a`,
      }),
    ).rejects.toThrow("SOUL_TOO_LONG");
    await expect(
      authenticated.mutation(api.memory.updateSoul, {
        text: "My API key is should-not-be-stored",
      }),
    ).rejects.toThrow("MEMORY_CAPTURE_REJECTED");

    const secondText = "My name is Pablo. I prefer concise explanations.";
    await authenticated.mutation(api.memory.updateSoul, { text: secondText });
    expect(await authenticated.query(api.memory.soul, {})).toMatchObject({
      text: secondText,
      userEdited: true,
    });

    const audit = await t.run(async (ctx) => {
      const capsules = await ctx.db
        .query("memoryCapsules")
        .withIndex("by_account_kind", (q) =>
          q.eq("accountId", actor.accountId).eq("kind", "soul"),
        )
        .collect();
      const active = await ctx.db
        .query("memoryClaims")
        .withIndex("by_account_status_updated", (q) =>
          q.eq("accountId", actor.accountId).eq("status", "active"),
        )
        .collect();
      const superseded = await ctx.db
        .query("memoryClaims")
        .withIndex("by_account_status_updated", (q) =>
          q.eq("accountId", actor.accountId).eq("status", "superseded"),
        )
        .collect();
      const current = active.find((claim) =>
        claim.subjectId?.startsWith("soul:"),
      );
      const evidence = current
        ? await ctx.db
            .query("memoryEvidence")
            .withIndex("by_claim_created", (q) =>
              q.eq("claimId", current._id),
            )
            .collect()
        : [];
      return { capsules, current, evidence, superseded };
    });
    expect(audit.capsules).toHaveLength(1);
    expect(audit.current).toMatchObject({
      proposition: secondText,
      createdBy: "user",
      status: "active",
    });
    expect(audit.superseded).toHaveLength(1);
    expect(audit.evidence[0]).toMatchObject({
      sourceId: "settings:soul",
      sourceType: "user_statement",
    });
  });

  it("bounds legacy rows again at injection", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("memoryCapsules", {
        accountId: actor.accountId,
        schoolId: actor.schoolId,
        kind: "soul",
        scope: "private_global",
        text: "z".repeat(2_000),
        generatedText: "z".repeat(2_000),
        claimIds: [],
        tokenCount: 500,
        generationVersion: 1,
        contentHash: "legacy-oversize",
        stale: false,
        createdAt: now,
        updatedAt: now,
      });
    });
    const injected = await t.withIdentity(identity).query(api.memory.soul, {});
    expect(injected.text).toHaveLength(SOUL_TOKEN_CAP * 4);
    expect(injected.tokenCount).toBe(SOUL_TOKEN_CAP);
  });

  it("rebuilds from strong claims while preserving a user edit", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const authenticated = t.withIdentity(identity);
    await authenticated.mutation(api.memory.remember, {
      proposition: "I prefer worked examples before practice questions.",
      scope: "private_global",
      claimType: "inferred_preference",
    });
    await queueCapsuleRebuild(t, actor);
    await authenticated.mutation(internal.memory.maintain, {});
    const generated = await authenticated.query(api.memory.soul, {});
    expect(generated.text).toContain("worked examples");
    expect(generated.userEdited).toBe(false);

    const userText = "My name is Pablo. Start with the conclusion.";
    await authenticated.mutation(api.memory.updateSoul, { text: userText });
    await authenticated.mutation(api.memory.remember, {
      proposition: "I prefer diagrams when a concept is spatial.",
      scope: "private_global",
      claimType: "inferred_preference",
    });
    await queueCapsuleRebuild(t, actor);
    await authenticated.mutation(internal.memory.maintain, {});
    expect(await authenticated.query(api.memory.soul, {})).toMatchObject({
      text: userText,
      userEdited: true,
    });
  });
});
