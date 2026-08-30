/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_memory_retrieval_tiers",
  email: "memory-retrieval-tiers@example.test",
  emailVerified: true,
};

async function seedActor(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Memory Retrieval School",
      slug: `memory-retrieval-${crypto.randomUUID()}`,
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
      name: "Memory Retrieval",
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

describe("memory retrieval tiers", () => {
  it("bounds focused and deep graph reach, excludes unrelated claims, and audits token spend", async () => {
    const t = convexTest(schema, modules);
    const actor = await seedActor(t);
    const authenticated = t.withIdentity(identity);
    const propositions = [
      "Volcano revision begins with the annotated diagram.",
      "Check crimson margin comments before altering the explanation.",
      "Preserve the teacher evidence labels in each paragraph.",
      "End by comparing every conclusion against the source table.",
      "French vocabulary drills use alternating audio prompts.",
    ];
    const claimIds: Id<"memoryClaims">[] = [];
    for (const proposition of propositions) {
      const result = await authenticated.mutation(api.memory.remember, {
        proposition,
        scope: "private_global",
        claimType: "declared_fact",
      });
      claimIds.push(result.claimId);
    }

    await t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("memoryRelations", {
          accountId: actor.accountId,
          schoolId: actor.schoolId,
          fromClaimId: claimIds[index],
          toClaimId: claimIds[index + 1],
          fromSubject: String(claimIds[index]),
          toSubject: String(claimIds[index + 1]),
          relationType: "related_to",
          confidence: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const focused = await authenticated.query(
      internal.memory.contextForRunBase,
      {
        queryText: "volcano",
        tier: "focused",
      },
    );
    expect(focused.targetTokens).toBe(1_500);
    expect(focused.actualTokens).toBeLessThanOrEqual(1_500);
    const focusedClaims = focused.claims ?? [];
    expect(focusedClaims.map((claim) => claim.claimId)).toEqual([
      claimIds[0],
      claimIds[1],
    ]);
    expect(focused.candidateClaimIds).toEqual([claimIds[0], claimIds[1]]);

    const deep = await authenticated.query(internal.memory.contextForRunBase, {
      queryText: "volcano",
      tier: "deep",
    });
    expect(deep.targetTokens).toBe(4_000);
    expect(deep.actualTokens).toBeLessThanOrEqual(4_000);
    const deepClaims = deep.claims ?? [];
    expect(new Set(deepClaims.map((claim) => claim.claimId))).toEqual(
      new Set(claimIds.slice(0, 4)),
    );
    expect(deepClaims.map((claim) => claim.claimId)).not.toContain(claimIds[4]);

    await authenticated.mutation(api.memory.recordRetrieval, {
      tier: "deep",
      purpose: "tool_deep_retrieval",
      queryHash: "volcano-query-hash",
      candidateClaimIds: deep.candidateClaimIds,
      selectedClaimIds: deep.selectedClaimIds,
      exclusionCounts: deep.exclusions,
      estimatedTokens: deep.estimatedTokens,
      actualTokens: deep.actualTokens,
    });
    const events = await t.run((ctx) =>
      ctx.db.query("memoryRetrievalEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      accountId: actor.accountId,
      tier: "deep",
      purpose: "tool_deep_retrieval",
      estimatedTokens: deep.estimatedTokens,
      actualTokens: deep.actualTokens,
      selectedClaimIds: deep.selectedClaimIds,
    });

    await expect(
      authenticated.mutation(api.memory.recordRetrieval, {
        tier: "deep",
        purpose: "over-budget-probe",
        queryHash: "over-budget",
        candidateClaimIds: [],
        selectedClaimIds: [],
        exclusionCounts: {
          scope: 0,
          permission: 0,
          stale: 0,
          disputed: 0,
          budget: 0,
        },
        estimatedTokens: 4_001,
        actualTokens: 4_001,
      }),
    ).rejects.toThrow("MEMORY_RETRIEVAL_OVER_BUDGET");
  });
});
