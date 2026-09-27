/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { RestoredClarification } from "../src/app/api/spectra/run/loop/contract";

const modules = import.meta.glob("./**/*.ts");
// Typed references keep the generated API untouched until coordinated codegen.
type Attempt = { runId: Id<"spectraAiRuns">; executionId: string };
type Disposition = "accepted" | "needs_revalidation" | "withdrawn";
const park = makeFunctionReference<"mutation", Attempt & {
  candidates: Array<{ operation: unknown; disposition: Disposition; carried?: boolean }>;
}>("spectraRunContinuations:park");
const restore = makeFunctionReference<"query", Attempt, RestoredClarification | null>("spectraRunContinuations:restore");
const owner = { subject: "clarify-owner", email: "clarify-owner@example.test", emailVerified: true };
const other = { subject: "clarify-other", email: "clarify-other@example.test", emailVerified: true };
const body = (text: string) => ({ blocks: [{ id: "body", type: "paragraph", text }] });
const ORIGINAL = "Retitle my evidence note and create a revision plan from it, then tell me what changed.";

async function fixture() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Clarification continuity", slug: `clarify-${crypto.randomUUID()}`, verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accounts: Id<"accounts">[] = [];
    for (const identity of [owner, other]) {
      const accountId = await ctx.db.insert("accounts", {
        clerkId: identity.subject, email: identity.email, emailVerified: true, name: identity.subject,
        status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
      });
      accounts.push(accountId);
    }
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accounts[0]!, schoolId, blueprintKey: "document", title: "Evidence note",
      content: body("Check the primary evidence."), textIndex: "Check the primary evidence.", tags: [],
      status: "active", contentHash: "hash-1", createdAt: now, updatedAt: now,
    });
    const threadId = await ctx.db.insert("spectraThreads", {
      ownerAccountId: accounts[0]!, schoolId, title: "Clarification", origin: "chat", status: "active",
      messageCount: 1, createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accounts[0]!, schoolId, sourceSurface: "chat", status: "running", phase: "planning",
      userPrompt: ORIGINAL, threadId, executionId: "attempt-1", attemptCount: 1, createdAt: now, updatedAt: now,
    });
    return { schoolId, artifactId, threadId, runId, otherAccountId: accounts[1]! };
  });
  const actor = t.withIdentity(owner);
  const retitle = { type: "artifact.update", input: { artifactId: String(ids.artifactId), title: "Primary evidence" } };
  const plan = { type: "artifact.create", input: { blueprintKey: "document", title: "Revision plan", content: body("Plan") } };
  const ask = (runId: Id<"spectraAiRuns">, question: string) =>
    t.run((ctx) => ctx.db.patch(runId, { status: "awaiting_resolution", outcome: "awaiting_input", finalSummary: question }));
  const answer = async (userPrompt: string) => {
    const created = await actor.mutation(api.spectraRuns.beginRun, {
      sourceSurface: "chat", userPrompt, submissionKey: crypto.randomUUID(), threadId: ids.threadId,
    });
    const run = await t.run((ctx) => ctx.db.get(created.runId as Id<"spectraAiRuns">));
    return { runId: created.runId as Id<"spectraAiRuns">, executionId: run!.executionId! };
  };
  const running = (runId: Id<"spectraAiRuns">) => t.run((ctx) => ctx.db.patch(runId, { status: "running" }));
  return { t, actor, ids, retitle, plan, ask, answer, running };
}

describe("clarification continuity", () => {
  it("resumes the original goal with its exact staged graph across two questions", async () => {
    const { t, actor, ids, retitle, plan, ask, answer, running } = await fixture();
    await actor.mutation(park, {
      runId: ids.runId, executionId: "attempt-1",
      candidates: [{ operation: retitle, disposition: "accepted" }, { operation: plan, disposition: "accepted" }],
    });
    await ask(ids.runId, "Should the plan cover one or two weeks?");
    const first = await answer("Two weeks.");
    const restored = await actor.query(restore, first);
    expect(restored).toEqual({
      originalRequest: ORIGINAL,
      clarificationResponses: ["Spectra asked: Should the plan cover one or two weeks?\nUser answered: Two weeks."],
      candidates: [{ operation: retitle, disposition: "accepted" }, { operation: plan, disposition: "accepted" }],
      candidatesOmitted: false,
    });
    // The answered run no longer owns the request.
    expect((await t.run((ctx) => ctx.db.get(ids.runId)))?.clarificationContinuation).toBeUndefined();

    await running(first.runId);
    await actor.mutation(park, {
      ...first,
      candidates: [
        { operation: retitle, disposition: "accepted", carried: true },
        { operation: plan, disposition: "withdrawn", carried: true },
      ],
    });
    await ask(first.runId, "Which title do you prefer?");
    const second = await answer("Keep 'Primary evidence'.");
    const resumed = await actor.query(restore, second);
    expect(resumed?.originalRequest).toBe(ORIGINAL);
    expect(resumed?.clarificationResponses).toHaveLength(2);
    expect(resumed?.clarificationResponses[1]).toContain("User answered: Keep 'Primary evidence'.");
    expect(resumed?.candidates.map(({ disposition }) => disposition)).toEqual(["accepted", "withdrawn"]);
  });

  it("never re-stamps a carried candidate as fresh after its source changed", async () => {
    const { t, actor, ids, retitle, ask, answer, running } = await fixture();
    await actor.mutation(park, {
      runId: ids.runId, executionId: "attempt-1", candidates: [{ operation: retitle, disposition: "accepted" }],
    });
    await ask(ids.runId, "Which week?");
    const first = await answer("This week.");
    await t.run((ctx) => ctx.db.patch(ids.artifactId, { contentHash: "hash-2", updatedAt: Date.now() + 1_000 }));
    expect((await actor.query(restore, first))?.candidates[0]?.disposition)
      .toBe("needs_revalidation");

    // A second question that carries the candidate unchanged keeps the old evidence.
    await running(first.runId);
    await actor.mutation(park, {
      ...first, candidates: [{ operation: retitle, disposition: "accepted", carried: true }],
    });
    await ask(first.runId, "Which day?");
    const second = await answer("Monday.");
    expect((await actor.query(restore, second))?.candidates[0]?.disposition)
      .toBe("needs_revalidation");

    // Only a fresh proposal, validated against the current source, is accepted again.
    await running(second.runId);
    await actor.mutation(park, {
      ...second, candidates: [{ operation: retitle, disposition: "accepted" }],
    });
    await ask(second.runId, "Anything else?");
    const third = await answer("No.");
    expect((await actor.query(restore, third))?.candidates[0]?.disposition)
      .toBe("accepted");
  });

  it("keeps an unreadable source unaccepted and a forged carry flag unaccepted", async () => {
    const { t, actor, ids, retitle, ask, answer } = await fixture();
    await t.run((ctx) => ctx.db.patch(ids.artifactId, { ownerAccountId: ids.otherAccountId }));
    await actor.mutation(park, {
      runId: ids.runId, executionId: "attempt-1",
      candidates: [{ operation: retitle, disposition: "accepted", carried: true }],
    });
    await ask(ids.runId, "Which note?");
    const first = await answer("The evidence note.");
    expect((await actor.query(restore, first))?.candidates[0]?.disposition)
      .toBe("needs_revalidation");
  });

  it("binds restoration to the owner and the exact current attempt", async () => {
    const { t, actor, ids, retitle, ask, answer } = await fixture();
    await actor.mutation(park, {
      runId: ids.runId, executionId: "attempt-1", candidates: [{ operation: retitle, disposition: "accepted" }],
    });
    await expect(t.withIdentity(other).mutation(park, {
      runId: ids.runId, executionId: "attempt-1", candidates: [],
    })).rejects.toThrow(/unavailable/);
    await ask(ids.runId, "Which week?");
    const first = await answer("This week.");
    await expect(t.withIdentity(other).query(restore, first)).rejects.toThrow(/unavailable/);
    await expect(actor.query(restore, { ...first, executionId: "stale-attempt" }))
      .rejects.toThrow(/unavailable/);
    await expect(actor.query(restore, { runId: ids.runId, executionId: "attempt-1" }))
      .rejects.toThrow(/unavailable/);
  });

  it("keeps the request but not oversized staged work", async () => {
    const { actor, ids, ask, answer } = await fixture();
    const large = Array.from({ length: 101 }, (_, index) => ({
      operation: { type: "artifact.create", input: { blueprintKey: "document", title: `Plan ${index}`, content: body("x") } },
      disposition: "accepted" as const,
    }));
    await actor.mutation(park, { runId: ids.runId, executionId: "attempt-1", candidates: large });
    await ask(ids.runId, "Which week?");
    const first = await answer("This week.");
    expect(await actor.query(restore, first)).toMatchObject({
      originalRequest: ORIGINAL, candidates: [], candidatesOmitted: true,
    });
  });

  it("rejects a staged graph with a dangling creation reference", async () => {
    const { actor, ids } = await fixture();
    await expect(actor.mutation(park, {
      runId: ids.runId, executionId: "attempt-1",
      candidates: [{ operation: { type: "artifact.update", input: { artifactId: "@created:3", title: "x" } }, disposition: "accepted" }],
    })).rejects.toThrow();
  });
});
