/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "ai-comment-author-test",
  email: "ai-comment-author@example.test",
  emailVerified: true,
};

function setupTest() {
  return convexTest(schema, modules);
}

async function seedCommentTarget(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "AI Comment School",
      slug: `ai-comment-${crypto.randomUUID()}`,
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
      name: "Pablo Example",
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
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: accountId,
      schoolId,
      blueprintKey: "document",
      schemaVersion: 1,
      title: "Argument draft",
      content: { blocks: [{ id: "claim-2", type: "paragraph", text: "The evidence" }] },
      textIndex: "The evidence",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: accountId,
      schoolId,
      sourceSurface: "artifact",
      artifactId,
      status: "running",
      userPrompt: "Review the evidence.",
      executionId: "exec-comment-1",
      createdAt: now,
      updatedAt: now,
    });
    const operationId = await ctx.db.insert("spectraOperations", {
      runId,
      executionId: "exec-comment-1",
      actorType: "ai",
      type: "app.command",
      status: "executing",
      input: {
        command: "add_comment",
        args: {
          artifactId,
          body: "Check this evidence.",
          anchor: { regionId: "block:claim-2", fallbackExcerpt: "The evidence" },
        },
      },
      affected: [],
      createdAt: now,
    });
    return { accountId, schoolId, artifactId, runId, operationId };
  });
}

describe("artifact comment AI attribution", () => {
  it("stores the actor label as the account's AI and shows it in comment reads", async () => {
    const t = setupTest();
    const seeded = await seedCommentTarget(t);
    const user = t.withIdentity(identity);
    const commentId = await user.mutation(api.artifactComments.create, {
      artifactId: seeded.artifactId,
      body: "Check this evidence.",
      anchor: { regionId: "block:claim-2", fallbackExcerpt: "The evidence" },
      mentionedAccountIds: [],
      aiRunId: seeded.runId,
      aiExecutionId: "exec-comment-1",
      aiOperationId: seeded.operationId,
    });
    const comments = await user.query(api.artifactComments.list, {
      artifactId: seeded.artifactId,
    });
    expect(String(comments[0]?._id)).toBe(String(commentId.commentId));
    expect(comments[0]?.author).toMatchObject({
      accountId: seeded.accountId,
      name: "Pablo Example's AI",
      kind: "ai",
    });
  });

  it("rejects forged or settled AI attribution and keeps direct comments human", async () => {
    const t = setupTest();
    const seeded = await seedCommentTarget(t);
    const user = t.withIdentity(identity);
    const base = {
      artifactId: seeded.artifactId,
      body: "Check this evidence.",
      anchor: { regionId: "block:claim-2", fallbackExcerpt: "The evidence" },
      mentionedAccountIds: [],
    };
    await expect(
      user.mutation(api.artifactComments.create, {
        ...base,
        body: "This does not match the operation.",
        aiRunId: seeded.runId,
        aiExecutionId: "exec-comment-1",
        aiOperationId: seeded.operationId,
      }),
    ).rejects.toThrow("AI_COMMENT_OPERATION_NOT_ACTIVE");

    await t.run((ctx) => ctx.db.patch(seeded.operationId, { status: "executed" }));
    await expect(
      user.mutation(api.artifactComments.create, {
        ...base,
        aiRunId: seeded.runId,
        aiExecutionId: "exec-comment-1",
        aiOperationId: seeded.operationId,
      }),
    ).rejects.toThrow("AI_COMMENT_OPERATION_NOT_ACTIVE");

    const commentId = await user.mutation(api.artifactComments.create, base);
    const comments = await user.query(api.artifactComments.list, {
      artifactId: seeded.artifactId,
    });
    expect(String(comments[0]?._id)).toBe(String(commentId.commentId));
    expect(comments[0]?.author).toMatchObject({ name: "Pablo Example", kind: "human" });
  });
});
