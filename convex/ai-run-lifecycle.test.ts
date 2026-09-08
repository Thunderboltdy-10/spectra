/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_ai_run_lifecycle",
  email: "ai-run-lifecycle@example.test",
  emailVerified: true,
};

async function seedActor(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "AI Run Lifecycle School",
      slug: `ai-run-lifecycle-${crypto.randomUUID()}`,
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
      name: "AI Run Lifecycle",
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

async function seedRun(
  t: ReturnType<typeof convexTest>,
  options: {
    status: "running" | "failed";
    recoveryState?: "partial" | "interrupted";
    retryable?: boolean;
    hasAttachments?: boolean;
  },
) {
  const actor = await seedActor(t);
  return t.run(async (ctx) => {
    const now = Date.now();
    const threadId = await ctx.db.insert("spectraThreads", {
      ownerAccountId: actor.accountId,
      schoolId: actor.schoolId,
      title: "Lifecycle fixture",
      origin: "chat",
      status: "active",
      messageCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: actor.accountId,
      schoolId: actor.schoolId,
      sourceSurface: "workspace",
      status: options.status,
      phase: options.status === "running" ? "applying" : "partial",
      userPrompt: "Create a useful document",
      threadId,
      executionId: "execution-1",
      recoveryState: options.recoveryState,
      retryable: options.retryable,
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    if (options.hasAttachments) {
      await ctx.db.insert("spectraMessages", {
        threadId,
        schoolId: actor.schoolId,
        role: "user",
        content: "Inspect the attached fixture.",
        runId,
        metadata: {
          attachments: [
            {
              name: "fixture.png",
              mimeType: "image/png",
              size: 128,
              handling: "image",
            },
          ],
        },
        createdAt: now,
      });
    }
    const cardId = await ctx.db.insert("spectraResultCards", {
      runId,
      surface: "workspace",
      status: options.status,
      variant: "status",
      title: options.status === "running" ? "Working" : "Paused",
      summary: "Lifecycle fixture",
      actions: [],
      createdAt: now,
      updatedAt: now,
    });
    return { ...actor, runId, cardId };
  });
}

describe("AI run create and recovery lifecycle", () => {
  it("finalizes a synchronized pending create after live staging marks it updating", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedRun(t, { status: "running" });
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: fixture.accountId,
        schoolId: fixture.schoolId,
        blueprintKey: "document",
        schemaVersion: 1,
        title: "Pendulum Method Guide",
        summary: "Spectra is building Pendulum Method Guide.",
        content: {
          blocks: [
            { id: "title", type: "heading", level: 1, text: "Pendulum Method Guide" },
            {
              id: "purpose",
              type: "paragraph",
              text: "Measure how pendulum length changes the period while keeping release angle and timing method constant.",
            },
          ],
          outline: [],
        },
        textIndex: "Pendulum Method Guide Purpose",
        tags: [],
        status: "active",
        aiState: "creating",
        aiRunId: fixture.runId,
        aiExecutionId: "execution-1",
        aiProgress: 0.8,
        createdFrom: { source: "ai", runId: fixture.runId },
        createdAt: now,
        updatedAt: now,
      });
      return { artifactId };
    });

    await t.withIdentity(identity).mutation(api.spectraArtifacts.markAiState, {
      artifactId: seeded.artifactId,
      runId: fixture.runId,
      executionId: "execution-1",
      state: "updating",
    });
    await t.run(async (ctx) => {
      const artifact = await ctx.db.get(seeded.artifactId);
      if (!artifact) throw new Error("fixture artifact missing");
      const versionId = await ctx.db.insert("spectraArtifactVersions", {
        artifactId: artifact._id,
        ownerAccountId: fixture.accountId,
        schoolId: fixture.schoolId,
        source: "ai",
        runId: fixture.runId,
        after: {
          title: artifact.title,
          summary: artifact.summary,
          content: artifact.content,
          tags: artifact.tags,
        },
        summary: "Spectra updated 1 region",
        createdAt: Date.now(),
      });
      await ctx.db.patch(artifact._id, {
        currentVersionId: versionId,
        liveStateVectorHash: "a".repeat(64),
      });
    });

    await expect(
      t.withIdentity(identity).mutation(api.spectraArtifacts.finalizePendingLive, {
        artifactId: seeded.artifactId,
        runId: fixture.runId,
        executionId: "execution-1",
        summary: "A structured pendulum method guide.",
      }),
    ).resolves.toMatchObject({ artifactId: seeded.artifactId });
    const artifact = await t.run((ctx) => ctx.db.get(seeded.artifactId));
    expect(artifact?.aiState).toBe("edited");
    expect(artifact?.aiRunId).toBeUndefined();
    expect(artifact?.aiExecutionId).toBeUndefined();
  });

  it("does not offer Retry when Stop catches an executing operation", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedRun(t, { status: "running" });
    await t.run(async (ctx) => {
      await ctx.db.insert("spectraOperations", {
        runId: fixture.runId,
        executionId: "execution-1",
        actorType: "ai",
        type: "artifact.create",
        status: "executing",
        input: {},
        affected: [],
        createdAt: Date.now(),
      });
    });

    await t.withIdentity(identity).mutation(api.spectraRuns.stopRun, {
      runId: fixture.runId,
      executionId: "execution-1",
    });
    const { run, card } = await t.run(async (ctx) => ({
      run: await ctx.db.get(fixture.runId),
      card: await ctx.db.get(fixture.cardId),
    }));
    expect(run).toMatchObject({
      recoveryState: "partial",
      retryable: false,
      preservedPartial: true,
    });
    expect(card?.actions.some((action) => action.key === "retry")).toBe(false);
  });

  it("allows a safe retry after partial response text when no operation started", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedRun(t, {
      status: "failed",
      recoveryState: "partial",
      retryable: true,
    });

    const reset = await t.withIdentity(identity).mutation(
      api.spectraRuns.resetForRetry,
      {
        runId: fixture.runId,
        executionId: "execution-1",
        retryKey: "safe-partial-response-retry",
      },
    );
    expect(reset.created).toBe(true);
    const run = await t.run((ctx) => ctx.db.get(fixture.runId));
    expect(run?.status).toBe("queued");
    expect(run?.recoveryState).toBeUndefined();
  });

  it("does not offer Retry when Stop loses the attached source bytes", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedRun(t, {
      status: "running",
      hasAttachments: true,
    });

    await t.withIdentity(identity).mutation(api.spectraRuns.stopRun, {
      runId: fixture.runId,
      executionId: "execution-1",
    });
    const { run, card } = await t.run(async (ctx) => ({
      run: await ctx.db.get(fixture.runId),
      card: await ctx.db.get(fixture.cardId),
    }));
    expect(run?.retryable).toBe(false);
    expect(card?.summary).toContain("Reattach them");
    expect(card?.actions.some((action) => action.key === "retry")).toBe(false);
  });

  it("rejects retry for a failed run whose attachment bytes are unavailable", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedRun(t, {
      status: "failed",
      recoveryState: "interrupted",
      retryable: true,
      hasAttachments: true,
    });

    await expect(
      t.withIdentity(identity).mutation(api.spectraRuns.resetForRetry, {
        runId: fixture.runId,
        executionId: "execution-1",
        retryKey: "attachment-retry",
      }),
    ).rejects.toThrow("Attached files are not retained for retry");
  });
});
