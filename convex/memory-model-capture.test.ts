/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_memory_model_capture",
  email: "memory-model-capture@example.test",
  emailVerified: true,
};

async function seedFixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Memory Model Capture School",
      slug: `memory-model-capture-${crypto.randomUUID()}`,
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
      name: "Memory Model Capture",
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
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accountId,
      schoolId,
      sourceSurface: "workspace",
      status: "completed",
      phase: "completed",
      userPrompt: "Use the corrected lab workflow next time.",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId, runId };
  });
}

const proposals = [
  {
    claimType: "correction" as const,
    proposition:
      "Use the corrected uncertainty values in future lab summaries.",
    reason: "The user corrected the uncertainty values during this run.",
  },
  {
    claimType: "recurring_workflow" as const,
    proposition: "Start each lab review by checking the raw measurement table.",
    reason: "The same review order was requested again.",
  },
  {
    claimType: "mistake_avoidance" as const,
    proposition:
      "Do not round intermediate physics calculations before the final result.",
    reason: "Early rounding caused an error that the user corrected.",
  },
  {
    claimType: "correction" as const,
    proposition:
      "Use seconds rather than milliseconds in the final period table.",
    reason: "The user corrected the unit.",
  },
];

describe("model-initiated memory capture", () => {
  it("queues at most three idempotent proposals through maintenance and makes them individually forgettable", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    const authenticated = t.withIdentity(identity);

    const first = await authenticated.mutation(
      api.memory.captureModelProposals,
      {
        runId: fixture.runId,
        prompt: "Use the corrected lab workflow next time.",
        proposals,
      },
    );
    expect(first).toMatchObject({ queued: 3, refused: 1 });
    expect(first.outcomes[3]).toMatchObject({
      queued: false,
      reason: "proposal_limit",
    });

    const duplicate = await authenticated.mutation(
      api.memory.captureModelProposals,
      {
        runId: fixture.runId,
        prompt: "Use the corrected lab workflow next time.",
        proposals,
      },
    );
    expect(duplicate).toMatchObject({ queued: 3, refused: 1 });
    expect(
      duplicate.outcomes
        .slice(0, 3)
        .every((item) => "duplicate" in item && item.duplicate),
    ).toBe(true);

    const beforeMaintenance = await t.run(async (ctx) => ({
      jobs: await ctx.db.query("memoryJobs").collect(),
      claims: await ctx.db.query("memoryClaims").collect(),
    }));
    expect(beforeMaintenance.jobs).toHaveLength(3);
    expect(beforeMaintenance.claims).toHaveLength(0);

    await authenticated.mutation(internal.memory.maintain, {});
    await authenticated.mutation(api.memory.remember, {
      proposition: "The user keeps this separate personal context item.",
      scope: "private_global",
      claimType: "declared_fact",
    });
    const listed = await authenticated.query(api.memory.listMine, {
      status: "active",
      createdBy: "model",
    });
    expect(listed.claims).toHaveLength(3);
    expect(listed.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposition: proposals[0].proposition,
          assertion: "inferred",
          createdBy: "model",
          status: "active",
        }),
      ]),
    );

    const audit = await t.run(async (ctx) => {
      const claims = (
        await ctx.db
          .query("memoryClaims")
          .withIndex("by_account_status_updated", (q) =>
            q.eq("accountId", fixture.accountId).eq("status", "active"),
          )
          .collect()
      ).filter((claim) => claim.createdBy === "model");
      const evidence = await Promise.all(
        claims.map((claim) =>
          ctx.db
            .query("memoryEvidence")
            .withIndex("by_claim_created", (q) => q.eq("claimId", claim._id))
            .unique(),
        ),
      );
      return { claims, evidence };
    });
    expect(audit.claims.every((claim) => claim.createdBy === "model")).toBe(
      true,
    );
    expect(audit.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "product_event",
          sourceId: fixture.runId,
          excerptPreview: proposals[0].proposition,
        }),
      ]),
    );

    const forgottenId = listed.claims[0]._id;
    await authenticated.mutation(api.memory.forget, {
      claimId: forgottenId,
    });
    const afterForget = await authenticated.query(api.memory.listMine, {
      status: "active",
    });
    expect(afterForget.claims.map((claim) => claim._id)).not.toContain(
      forgottenId,
    );
    expect(await t.run((ctx) => ctx.db.get(forgottenId))).toMatchObject({
      status: "deleted",
      proposition: "[forgotten]",
    });
  });

  it("refuses paused, disabled, category-blocked, oversize, and protected proposals", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    const authenticated = t.withIdentity(identity);
    const capture = (candidate: (typeof proposals)[number]) =>
      authenticated.mutation(api.memory.captureModelProposals, {
        runId: fixture.runId,
        prompt: "The user supplied direct evidence.",
        proposals: [candidate],
      });

    await authenticated.mutation(api.memory.updatePreferences, {
      capturePaused: true,
    });
    expect(await capture(proposals[0])).toMatchObject({
      queued: 0,
      outcomes: [expect.objectContaining({ reason: "paused" })],
    });

    await authenticated.mutation(api.memory.updatePreferences, {
      enabled: false,
    });
    expect(await capture(proposals[0])).toMatchObject({
      queued: 0,
      outcomes: [expect.objectContaining({ reason: "disabled" })],
    });

    const enabled = await authenticated.mutation(api.memory.updatePreferences, {
      enabled: true,
      capturePaused: false,
    });
    await authenticated.mutation(api.memory.updatePreferences, {
      categoryControls: { ...enabled.categoryControls, workflows: false },
    });
    expect(await capture(proposals[1])).toMatchObject({
      queued: 0,
      outcomes: [expect.objectContaining({ reason: "category_disabled" })],
    });

    await authenticated.mutation(api.memory.updatePreferences, {
      categoryControls: { ...enabled.categoryControls, workflows: true },
    });
    expect(
      await capture({
        ...proposals[0],
        proposition: `Keep this correction ${"x".repeat(600)}`,
      }),
    ).toMatchObject({
      queued: 0,
      outcomes: [expect.objectContaining({ reason: "too_long" })],
    });
    expect(
      await capture({
        ...proposals[0],
        proposition: "The user's API key is should-not-be-stored.",
      }),
    ).toMatchObject({
      queued: 0,
      outcomes: [expect.objectContaining({ reason: "sensitive_or_secret" })],
    });
    expect(
      await capture({
        ...proposals[0],
        reason: "The user's password is should-not-be-stored.",
      }),
    ).toMatchObject({
      queued: 0,
      outcomes: [expect.objectContaining({ reason: "sensitive_or_secret" })],
    });
    expect(await capture({ ...proposals[0], reason: "   " })).toMatchObject({
      queued: 0,
      outcomes: [expect.objectContaining({ reason: "reason_required" })],
    });

    expect(await t.run((ctx) => ctx.db.query("memoryJobs").collect())).toEqual(
      [],
    );

    const tamperedJobId = await t.run((ctx) => {
      const now = Date.now();
      return ctx.db.insert("memoryJobs", {
        accountId: fixture.accountId,
        schoolId: fixture.schoolId,
        kind: "capture",
        idempotencyKey: `tampered-model-capture:${crypto.randomUUID()}`,
        payload: {
          proposition: proposals[0].proposition,
          claimType: proposals[0].claimType,
          scope: "private_global",
          sourceType: "product_event",
          sourceId: fixture.runId,
          excerpt: "The user's password is should-not-be-stored.",
          reason: "The user's password is should-not-be-stored.",
          createdBy: "model",
        },
        status: "queued",
        attemptCount: 0,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
    await authenticated.mutation(internal.memory.maintain, {});
    const persistenceRecheck = await t.run(async (ctx) => ({
      job: await ctx.db.get(tamperedJobId),
      claims: await ctx.db.query("memoryClaims").collect(),
    }));
    expect(persistenceRecheck.job).toMatchObject({
      status: "queued",
      attemptCount: 1,
      error: "Model-authored memory candidate failed capture rails.",
    });
    expect(persistenceRecheck.claims).toEqual([]);
  });
});
