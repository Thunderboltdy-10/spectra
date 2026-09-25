/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { createHash } from "node:crypto";
import schema from "./schema";
import { api } from "./_generated/api";
import { createVerifiedSource, createEvidenceSpan } from "../src/features/spectra/sources/records";
const modules = import.meta.glob("./**/*.ts");
const execute = makeFunctionReference<"mutation">("spectraApplicationWrites:execute");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "AI integration", slug: "ai-integration", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: "ai-integration", email: "integration@example.test", emailVerified: true, name: "Integration student", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const runId = await ctx.db.insert("spectraAiRuns", { ownerAccountId: accountId, schoolId, sourceSurface: "chat", userPrompt: "Prepare study materials", status: "running", phase: "applying", executionId: "attempt", createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", title: "Integration guide", content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    return { schoolId, accountId, runId, artifactId };
  });
  const actor = t.withIdentity({ subject: "ai-integration", email: "integration@example.test", emailVerified: true });
  const operation = async (command: string, args: Record<string, unknown>) => {
    const operationId = await t.run(ctx => ctx.db.insert("spectraOperations", { runId: ids.runId, executionId: "attempt", actorType: "ai", type: "app.command", status: "executing", requiresConfirmation: false, input: { command, args }, affected: [], createdAt: Date.now() }));
    return { runId: ids.runId, executionId: "attempt", operationId, expectedCommand: command, expectedArgs: args };
  };
  return { t, ids, actor, operation };
}

describe("AI application integration", () => {
  it("accepts the worker heartbeat payload used by the runtime", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, { workerId: "runtime-worker" }));
    const result = await f.actor.mutation(api.spectraRuns.heartbeat, {
      runId: f.ids.runId,
      executionId: "attempt",
      workerId: "runtime-worker",
    });
    expect(result).toEqual({ alive: true });
  });

  it("keeps healthy run leases read-only while artifact progress reads run ownership", async () => {
    const f = await fixture();
    const heartbeatAt = 123;
    const leaseExpiresAt = Date.now() + 120_000;
    await f.t.run(ctx => ctx.db.patch(f.ids.runId, {
      workerId: "runtime-worker",
      heartbeatAt,
      leaseExpiresAt,
    }));

    const [heartbeat] = await Promise.all([
      f.actor.mutation(api.spectraRuns.heartbeat, {
        runId: f.ids.runId,
        executionId: "attempt",
        workerId: "runtime-worker",
      }),
      f.actor.mutation(api.spectraArtifacts.updateAiEffect, {
        artifactId: f.ids.artifactId,
        runId: f.ids.runId,
        executionId: "attempt",
        title: "Updating integration guide",
        activity: "edit",
        operationIndex: 0,
      }),
    ]);

    expect(heartbeat).toEqual({ alive: true });
    const afterProgress = await f.t.run(async ctx => ({
      run: await ctx.db.get(f.ids.runId),
      artifact: await ctx.db.get(f.ids.artifactId),
    }));
    expect(afterProgress.run).toMatchObject({ heartbeatAt, leaseExpiresAt });
    expect(afterProgress.artifact).toMatchObject({
      aiState: "updating",
      aiRunId: f.ids.runId,
      aiExecutionId: "attempt",
    });

    await f.t.run(ctx => ctx.db.patch(f.ids.runId, {
      leaseExpiresAt: Date.now() + 30_000,
    }));
    expect(await f.actor.mutation(api.spectraRuns.heartbeat, {
      runId: f.ids.runId,
      executionId: "attempt",
      workerId: "runtime-worker",
    })).toEqual({ alive: true });
    const renewedRun = await f.t.run(ctx => ctx.db.get(f.ids.runId));
    expect(renewedRun?.heartbeatAt).toBeGreaterThan(heartbeatAt);
    expect(renewedRun?.leaseExpiresAt).toBeGreaterThan(leaseExpiresAt);
  });

  it("executes all four journaled Calendar writes with exact wall times and receipt replay", async () => {
    const f = await fixture();
    const event = await f.operation("create_calendar_personal_event", { title: "Study group", startLocal: "2026-09-25T16:00", endLocal: "2026-09-25T17:00", timezone: "Europe/Madrid", linkedArtifactIds: [f.ids.artifactId] });
    const created = await f.actor.mutation(execute, event);
    expect(created).toMatchObject({ startAt: Date.parse("2026-09-25T14:00:00Z"), endAt: Date.parse("2026-09-25T15:00:00Z") });
    expect(await f.actor.mutation(execute, event)).toEqual(created);
    const taskItemId = await f.t.run(ctx => ctx.db.insert("calendarItems", { ownerAccountId: f.ids.accountId, schoolId: f.ids.schoolId, kind: "task", title: "Revise", allDay: false, timezone: "Europe/Madrid", timePrecision: "unknown", status: "active", sourceLocked: false, linkedArtifactIds: [], revision: 1, createdBy: "human", createdAt: Date.now(), updatedAt: Date.now() }));
    const schedule = await f.operation("schedule_calendar_task", { taskItemId, startAt: Date.parse("2026-09-25T15:00:00Z"), endAt: Date.parse("2026-09-25T16:00:00Z"), timezone: "Europe/Madrid" });
    const block = await f.actor.mutation(execute, schedule) as { id: string; revision: number };
    expect(await f.actor.mutation(execute, schedule)).toEqual(block);
    const move = await f.operation("move_calendar_block", { itemId: block.id, startAt: Date.parse("2026-09-25T16:00:00Z"), endAt: Date.parse("2026-09-25T17:00:00Z"), expectedRevision: block.revision });
    const moved = await f.actor.mutation(execute, move) as { revision: number };
    expect(await f.actor.mutation(execute, move)).toEqual(moved);
    const resize = await f.operation("resize_calendar_block", { itemId: block.id, endAt: Date.parse("2026-09-25T17:30:00Z"), expectedRevision: moved.revision });
    const resized = await f.actor.mutation(execute, resize);
    expect(await f.actor.mutation(execute, resize)).toEqual(resized);
    const items = await f.t.run(ctx => ctx.db.query("calendarItems").collect());
    expect(items.filter(item => item.kind === "personal_event")).toMatchObject([{ linkedArtifactIds: [f.ids.artifactId] }]);
    expect(items.filter(item => item.kind === "scheduled_work_block")).toMatchObject([{ startAt: Date.parse("2026-09-25T16:00:00Z"), endAt: Date.parse("2026-09-25T17:30:00Z") }]);
    expect(items.find(item => item._id === taskItemId)?.revision).toBe(1);
  });

  it("does not leave a receipt after the real nested Calendar mutation rejects", async () => {
    const f = await fixture();
    const args = await f.operation("create_calendar_personal_event", { title: "Invalid interval", startAt: 100, endAt: 50, timezone: "Europe/Madrid" });
    await expect(f.actor.mutation(execute, args)).rejects.toThrow("CALENDAR_TIME_INVALID");
    expect(await f.t.run(ctx => ctx.db.query("calendarItems").collect())).toEqual([]);
    expect((await f.t.run(ctx => ctx.db.get(args.operationId)))?.output).toBeUndefined();
  });
});

describe("AI persisted source evidence", () => {
  it.each([false, true])("merges older evidence and exact native citation refs (offloaded=%s)", async offloaded => {
    const f = await fixture();
    const source = createVerifiedSource({ title: "Cooling reference", url: "https://example.test/cooling", content: "Insulation slows cooling. Evaporation transfers energy.", accessedAt: new Date(0).toISOString(), sourceType: "web", authority: "primary", provider: "fixture" });
    const first = createEvidenceSpan(source, "Insulation slows cooling.");
    const second = createEvidenceSpan(source, "Evaporation transfers energy.");
    const content = { blocks: [{ id: "p", type: "paragraph", text: "Evaporation transfers energy.", inlineContent: [{ kind: "citation", sourceRef: { sourceId: source.id, evidenceIds: [second.id] } }] }] };
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.runId, { contextSnapshot: { researchEvidence: { sources: [source], evidence: [second], citations: [], partial: false } } });
      let stored: unknown = content;
      if (offloaded) {
        const bytes = JSON.stringify(content);
        const storageId = await ctx.storage.store(new Blob([bytes], { type: "application/json" }));
        const digest = createHash("sha256").update(bytes).digest("hex");
        const byteLength = new TextEncoder().encode(bytes).byteLength;
        const payloadRef = await ctx.db.insert("collaborationDurablePayloads", { artifactId: f.ids.artifactId, accountId: f.ids.accountId, kind: "projection", digest, byteLength, storageId, mediaType: "application/json", manifestVersion: 1, policyVersion: 0, status: "active", createdAt: Date.now() });
        stored = { spectraContentRef: { version: 1, artifactId: f.ids.artifactId, payloadRef, digest, byteLength, path: "value" } };
      }
      await ctx.db.patch(f.ids.artifactId, { content: stored, createdFrom: { source: "ai", sourceBundle: { sources: [source], evidence: [first], citations: [{ sourceId: source.id, evidenceIds: [first.id] }], partial: false } } });
    });
    await f.actor.action(api.spectraArtifacts.attachResearchEvidence, { artifactId: f.ids.artifactId, runId: f.ids.runId, executionId: "attempt" });
    const saved = await f.t.run(ctx => ctx.db.get(f.ids.artifactId));
    expect(saved?.createdFrom?.sourceBundle).toMatchObject({ sources: [source], evidence: [first, second], citations: [{ sourceId: source.id, evidenceIds: [second.id] }] });
    if (offloaded) {
      await f.t.run(ctx => ctx.db.patch(f.ids.artifactId, { content: { blocks: [] } }));
      await expect(f.actor.mutation(makeFunctionReference<"mutation">("spectraArtifacts:attachResearchEvidenceForContent"), {
        artifactId: f.ids.artifactId, runId: f.ids.runId, executionId: "attempt", resolved: { contentRef: saved!.content, refs: [second.id] },
      })).rejects.toThrow("RESEARCH_CONTENT_CHANGED");
    }
  });

  it("keeps attachment evidence when target resolution adds a later context snapshot", async () => {
    const f = await fixture();
    const source = createVerifiedSource({ title: "Cooling reference", url: "https://example.test/cooling", content: "Tree shade lowers surface heating.", accessedAt: new Date(0).toISOString(), sourceType: "web", authority: "primary", provider: "fixture" });
    const evidence = createEvidenceSpan(source, "Tree shade lowers surface heating.");
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.runId, { contextSnapshot: { researchEvidence: { sources: [source], evidence: [evidence], citations: [], partial: false }, qualityRequirements: { numericSourceRequired: true } } });
      await ctx.db.patch(f.ids.artifactId, { content: { blocks: [{ sourceRefs: [evidence.id] }] } });
    });
    await f.actor.mutation(makeFunctionReference<"mutation">("spectraRuns:setContextSnapshot"), {
      runId: f.ids.runId,
      executionId: "attempt",
      contextSnapshot: { targetResolutions: [{ role: "primary", status: "resolved" }] },
    });
    await f.actor.action(api.spectraArtifacts.attachResearchEvidence, { artifactId: f.ids.artifactId, runId: f.ids.runId, executionId: "attempt" });
    const [run, artifact] = await f.t.run(async ctx => [
      await ctx.db.get(f.ids.runId),
      await ctx.db.get(f.ids.artifactId),
    ] as const);
    expect(run?.contextSnapshot).toMatchObject({
      qualityRequirements: { numericSourceRequired: true },
      researchEvidence: { sources: [source], evidence: [evidence] },
      targetResolutions: [{ role: "primary", status: "resolved" }],
    });
    expect(artifact?.createdFrom?.sourceBundle).toMatchObject({
      sources: [source],
      evidence: [evidence],
      citations: [{ sourceId: source.id, evidenceIds: [evidence.id] }],
    });
  });

  it("never turns a bare source ref into the first evidence passage", async () => {
    const f = await fixture();
    const source = createVerifiedSource({ title: "Cooling", url: "https://example.test/cooling", content: "Unrelated passage.", accessedAt: new Date(0).toISOString(), sourceType: "web", authority: "primary", provider: "fixture" });
    const evidence = createEvidenceSpan(source, "Unrelated passage.");
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.runId, { contextSnapshot: { researchEvidence: { sources: [source], evidence: [evidence], citations: [], partial: false } } });
      await ctx.db.patch(f.ids.artifactId, { content: { blocks: [{ sourceRefs: [source.id] }] } });
    });
    await f.actor.action(api.spectraArtifacts.attachResearchEvidence, { artifactId: f.ids.artifactId, runId: f.ids.runId, executionId: "attempt" });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.artifactId)))?.createdFrom?.sourceBundle).toMatchObject({ citations: [] });
  });
});
